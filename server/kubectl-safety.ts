/**
 * How dangerous is a kubectl or shell command?
 *
 *   allow  read-only, run it
 *   warn   changes the cluster, ask the user first
 *   block  never run it (destructive, or could escape the "kubectl plus text filters" sandbox)
 *
 * Used by the AI agent's tools and by the kubectl palette in read-only web mode.
 */

export type SafetyLevel = "allow" | "warn" | "block";

const READ_ONLY_VERBS = new Set([
  "get", "describe", "logs", "log", "top", "explain",
  "api-resources", "api-versions", "version", "auth",
  "cluster-info", "diff", "events", "wait",
]);

/** Verbs that are refused outright, even with approval. */
export const BLOCKED_VERBS = new Set(["delete", "drain", "cordon", "uncordon", "taint"]);

/** Programs a shell pipeline may use besides kubectl: text filters only. */
const FILTER_PROGRAMS = new Set([
  "jq", "grep", "awk", "sed", "sort", "head", "tail", "wc", "cut", "uniq", "tr", "echo", "date", "column",
]);

const SEVERITY: Record<SafetyLevel, number> = { allow: 0, warn: 1, block: 2 };
const worst = (a: SafetyLevel, b: SafetyLevel): SafetyLevel => (SEVERITY[b] > SEVERITY[a] ? b : a);

/** Classify a kubectl command given WITHOUT the leading `kubectl`. */
export function classifyKubectlCommand(command: string): SafetyLevel {
  const parts = command.trim().split(/\s+/);
  const verb = parts[0]?.toLowerCase();
  const sub = parts[1]?.toLowerCase();
  if (!verb) return "block";
  if (READ_ONLY_VERBS.has(verb)) return "allow";
  if (BLOCKED_VERBS.has(verb)) return "block";
  if (verb === "config") {
    return sub === "view" || sub === "get-contexts" || sub === "current-context" ? "allow" : "warn";
  }
  // rollout status / history are read-only; restart, undo, pause… change the cluster
  if (verb === "rollout") return sub === "status" || sub === "history" ? "allow" : "warn";
  return "warn";
}

/** Fix the two mistakes models make most: flags before the verb, and "cluster info". */
export function sanitizeKubectlCommand(command: string): string {
  let cmd = command.trim().replace(/\bcluster\s+info\b/gi, "cluster-info");
  const tokens = cmd.split(/\s+/);
  let i = 0;
  while (i < tokens.length && tokens[i].startsWith("-")) i++;
  if (i > 0 && i < tokens.length) cmd = [...tokens.slice(i), ...tokens.slice(0, i)].join(" ");
  return cmd.trim();
}

/**
 * Splits a command line into arguments like a shell would for quoting only: whitespace
 * separates arguments, but text inside '…' or "…" stays one argument (so a label selector
 * such as `app in (a,b)` reaches kubectl as a single value). No expansion of any kind.
 */
export function splitArgs(command: string): string[] {
  const args: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  for (const ch of command.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true; // an empty '' is still an argument
    } else if (/\s/.test(ch)) {
      if (cur || started) args.push(cur);
      cur = "";
      started = false;
    } else {
      cur += ch;
    }
  }
  if (cur || started) args.push(cur);
  return args;
}

interface ShellScan {
  /** commands separated by unquoted | ; & && || or newlines */
  segments: string[];
  /** $( ), backticks, <( ) or >( ): could run anything */
  substitution: boolean;
  /** > or >> to anything but /dev/null or another descriptor */
  writesFile: boolean;
}

/** Split a shell line into commands, honouring quotes, so `jq '.a | .b'` stays one command. */
export function scanShell(line: string): ShellScan {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let substitution = false;
  let writesFile = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const next = line[i + 1];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && (c === "`" || (c === "$" && next === "("))) substitution = true;
      current += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; current += c; continue; }
    if (c === "\\") { current += c + (next ?? ""); i++; continue; }
    if (c === "`" || (c === "$" && next === "(") || ((c === "<" || c === ">") && next === "(")) substitution = true;
    if (c === ">") {
      const target = line.slice(i + 1).replace(/^>/, "").trimStart();
      if (!target.startsWith("&") && !/^\/dev\/null\b/.test(target)) writesFile = true;
    }
    // `2>&1` keeps its & ; every other unquoted separator ends the command
    if ((c === "&" && line[i - 1] !== ">") || c === "|" || c === ";" || c === "\n") {
      segments.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  segments.push(current);
  return { segments: segments.map((s) => s.trim()).filter(Boolean), substitution, writesFile };
}

/** A filter may read stdin; a path argument would let it read local files (kubeconfig, keys) instead. */
function readsLocalPath(args: string[]): boolean {
  return args.some((a) => /^(\/|~|\.\.?\/|\$HOME|\$\{HOME\})/.test(a));
}

function classifySegment(segment: string): SafetyLevel {
  const words = segment.split(/\s+/);
  const program = words[0].replace(/^.*\//, "");
  const args = words.slice(1);

  if (program === "kubectl") return classifyKubectlCommand(sanitizeKubectlCommand(args.join(" ")));
  if (program === "xargs") {
    // xargs runs its argument as a command: classify that command
    let i = 0;
    while (i < args.length && args[i].startsWith("-")) i += /^-[IinLPs]$/.test(args[i]) ? 2 : 1;
    return i < args.length ? classifySegment(args.slice(i).join(" ")) : "allow";
  }
  if (!FILTER_PROGRAMS.has(program)) return "block";
  if (readsLocalPath(args)) return "block";
  if (program === "sed" && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === "--in-place")) return "block";
  if (program === "awk" && /system\s*\(|getline|print\s*>|\|\s*"/.test(args.join(" "))) return "block";
  return "allow";
}

/** True when a line needs a shell to mean what it says: pipes, ;, &&, $( ), backticks or redirects. */
export function hasShellSyntax(line: string): boolean {
  const scan = scanShell(line.trim());
  return scan.segments.length > 1 || scan.substitution || scan.writesFile;
}

/** Classify a shell line made of kubectl and text filters; the most dangerous command in it wins. */
export function classifyBashCommand(command: string): SafetyLevel {
  const scan = scanShell(command.trim());
  if (scan.segments.length === 0 || scan.substitution || scan.writesFile) return "block";
  return scan.segments.reduce<SafetyLevel>((level, segment) => worst(level, classifySegment(segment)), "allow");
}
