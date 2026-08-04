/**
 * Interactive terminal: WebSocket ↔ shell stdin/stdout mapping.
 *
 * Protocol
 *   binary frames  → raw terminal bytes (stdin ↔ PTY ↔ stdout)
 *   text frames    → JSON control: { type: "resize" | "exit" | "error", ... }
 *                    (+ legacy { type: "input", data } for compatibility)
 *
 * Unix uses a tiny Python PTY relay (forkpty) so we avoid native node-pty
 * and Electron ABI rebuilds. Data path is pure byte copy; resize rides a
 * separate control FD. Windows falls back to cmd.exe pipes.
 */
import type { Server } from "http";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import * as path from "path";
import * as os from "os";
import { api } from "@shared/routes";
import { getKubeconfigEnv } from "./settings";

const PTY_RELAY_SCRIPT = [
  "import os,sys,pty,select,struct,fcntl,termios,signal,errno",
  "def sz(fd,r,c):",
  "  try: fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',int(r),int(c),0,0))",
  "  except Exception: pass",
  "def main():",
  "  sh=os.environ.get('SHELL','/bin/zsh')",
  "  base=os.path.basename(sh)",
  "  cols=int(os.environ.get('COLS','120')); rows=int(os.environ.get('ROWS','30'))",
  "  rc=os.environ.get('KUBEDECK_SHELL_RC','')",
  "  pid,fd=pty.fork()",
  "  if pid==0:",
  "    try: os.setsid()",
  "    except Exception: pass",
  "    # Prefer rcfile injection so aliases never traverse the PTY stdin channel",
  "    if rc and ('bash' in base or base in ('sh','dash')):",
  "      os.execvp(sh,[sh,'--rcfile',rc,'-i'])",
  "    elif rc and 'zsh' in base:",
  "      # ZDOTDIR already set by parent; just start interactive login shell",
  "      os.execvp(sh,[sh,'-i','-l'])",
  "    else:",
  "      os.execvp(sh,[sh,'-i','-l'])",
  "    os._exit(1)",
  "  sz(fd,rows,cols)",
  "  try:",
  "    os.set_blocking(0,False); os.set_blocking(fd,False); os.set_blocking(1,False)",
  "  except Exception: pass",
  "  ctl=3",
  "  try: os.set_blocking(ctl,False)",
  "  except Exception: ctl=None",
  "  ctl_buf=b''",
  "  try:",
  "    while True:",
  "      rlist=[0,fd]",
  "      if ctl is not None: rlist.append(ctl)",
  "      try:",
  "        rl,_,_=select.select(rlist,[],[],1.0)",
  "      except (InterruptedError,select.error):",
  "        continue",
  "      if 0 in rl:",
  "        try: d=os.read(0,65536)",
  "        except OSError as e:",
  "          if e.errno in (errno.EAGAIN,errno.EWOULDBLOCK): d=b''",
  "          else: break",
  "        if not d: break",
  "        off=0",
  "        while off<len(d):",
  "          try: n=os.write(fd,d[off:])",
  "          except OSError as e:",
  "            if e.errno in (errno.EAGAIN,errno.EWOULDBLOCK):",
  "              select.select([],[fd],[],0.05); continue",
  "            raise",
  "          if n<=0: break",
  "          off+=n",
  "      if fd in rl:",
  "        try: d=os.read(fd,65536)",
  "        except OSError as e:",
  "          if e.errno in (errno.EAGAIN,errno.EWOULDBLOCK): d=b''",
  "          else: break",
  "        if not d: break",
  "        off=0",
  "        while off<len(d):",
  "          try: n=os.write(1,d[off:])",
  "          except OSError as e:",
  "            if e.errno in (errno.EAGAIN,errno.EWOULDBLOCK):",
  "              select.select([],[1],[],0.05); continue",
  "            raise",
  "          if n<=0: break",
  "          off+=n",
  "      if ctl is not None and ctl in rl:",
  "        try: chunk=os.read(ctl,256)",
  "        except OSError: chunk=b''",
  "        if not chunk:",
  "          ctl=None",
  "        else:",
  "          ctl_buf+=chunk",
  "          while b'\\n' in ctl_buf:",
  "            line,ctl_buf=ctl_buf.split(b'\\n',1)",
  "            parts=line.decode('utf-8','replace').strip().split()",
  "            if len(parts)>=2:",
  "              try: sz(fd,int(parts[1]),int(parts[0]))",
  "              except Exception: pass",
  "            try: os.kill(pid,signal.SIGWINCH)",
  "            except Exception: pass",
  "  except Exception:",
  "    pass",
  "  finally:",
  "    try: os.close(fd)",
  "    except Exception: pass",
  "    try:",
  "      os.kill(pid,signal.SIGHUP)",
  "      os.waitpid(pid,0)",
  "    except Exception: pass",
  "if __name__=='__main__': main()",
].join("\n");

function writePtyRelay(): string {
  const ptyRelayPath = path.join(os.tmpdir(), "kubedeck-pty-relay.py");
  try {
    writeFileSync(ptyRelayPath, PTY_RELAY_SCRIPT, { mode: 0o755 });
  } catch {
    // connection will surface spawn errors
  }
  return ptyRelayPath;
}

/** Inject kubectl aliases via a temp shell rc — never appears on the PTY stream. */
function buildShellEnv(
  base: Record<string, string>,
  context: string,
  namespace: string,
): { env: Record<string, string>; cleanup: () => void } {
  const env = { ...base };
  const ns = namespace && namespace !== "all" ? namespace : "";
  let aliasLine = "";
  if (context && ns) {
    aliasLine =
      `alias kubectl='kubectl --context=${context} -n ${ns}' 2>/dev/null; ` +
      `alias k='kubectl --context=${context} -n ${ns}' 2>/dev/null`;
  } else if (context) {
    aliasLine =
      `alias kubectl='kubectl --context=${context}' 2>/dev/null; ` +
      `alias k='kubectl --context=${context}' 2>/dev/null`;
  }

  const shellName = path.basename(env.SHELL || "/bin/zsh");
  let cleanup = () => {};

  if (!aliasLine) return { env, cleanup };

  try {
    if (shellName.includes("zsh")) {
      const zdot = path.join(os.tmpdir(), `kubedeck-zdot-${process.pid}-${Date.now()}`);
      mkdirSync(zdot, { recursive: true });
      // With ZDOTDIR redirected, source the user's real home configs explicitly
      writeFileSync(
        path.join(zdot, ".zshrc"),
        [
          `# KubeDeck session — restore user env then inject context aliases`,
          `[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"`,
          `[[ -f "$HOME/.zprofile" ]] && source "$HOME/.zprofile"`,
          `[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"`,
          aliasLine,
        ].join("\n"),
      );
      env.ZDOTDIR = zdot;
      env.KUBEDECK_SHELL_RC = path.join(zdot, ".zshrc");
      cleanup = () => {
        try { rmSync(zdot, { recursive: true, force: true }); } catch { /* */ }
      };
    } else if (shellName.includes("bash") || shellName === "sh") {
      const rcPath = path.join(os.tmpdir(), `kubedeck-bashrc-${process.pid}-${Date.now()}`);
      const userRc = path.join(os.homedir(), ".bashrc");
      writeFileSync(
        rcPath,
        [
          `[[ -f "${userRc}" ]] && source "${userRc}"`,
          aliasLine,
        ].join("\n"),
      );
      env.KUBEDECK_SHELL_RC = rcPath;
      cleanup = () => {
        try { if (existsSync(rcPath)) rmSync(rcPath, { force: true }); } catch { /* */ }
      };
    }
  } catch {
    // aliases are best-effort
  }

  return { env, cleanup };
}

function buildBanner(context: string, namespace: string): string {
  // Fixed inner width (characters between the two ║ borders)
  const INNER = 48;
  const c = {
    border: (s: string) => `\x1b[36m${s}\x1b[0m`,
    title: (s: string) => `\x1b[1;37m${s}\x1b[0m`,
    label: (s: string) => `\x1b[33m${s}\x1b[0m`,
    value: (s: string) => `\x1b[32m${s}\x1b[0m`,
    muted: (s: string) => `\x1b[90m${s}\x1b[0m`,
  };
  const hRule = "═".repeat(INNER);
  const top = c.border(`╔${hRule}╗`);
  const bot = c.border(`╚${hRule}╝`);

  /** Pad plain-text visible content so `text.length + pad === INNER` (ANSI codes ignored by pad calc). */
  const row = (visibleLen: number, coloredContent: string): string => {
    const pad = Math.max(0, INNER - visibleLen);
    return c.border("║") + coloredContent + " ".repeat(pad) + c.border("║");
  };

  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, Math.max(0, max - 1)) + "…" : s;

  const lines: string[] = [top];

  // "  " + title
  const title = "KubeDeck Terminal";
  lines.push(row(2 + title.length, `  ${c.title(title)}`));

  if (context) {
    const label = "context:";
    const val = truncate(context, INNER - 2 - label.length - 2); // "  label  val"
    const visible = 2 + label.length + 2 + val.length;
    lines.push(row(visible, `  ${c.label(label)}  ${c.value(val)}`));
  }
  if (namespace && namespace !== "all") {
    const label = "namespace:";
    const val = truncate(namespace, INNER - 2 - label.length - 2);
    const visible = 2 + label.length + 2 + val.length;
    lines.push(row(visible, `  ${c.label(label)}  ${c.value(val)}`));
  }

  const note = "kubectl/k aliased to ctx/ns";
  lines.push(row(2 + note.length, `  ${c.muted(note)}`));

  lines.push(bot, "");
  return lines.join("\r\n") + "\r\n";
}

export function registerTerminalWebSocket(httpServer: Server): void {
  const ptyRelayPath = writePtyRelay();
  // noServer: share the HTTP upgrade path; deflate off for lower latency
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== api.k8s.terminal.path) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket, req: import("http").IncomingMessage) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const context = url.searchParams.get("context") || "";
    const namespace = url.searchParams.get("namespace") || "";
    const cols = Math.max(20, Math.min(500, Number(url.searchParams.get("cols") || 120) || 120));
    const rows = Math.max(5, Math.min(200, Number(url.searchParams.get("rows") || 30) || 30));

    const isWindows = os.platform() === "win32";
    const userShell = process.env.SHELL || (isWindows ? "cmd.exe" : "/bin/zsh");

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    env.TERM = "xterm-256color";
    env.COLORTERM = env.COLORTERM || "truecolor";
    // Force UTF-8 so Powerlevel10k / Nerd Font glyphs aren't replaced by '?'
    const utf8Locale =
      [env.LC_ALL, env.LC_CTYPE, env.LANG].find((v) => v && /utf-?8/i.test(v)) ||
      "en_US.UTF-8";
    if (!env.LANG || !/utf-?8/i.test(env.LANG)) env.LANG = utf8Locale;
    if (!env.LC_CTYPE || !/utf-?8/i.test(env.LC_CTYPE)) env.LC_CTYPE = utf8Locale;
    // Avoid a non-UTF LC_ALL stomping LC_CTYPE
    if (env.LC_ALL && !/utf-?8/i.test(env.LC_ALL)) delete env.LC_ALL;
    env.ROWS = String(rows);
    env.COLS = String(cols);
    env.SHELL = userShell;
    env.PYTHONUNBUFFERED = "1";
    // Hint for prompts that switch glyph sets by terminal brand
    env.TERM_PROGRAM = env.TERM_PROGRAM || "KubeDeck";
    const termKubeconfigEnv = getKubeconfigEnv();
    if (termKubeconfigEnv.KUBECONFIG) env.KUBECONFIG = termKubeconfigEnv.KUBECONFIG;
    if (context) env.KUBECTX = context;
    if (namespace && namespace !== "all") env.KUBENS = namespace;

    const { env: shellEnv, cleanup: cleanupRc } = isWindows
      ? { env, cleanup: () => {} }
      : buildShellEnv(env, context, namespace);

    let shell: ChildProcess;
    let resizeStream: NodeJS.WritableStream | null = null;
    let closed = false;

    const sendTerm = (data: Buffer | string) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(typeof data === "string" ? Buffer.from(data, "utf-8") : data, { binary: true });
    };
    const sendCtl = (obj: Record<string, unknown>) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(obj));
    };
    const cleanup = () => {
      if (closed) return;
      closed = true;
      cleanupRc();
    };

    try {
      if (isWindows) {
        shell = spawn("cmd.exe", [], {
          env: shellEnv,
          cwd: os.homedir(),
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } else {
        // stdio: 0=data-in, 1=data-out, 2=err, 3=resize control
        shell = spawn("python3", ["-u", ptyRelayPath], {
          env: shellEnv,
          cwd: os.homedir(),
          stdio: ["pipe", "pipe", "pipe", "pipe"],
        });
        const stdio = (shell as ChildProcessWithoutNullStreams).stdio as unknown as Array<NodeJS.ReadableStream | NodeJS.WritableStream | null>;
        resizeStream = (stdio[3] as NodeJS.WritableStream) ?? null;
      }
    } catch (e: any) {
      console.error("[terminal] Failed to spawn:", e.message);
      sendCtl({ type: "error", data: `Could not spawn shell: ${e.message}` });
      ws.close();
      cleanup();
      return;
    }

    // Banner over binary channel — not injected into shell stdin
    sendTerm(buildBanner(context, namespace));

    // ── stdout/stderr → WS binary (direct byte map) ──
    const onOut = (data: Buffer) => sendTerm(data);
    shell.stdout?.on("data", onOut);
    shell.stderr?.on("data", onOut);

    shell.on("close", (code) => {
      sendCtl({ type: "exit", code: code ?? 0 });
      try { ws.close(); } catch { /* */ }
      cleanup();
    });

    shell.on("error", (err) => {
      sendCtl({ type: "error", data: err.message });
    });

    // ── WS → stdin (binary frames) / control (text JSON frames) ──
    // IMPORTANT: use isBinary only — ws delivers text frames as Buffer too.
    ws.on("message", (msg, isBinary) => {
      if (isBinary) {
        if (!shell.stdin?.writable) return;
        try {
          const buf = Buffer.isBuffer(msg)
            ? msg
            : Buffer.from(msg as ArrayBuffer);
          shell.stdin.write(buf);
        } catch { /* closed */ }
        return;
      }

      const text = typeof msg === "string" ? msg : Buffer.from(msg as Buffer).toString("utf-8");
      try {
        const parsed = JSON.parse(text);
        if (parsed.type === "input" && shell.stdin?.writable) {
          // Legacy text-JSON keystrokes
          try {
            shell.stdin.write(typeof parsed.data === "string" ? parsed.data : String(parsed.data ?? ""));
          } catch { /* */ }
          return;
        }
        if (parsed.type === "resize") {
          const c = Math.max(20, Math.min(500, Number(parsed.cols) || cols));
          const r = Math.max(5, Math.min(200, Number(parsed.rows) || rows));
          if (resizeStream) {
            try { resizeStream.write(`${c} ${r}\n`); } catch { /* */ }
          }
          return;
        }
      } catch {
        // Unframed text → treat as raw input (compat)
        if (shell.stdin?.writable) {
          try { shell.stdin.write(text); } catch { /* */ }
        }
      }
    });

    ws.on("close", () => {
      try { resizeStream?.end(); } catch { /* */ }
      try {
        if (!shell.killed) shell.kill("SIGHUP");
      } catch { /* */ }
      const t = setTimeout(() => {
        try { if (!shell.killed) shell.kill("SIGKILL"); } catch { /* */ }
      }, 1500);
      t.unref?.();
      cleanup();
    });

    ws.on("error", () => {
      try { if (!shell.killed) shell.kill(); } catch { /* */ }
      cleanup();
    });
  });
}
