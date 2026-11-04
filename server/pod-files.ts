import { spawn } from "child_process";
import { getKubeconfigEnv } from "./settings";

/**
 * Read-only access to a container's files through `kubectl exec`: list a folder, read a file,
 * search names or contents. Safe by construction:
 *   - kubectl is started with an argument list (no shell on this machine);
 *   - inside the container a FIXED script runs and the user's path / text arrive as "$1" / "$2",
 *     so they are never parsed as shell code there either;
 *   - output, results and time are capped.
 * Needs `sh`, `ls`, `head`, `grep`, `find` in the image (busybox is enough; distroless has none).
 */

export const MAX_ENTRIES = 2000;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_RESULTS = 300;
const EXEC_TIMEOUT_MS = 15_000;

/** Dependency and VCS folders: searched only when asked (they are huge and rarely what you want). */
export const SKIPPED_DIRS = ["node_modules", ".git", "vendor", "__pycache__", ".venv"];
const PRUNE = `\\( ${SKIPPED_DIRS.map((d) => `-name ${d}`).join(" -o ")} \\) -prune`;

/** The scripts run inside the container. `$1` is always the path, `$2` the extra argument. */
const SCRIPTS = {
  // a trailing "/" marks folders (ls -p); one entry per line
  list: `cd -- "$1" || exit 2; ls -1Ap . | head -n ${MAX_ENTRIES + 1}`,
  // first line: the size in bytes, then at most $2 bytes of the file
  read: `[ -d "$1" ] && { echo "is a directory" >&2; exit 3; }; wc -c < "$1" || exit 2; head -c "$2" -- "$1"`,
  // fixed-string search over files, skipping dependency / VCS folders; -I (skip binaries) only where grep has it
  content: `I=; echo x | grep -I x >/dev/null 2>&1 && I=-I; find "$1" -xdev ${PRUNE} -o -type f -print 2>/dev/null | head -n 20000 | tr '\\n' '\\0' | xargs -0 grep -nHF $I -m 5 -e "$2" 2>/dev/null | head -n ${MAX_RESULTS}`,
  contentAll: `I=; echo x | grep -I x >/dev/null 2>&1 && I=-I; grep -rnHF $I -m 5 -e "$2" -- "$1" 2>/dev/null | head -n ${MAX_RESULTS}`,
  name: `find "$1" -xdev ${PRUNE} -o -iname "*$2*" -print 2>/dev/null | head -n ${MAX_RESULTS}`,
  nameAll: `find "$1" -xdev -iname "*$2*" 2>/dev/null | head -n ${MAX_RESULTS}`,
  workdir: `pwd`,
  // downloads: the raw file, or a folder as a gzipped tar of it (named after the folder)
  download: `[ -e "$1" ] || { echo "no such file" >&2; exit 2; }; [ -f "$1" ] || { echo "not a regular file" >&2; exit 3; }; cat -- "$1"`,
  archive: `[ -e "$1" ] || { echo "no such file" >&2; exit 2; }; [ -d "$1" ] || { echo "not a directory" >&2; exit 3; }; cd -- "$1/.." && tar -czf - -- "\${1##*/}"`,
} as const;

export type FileOp = keyof typeof SCRIPTS;

export interface ExecTarget {
  pod: string;
  namespace: string;
  context: string;
  container?: string;
}

export interface ExecResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/** Folders whose files are virtual or endless: searching them hangs or floods. */
const UNSEARCHABLE = /^\/(proc|sys|dev)(\/|$)/;

/** An absolute path without NUL or newlines, normalised (no `.`/`..` segments), or null. */
export function cleanPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 1024 || /[\0\n\r]/.test(raw) || !raw.startsWith("/")) return null;
  const parts: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join("/")}`;
}

/** Search text: one line, at most 200 characters. */
export function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim();
  return q.length >= 1 && q.length <= 200 && !/[\0\n\r]/.test(q) ? q : null;
}

export function searchable(path: string): boolean {
  return path !== "/" && !UNSEARCHABLE.test(path);
}

/** The kubectl argument list for one operation. */
export function execArgs(target: ExecTarget, op: FileOp, args: string[]): string[] {
  const out = ["exec", target.pod, "-n", target.namespace];
  if (target.context) out.push("--context", target.context);
  if (target.container) out.push("-c", target.container);
  // "sh" after the script is $0; the user's values follow as $1, $2
  out.push("--request-timeout=15s", "--", "sh", "-c", SCRIPTS[op], "sh", ...args);
  return out;
}

export const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

/** A safe `filename` for Content-Disposition: the last path segment, plain characters only. */
export function downloadName(path: string, folder: boolean): string {
  const base = (path.split("/").filter(Boolean).pop() ?? "root").replace(/[^\w.-]+/g, "_").slice(0, 120) || "download";
  return folder ? `${base}.tar.gz` : base;
}

export function runInPod(target: ExecTarget, op: FileOp, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn("kubectl", execArgs(target, op, args), { env: { ...process.env, ...getKubeconfigEnv() } });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    const timer = setTimeout(() => proc.kill("SIGKILL"), EXEC_TIMEOUT_MS);
    proc.stdout.on("data", (c: Buffer) => {
      // a read is capped inside the container; this guards against anything unexpected
      if (outBytes < MAX_FILE_BYTES + 4096) out.push(c);
      outBytes += c.length;
    });
    proc.stderr.on("data", (c: Buffer) => err.push(c));
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf-8") });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout: Buffer.alloc(0), stderr: e.message });
    });
  });
}

export interface FileEntry {
  name: string;
  dir: boolean;
}

export function parseListing(stdout: string): { entries: FileEntry[]; truncated: boolean } {
  const lines = stdout.split("\n").filter((l) => l && l !== "./" && l !== "../");
  const entries = lines.slice(0, MAX_ENTRIES).map((l) => (l.endsWith("/") ? { name: l.slice(0, -1), dir: true } : { name: l, dir: false }));
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { entries, truncated: lines.length > MAX_ENTRIES };
}

export interface FileContent {
  size: number;
  truncated: boolean;
  binary: boolean;
  text: string;
}

export function parseRead(stdout: Buffer): FileContent {
  const nl = stdout.indexOf(0x0a);
  const size = Number.parseInt(stdout.subarray(0, nl < 0 ? stdout.length : nl).toString("utf-8").trim(), 10) || 0;
  const body = nl < 0 ? Buffer.alloc(0) : stdout.subarray(nl + 1, nl + 1 + MAX_FILE_BYTES);
  const binary = body.subarray(0, 8192).includes(0);
  return { size, truncated: size > body.length, binary, text: binary ? "" : body.toString("utf-8") };
}

export interface ContentMatch {
  path: string;
  line: number;
  text: string;
}

/** `path:line:text` lines from grep -rn. */
export function parseGrep(stdout: string): ContentMatch[] {
  const out: ContentMatch[] = [];
  for (const l of stdout.split("\n")) {
    const m = l.match(/^(.*?):(\d+):(.*)$/);
    if (m) out.push({ path: m[1], line: Number(m[2]), text: m[3].slice(0, 300) });
  }
  return out;
}

/** A failed exec, in words the user can act on. */
export function explainExecError(stderr: string): { status: number; message: string } {
  const s = stderr.toLowerCase();
  if (s.includes("forbidden")) return { status: 403, message: "You don't have permission to exec into this pod (RBAC: create pods/exec)." };
  if (/executable file not found|no such file or directory.*sh|exec: "sh"|oci runtime exec failed/.test(s)) {
    return { status: 422, message: "This container has no shell or basic tools (a distroless or scratch image), so its files can't be browsed." };
  }
  if (s.includes("container not found") || s.includes("is not valid for pod")) return { status: 404, message: "That container is not in this pod." };
  if (s.includes("not found") && s.includes("pod")) return { status: 404, message: "The pod no longer exists." };
  if (s.includes("is a directory")) return { status: 400, message: "That path is a folder." };
  if (s.includes("not a regular file")) return { status: 400, message: "That path is not a regular file." };
  if (s.includes("not a directory")) return { status: 400, message: "That path is not a folder." };
  if (/tar: (invalid|unrecognized) option|tar: not found|gzip: not found/.test(s)) {
    return { status: 422, message: "This container has no tar with gzip, so folders can't be downloaded. Single files still can." };
  }
  if (s.includes("can't cd") || s.includes("no such file") || s.includes("can't open") || s.includes("not a directory")) {
    return { status: 404, message: "That path does not exist in the container." };
  }
  if (s.includes("permission denied")) return { status: 403, message: "The container's user cannot read that path." };
  return { status: 502, message: stderr.trim().split("\n")[0]?.slice(0, 300) || "kubectl exec failed" };
}
