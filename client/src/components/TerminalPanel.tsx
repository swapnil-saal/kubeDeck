import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { ChevronUp, X, TerminalSquare, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Powerlevel10k / Oh My Zsh icons live in the Private Use Area and only
 * render if a Nerd Font is active. Always list known Nerd face names first so
 * CSS can pick up system-installed fonts (Meslo is the p10k default); fall
 * back to regular mono when none are present.
 */
const TERMINAL_FONT_FAMILY = [
  // p10k recommended
  '"MesloLGS Nerd Font Mono"',
  '"MesloLGS Nerd Font"',
  '"MesloLGS NF"',
  '"MesloLGM Nerd Font Mono"',
  '"MesloLGL Nerd Font Mono"',
  '"MesloLGL Nerd Font"',
  // other common nerd mono faces
  '"JetBrainsMono Nerd Font Mono"',
  '"JetBrainsMono Nerd Font"',
  '"FiraCode Nerd Font Mono"',
  '"FiraCode Nerd Font"',
  '"Hack Nerd Font Mono"',
  '"CaskaydiaCove Nerd Font Mono"',
  '"SauceCodePro Nerd Font Mono"',
  // last-resort symbols-only pack + regular coding fonts
  '"Symbols Nerd Font Mono"',
  '"Symbols Nerd Font"',
  "'JetBrains Mono'",
  "'Fira Code'",
  "'SF Mono'",
  "'Cascadia Code'",
  "Menlo",
  "ui-monospace",
  "monospace",
].join(", ");

function getAccentHex(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  if (!raw) return "#a78bfa";
  const [h, s, l] = raw.split(/\s+/).map(parseFloat);
  const toRgb = (h: number, s: number, l: number) => {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
    return [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  };
  return `#${toRgb(h, s, l)}`;
}

interface TerminalPanelProps {
  context: string;
  namespace: string;
  isOpen: boolean;
  onToggle: () => void;
  height?: number;
}

/**
 * Binary-first terminal client.
 *   binary frames  → raw PTY bytes (write / onData)
 *   text frames    → JSON control (resize ack path, exit, error)
 */
export function TerminalPanel({ context, namespace, isOpen, onToggle, height = 300 }: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [panelHeight, setPanelHeight] = useState(height);
  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const ctxRef = useRef(context);
  const nsRef = useRef(namespace);
  const [ctxMismatch, setCtxMismatch] = useState(false);

  useEffect(() => {
    if (isOpen && isConnected && (ctxRef.current !== context || nsRef.current !== namespace)) {
      setCtxMismatch(true);
    }
    ctxRef.current = context;
    nsRef.current = namespace;
  }, [context, namespace, isOpen, isConnected]);

  const connectTerminal = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }

    if (!termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      // Align p10k segment separators / icons
      lineHeight: 1.2,
      letterSpacing: 0,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontWeight: "400",
      fontWeightBold: "700",
      // Draw powerline / box chars from the Nerd Font (not xterm's simplified paths)
      customGlyphs: false,
      // Keep double-width / private-use icons from overlapping neighbors
      rescaleOverlappingGlyphs: true,
      theme: {
        background: "#04060a",
        foreground: "#c8d3de",
        cursor: getAccentHex(),
        cursorAccent: "#04060a",
        selectionBackground: getAccentHex() + "33",
        selectionForeground: "#ffffff",
        black: "#0a0e14",
        red: "#f87171",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e2e8f0",
        brightBlack: "#475569",
        brightRed: "#fca5a5",
        brightGreen: "#6ee7b7",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
      allowProposedApi: true,
      scrollback: 10000,
      // Real PTY already emits \r\n; converting corrupts layout
      convertEol: false,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Re-fit after system fonts finish loading (Nerd Fonts often resolve late in Chromium)
    const fit = () => {
      try { fitAddon.fit(); } catch { /* */ }
    };
    requestAnimationFrame(fit);
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        // Force a remeasure so cell width matches the real Nerd Font metrics
        term.refresh(0, term.rows - 1);
        fit();
      }).catch(() => {});
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams();
    if (ctxRef.current) params.set("context", ctxRef.current);
    if (nsRef.current && nsRef.current !== "all") params.set("namespace", nsRef.current);
    // Seed PTY size before first paint of shell prompt
    params.set("cols", String(term.cols || 120));
    params.set("rows", String(term.rows || 30));
    const wsUrl = `${protocol}//${window.location.host}/api/terminal?${params.toString()}`;

    const ws = new WebSocket(wsUrl);
    // Receive raw bytes without string coercion when possible
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const sendResize = (cols: number, rows: number) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    };

    ws.onopen = () => {
      setIsConnected(true);
      sendResize(term.cols, term.rows);
    };

    ws.onmessage = (event) => {
      // Binary = terminal output (fast path)
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
        return;
      }
      if (typeof Blob !== "undefined" && event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => term.write(new Uint8Array(buf)));
        return;
      }

      // Text = control (or legacy JSON output)
      const text = typeof event.data === "string" ? event.data : String(event.data);
      try {
        const msg = JSON.parse(text);
        if (msg.type === "output" && typeof msg.data === "string") {
          term.write(msg.data);
        } else if (msg.type === "exit") {
          term.writeln(`\r\n\x1b[90m[session ended with code ${msg.code}]\x1b[0m`);
          setIsConnected(false);
        } else if (msg.type === "error") {
          term.writeln(`\r\n\x1b[31m[error: ${msg.data}]\x1b[0m`);
        }
      } catch {
        // Plain text payload
        term.write(text);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    ws.onerror = () => {
      setIsConnected(false);
      term.writeln("\r\n\x1b[31m[connection error]\x1b[0m");
    };

    // Keystrokes / paste → binary frames (no JSON encode per key)
    const utf8 = new TextEncoder();
    term.onData((data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // ArrayBuffer frame so server can use the isBinary fast path
      ws.send(utf8.encode(data));
    });

    term.onResize(({ cols, rows }) => {
      sendResize(cols, rows);
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => connectTerminal(), 50);
      return () => clearTimeout(t);
    }
    wsRef.current?.close();
    wsRef.current = null;
    xtermRef.current?.dispose();
    xtermRef.current = null;
    setIsConnected(false);
  }, [isOpen, connectTerminal]);

  useEffect(() => {
    if (isOpen && fitAddonRef.current) {
      requestAnimationFrame(() => {
        try { fitAddonRef.current?.fit(); } catch { /* */ }
      });
    }
  }, [panelHeight, isOpen]);

  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && isOpen) {
        try { fitAddonRef.current.fit(); } catch { /* */ }
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isOpen]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = startYRef.current - e.clientY;
      const newHeight = Math.max(150, Math.min(window.innerHeight * 0.7, startHeightRef.current + delta));
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      resizingRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      requestAnimationFrame(() => {
        try { fitAddonRef.current?.fit(); } catch { /* */ }
      });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [panelHeight]);

  const handleReconnect = useCallback(() => {
    setCtxMismatch(false);
    connectTerminal();
  }, [connectTerminal]);

  return (
    <>
      {!isOpen && (
        <button
          onClick={onToggle}
          className="fixed bottom-0 right-4 z-50 flex items-center gap-2 px-4 py-2 rounded-t-xl border border-b-0 transition-colors text-[11px] font-semibold bg-card/80 backdrop-blur border-border/50 text-muted-foreground hover:text-primary hover:border-primary/20 shadow-sm"
        >
          <TerminalSquare className="w-4 h-4" />
          <span>Terminal</span>
          <span className="text-muted-foreground/40 text-[9px]">⌃`</span>
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: panelHeight, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="relative z-40 border-t border-border/50 bg-card overflow-hidden flex flex-col"
            style={{ minHeight: 0 }}
          >
            <div
              className="h-1 cursor-ns-resize group flex items-center justify-center hover:bg-primary/10 transition-colors"
              onMouseDown={handleResizeStart}
            >
              <div className="w-12 h-0.5 rounded bg-foreground/[0.08] group-hover:bg-primary/30 transition-colors" />
            </div>

            <div className="flex items-center h-9 px-4 border-b border-border/50 bg-card/50 backdrop-blur shrink-0">
              <div className="flex items-center gap-2">
                <TerminalSquare size={14} className="text-primary" />
                <span className="text-[11px] font-semibold text-foreground">Shell</span>
                <span className="text-muted-foreground/20">·</span>
                {context && (
                  <span className="text-[11px] font-mono text-emerald-500">{context}</span>
                )}
                {namespace && namespace !== "all" && (
                  <>
                    <span className="text-muted-foreground/30">/</span>
                    <span className="text-[11px] font-mono text-primary">{namespace}</span>
                  </>
                )}
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                {ctxMismatch && (
                  <button
                    onClick={handleReconnect}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-semibold uppercase tracking-widest text-amber-400 hover:bg-amber-500/15 transition-colors"
                    title="Context/namespace changed — click to reconnect"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    ctx changed · reconnect
                  </button>
                )}

                <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-widest ${
                  isConnected ? "text-emerald-400/80" : "text-red-400/60"
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]" : "bg-muted-foreground/30"}`} />
                  {isConnected ? "connected" : "disconnected"}
                </div>

                <button
                  onClick={handleReconnect}
                  className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-primary transition-colors"
                  title="Reconnect (new session)"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>

                <button
                  onClick={onToggle}
                  className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  title="Close terminal"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div
              ref={termRef}
              className="flex-1 px-1 py-1"
              style={{ minHeight: 0 }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
