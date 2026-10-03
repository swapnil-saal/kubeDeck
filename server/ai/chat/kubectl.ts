/**
 * kubectl/bash safety, context injection, execution and the repeat-call guard.
 * Framework-independent: no AI SDK imports, so it can be unit-tested on its own.
 */
import { spawn } from "child_process";
import { getKubeconfigEnv } from "../../settings";

const MAX_OUTPUT_LENGTH = 6000;

const READ_ONLY_VERBS = new Set([
  "get", "describe", "logs", "log", "top", "explain",
  "api-resources", "api-versions", "version", "auth",
  "cluster-info", "diff", "events", "wait",
]);

const BLOCKED_VERBS = new Set(["delete", "drain", "cordon", "uncordon", "taint"]);

const ALLOWED_BASH_PREFIXES = [
  "kubectl", "jq", "grep", "awk", "sed", "sort", "head", "tail",
  "wc", "cut", "uniq", "tr", "cat", "echo", "date", "xargs",
];

export type SafetyLevel = "allow" | "warn" | "block";

export function classifyKubectlCommand(command: string): SafetyLevel {
  const parts = command.trim().split(/\s+/);
  const verb = parts[0]?.toLowerCase();
  if (!verb) return "block";
  if (READ_ONLY_VERBS.has(verb)) return "allow";
  if (BLOCKED_VERBS.has(verb)) return "block";
  if (verb === "config") {
    const sub = parts[1]?.toLowerCase();
    if (sub === "view" || sub === "get-contexts" || sub === "current-context") return "allow";
    return "warn";
  }
  // rollout status is read-only; other rollout subcommands mutate
  if (verb === "rollout") {
    const sub = parts[1]?.toLowerCase();
    if (sub === "status" || sub === "history") return "allow";
    return "warn";
  }
  if (verb === "auth" || verb === "api-resources" || verb === "api-versions") return "allow";
  return "warn";
}

export function classifyBashCommand(command: string): SafetyLevel {
  const trimmed = command.trim();
  if (trimmed.startsWith("kubectl ")) {
    return classifyKubectlCommand(trimmed.replace(/^kubectl\s+/, ""));
  }
  if (trimmed.includes("kubectl")) {
    for (const blocked of Array.from(BLOCKED_VERBS)) {
      if (new RegExp(`kubectl\\s+${blocked}\\b`).test(trimmed)) return "block";
    }
  }
  const dangerous = [
    "rm ", "rm -", "rmdir", "mkfs", "dd ", "shutdown", "reboot",
    "kill ", "killall", "curl ", "wget ", "nc ", "ncat ",
    "python ", "node ", "ruby ", "perl ", "bash -c", "sh -c",
  ];
  for (const d of dangerous) {
    if (trimmed.startsWith(d) || trimmed.includes(` ${d}`)) return "block";
  }
  const firstCmd = trimmed.split(/\s+/)[0]?.replace(/.*\//, "");
  if (firstCmd && !ALLOWED_BASH_PREFIXES.includes(firstCmd) && !trimmed.includes("kubectl")) {
    return "block";
  }
  return "allow";
}

export function sanitizeKubectlCommand(command: string): string {
  let cmd = command.trim();
  cmd = cmd.replace(/\bcluster\s+info\b/gi, "cluster-info");
  const tokens = cmd.split(/\s+/);
  const leadingFlags: string[] = [];
  let i = 0;
  while (i < tokens.length && tokens[i].startsWith("-")) {
    leadingFlags.push(tokens[i]);
    i++;
  }
  if (leadingFlags.length > 0 && i < tokens.length) {
    cmd = tokens.slice(i).join(" ") + " " + leadingFlags.join(" ");
  }
  return cmd.trim();
}

export function injectContextFlag(command: string, context: string): string {
  if (!context || command.includes("--context")) return command;
  const parts = command.trim().split(/\s+/);
  if (parts.length === 0) return command;
  return [parts[0], `--context=${context}`, ...parts.slice(1)].join(" ");
}

export function injectContextIntoBash(command: string, context: string): string {
  if (!context || command.includes("--context")) return command;
  return command.replace(/kubectl\s+(\S+)/g, `kubectl $1 --context=${context}`);
}

/**
 * Verbs that take a -n / --namespace flag. Used to scope kubectl commands to
 * the chat's active namespace by default when the model didn't specify one.
 */
const NAMESPACED_VERBS = new Set([
  "get", "describe", "logs", "log", "exec", "port-forward",
  "scale", "rollout", "events", "top", "expose", "label", "annotate",
  "wait", "set", "edit", "patch", "apply", "create",
]);

function commandHasNamespace(command: string): boolean {
  return /\s-n\s|\s--namespace[=\s]|\s-A\b|\s--all-namespaces\b/.test(` ${command} `);
}

export function injectNamespaceFlag(command: string, namespace: string): string {
  if (!namespace || namespace === "all") return command;
  if (commandHasNamespace(command)) return command;
  const parts = command.trim().split(/\s+/);
  const verb = parts[0]?.toLowerCase();
  if (!verb || !NAMESPACED_VERBS.has(verb)) return command;
  return `${command} -n ${namespace}`;
}

export function injectNamespaceIntoBash(command: string, namespace: string): string {
  if (!namespace || namespace === "all") return command;
  // Add -n <ns> to each `kubectl <verb> ...` segment that doesn't already
  // specify one and uses a namespaced verb.
  return command.replace(/kubectl\s+(\S+)([^\|;&]*)/g, (match, verb: string, rest: string) => {
    if (!NAMESPACED_VERBS.has(verb.toLowerCase())) return match;
    if (/\s-n\s|\s--namespace[=\s]|\s-A\b|\s--all-namespaces\b/.test(rest)) return match;
    // keep the single space that separated this segment from a following pipe
    return `kubectl ${verb}${rest.trimEnd()} -n ${namespace}${/\s$/.test(rest) ? " " : ""}`;
  });
}

// ═══════════════════════════════════════════════════
//  COMMAND EXECUTION
// ═══════════════════════════════════════════════════

/**
 * Runs a command and collects its output. When `signal` aborts (user pressed stop /
 * closed the tab) the whole process group is killed, so `sh -c "kubectl … | grep …"`
 * pipelines do not keep running in the background.
 */
export function execCommand(
  cmd: string, args: string[], env?: Record<string, string>, signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ stdout: "", stderr: "(cancelled)", code: 130 });
    const proc = spawn(cmd, args, {
      env: env ? { ...process.env, ...env } : undefined,
      timeout: 30000,
      detached: true, // own process group so the abort can kill pipeline children too
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let cancelled = false;

    const onAbort = () => {
      cancelled = true;
      try {
        if (proc.pid) process.kill(-proc.pid, "SIGTERM");
      } catch {
        proc.kill("SIGTERM");
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    proc.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: cancelled ? "(cancelled)" : Buffer.concat(stderrChunks).toString("utf-8"),
        code: code ?? 1,
      });
    });
    proc.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ stdout: "", stderr: err.message, code: 1 });
    });
  });
}

export type TruncateBias = "head" | "even" | "tail";

/**
 * Keeps the start AND the end of long output (errors and the latest log lines
 * sit at the end), dropping the middle. `tail` biases the budget towards the end.
 */
export function truncate(text: string, bias: TruncateBias = "even"): string {
  if (text.length <= MAX_OUTPUT_LENGTH) return text;
  const headShare = bias === "head" ? 0.8 : bias === "tail" ? 0.25 : 0.5;
  const headLen = Math.floor(MAX_OUTPUT_LENGTH * headShare);
  const tailLen = MAX_OUTPUT_LENGTH - headLen;
  const head = text.slice(0, headLen).replace(/[^\n]*$/, (m) => (m.length < 200 ? "" : m));
  const tail = text.slice(text.length - tailLen).replace(/^[^\n]*\n/, (m) => (m.length < 200 ? "" : m));
  const omitted = text.length - head.length - tail.length;
  return (
    `${head}\n… (${omitted} characters omitted from the middle — enough data to proceed; ` +
    `do NOT re-run this command; present_dashboard or answer now) …\n${tail}`
  );
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

/** Single-quotes a value for use in a command line (the allowed selector characters never include a quote). */
export function quoteArg(value: string): string {
  return /^[\w.\-\/:,=!@]+$/.test(value) ? value : `'${value.replace(/'/g, "")}'`;
}

export async function executeKubectl(
  command: string, opts: { signal?: AbortSignal; bias?: TruncateBias } = {},
): Promise<string> {
  const env = getKubeconfigEnv();
  if (command.includes("|") || command.includes(">") || command.includes("&&")) {
    const r = await execCommand("sh", ["-c", `kubectl ${command}`], env, opts.signal);
    return truncate(r.stdout || r.stderr || "(no output)", opts.bias);
  }
  const args = splitArgs(command);
  const r = await execCommand("kubectl", args, env, opts.signal);
  return truncate(r.stdout || r.stderr || "(no output)", opts.bias);
}

export async function executeBash(command: string, signal?: AbortSignal): Promise<string> {
  const env = getKubeconfigEnv();
  const r = await execCommand("sh", ["-c", command], env, signal);
  return truncate(r.stdout || r.stderr || "(no output)");
}

// ═══════════════════════════════════════════════════
//  LOOP / REPEAT-CALL GUARD
// ═══════════════════════════════════════════════════
// The model (esp. with limited tools permission) often re-runs bash/jsonpath
// loops after it already has get pods/deploy. Block by exact cmd, coarse
// intent (get::pods), output fingerprint, and a hard discovery budget.

interface CallRecord {
  count: number;
  lastOutput: string;
  wasError: boolean;
}

const callHistory = new Map<string, CallRecord>();
/** kubectl get/describe/top/events counts as discovery; present_dashboard does not. */
const threadDiscoveryCounts = new Map<string, number>();
const MAX_HISTORY = 400;
/** After this many discovery calls, only present_dashboard / ask_human may run. */
const MAX_DISCOVERY_PER_TURN = 5;

function callKey(threadId: string, tool: string, command: string): string {
  return `${threadId}::exact::${tool}::${command.trim()}`;
}

/**
 * Extract kubectl verb+resource so:
 *   get pods -o wide  ≈  bash: kubectl get pods -o jsonpath=... | grep
 */
function discoveryIntent(tool: string, command: string): string | null {
  let c = command.toLowerCase().replace(/\s+/g, " ").trim();
  // Use the first kubectl segment (before |, ;, &&)
  const pipeIdx = c.search(/\s[|;&]/);
  if (pipeIdx >= 0) c = c.slice(0, pipeIdx).trim();

  // bash may wrap kubectl
  const kidx = c.indexOf("kubectl ");
  if (kidx >= 0) c = c.slice(kidx + "kubectl ".length).trim();
  else if (tool === "bash") return null; // non-kubectl bash — exact key only

  c = c
    .replace(/--context=\S+/g, "")
    .replace(/-n\s+\S+/g, " ")
    .replace(/--namespace[=\s]\S+/g, " ")
    .replace(/-A\b|--all-namespaces\b/g, " ")
    .replace(/-o\s+.*/g, "") // strip output flag and everything after (jsonpath, yaml…)
    .replace(/--output[=\s]\S+.*/g, "")
    .replace(/--sort-by=\S+/g, "")
    .replace(/--field-selector=\S+/g, "")
    .replace(/--no-headers\b/g, "")
    .replace(/--wide\b/g, "")
    .replace(/--show-labels\b/g, "")
    .replace(/-l\s+\S+/g, "")
    .replace(/--selector=\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // verb + first resource token (pods, deploy, events, …)
  const parts = c.split(" ").filter(Boolean);
  if (parts.length === 0) return null;
  const verb = parts[0];
  // top pods / top nodes
  if (verb === "top") {
    const res = (parts[1] || "nodes").replace(/,.*/, "");
    return `top::${res}`;
  }
  if (verb === "logs" || verb === "log") {
    return `logs::${parts[1] || "*"}`;
  }
  if (verb === "events") return "get::events";
  if (verb === "get" || verb === "describe") {
    const res = (parts[1] || "*").replace(/,.*/, "");
    // aliases
    const alias: Record<string, string> = {
      po: "pods",
      pod: "pods",
      deploy: "deployments",
      deployment: "deployments",
      deploys: "deployments",
      svc: "services",
      no: "nodes",
      ns: "namespaces",
    };
    return `${verb}::${alias[res] || res}`;
  }
  // other verbs (rollout, auth, …)
  return `${verb}::${parts[1] || "*"}`;
}

function looksLikeError(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes("error from server") ||
    lower.includes("notfound") ||
    lower.startsWith("error:") ||
    lower.includes("error executing") ||
    lower.includes("failed to") ||
    lower.includes("forbidden") ||
    lower.includes("unable to") ||
    lower.includes("connection refused") ||
    lower.includes("no such") ||
    lower.includes("unrecognized identifier")
  );
}

function pruneHistory() {
  if (callHistory.size <= MAX_HISTORY) return;
  const keys = Array.from(callHistory.keys());
  for (let i = 0; i < keys.length - MAX_HISTORY / 2; i++) {
    callHistory.delete(keys[i]);
  }
}

function forceDashboardMsg(prior?: string): string {
  const head = prior
    ? `${prior}\n\n---\n`
    : "";
  return (
    `${head}` +
    `STOP_REPEATING: You already have enough cluster data (or this query already ran). ` +
    `Do NOT call kubectl/bash again. Immediately call present_dashboard with metrics/charts/issues ` +
    `from the earlier tool outputs (unhealthy pods from STATUS column, incomplete READY deploys, high restarts), ` +
    `then write a short verdict. CrashLoopBackOff/ImagePullBackOff pods are "Running" phase — do not re-query for them.`
  );
}

// ═══════════════════════════════════════════════════
//  ACCESS LIMITS (RBAC "Forbidden" memory)
// ═══════════════════════════════════════════════════
// A Forbidden answer is final for that resource + namespace. Without this the model
// rephrases the query and tries other namespaces until the step budget runs out.

interface AccessLimit {
  user: string;
  verbs: Set<string>;
  /** namespaces that returned Forbidden; "*" = cluster scope */
  scopes: Set<string>;
}

/** threadId → resource (plural, no group) → limit. Survives across turns of a thread. */
const accessLimits = new Map<string, Map<string, AccessLimit>>();
const MAX_ACCESS_THREADS = 200;
/** Forbidden in this many different scopes ⇒ treat the resource as off-limits everywhere. */
const FORBIDDEN_SCOPES_BEFORE_GLOBAL = 2;

const FORBIDDEN_RE =
  /forbidden: User "([^"]+)" cannot (\w+) resource "([^"]+)"[^\n]*?(?:in the namespace "([^"]+)"|at the cluster scope)/i;

export interface ParsedForbidden {
  user: string;
  verb: string;
  resource: string;
  scope: string;
}

export function parseForbidden(output: string): ParsedForbidden | null {
  const m = output.match(FORBIDDEN_RE);
  if (!m) return null;
  return {
    user: m[1],
    verb: m[2].toLowerCase(),
    // "pods/log" → pods, "deployments.apps" → deployments
    resource: m[3].toLowerCase().split("/")[0].split(".")[0],
    scope: m[4] || "*",
  };
}

/** Plural resource a command targets (matches the resource in a Forbidden message), if known. */
function commandResource(tool: string, command: string): string | null {
  const intent = discoveryIntent(tool, command);
  if (!intent) return null;
  const [verb, target] = intent.split("::");
  if (verb === "logs") return "pods";
  if (verb === "get" || verb === "describe" || verb === "top") return target && target !== "*" ? target : null;
  return null;
}

function commandScope(command: string): string {
  if (/\s(-A|--all-namespaces)\b/.test(` ${command} `)) return "*";
  const m = ` ${command} `.match(/\s(?:-n|--namespace)[=\s]+(\S+)/);
  return m?.[1] ?? "_default";
}

function registerForbidden(threadId: string, f: ParsedForbidden): void {
  let perThread = accessLimits.get(threadId);
  if (!perThread) {
    if (accessLimits.size >= MAX_ACCESS_THREADS) {
      const oldest = accessLimits.keys().next().value;
      if (oldest !== undefined) accessLimits.delete(oldest);
    }
    perThread = new Map();
    accessLimits.set(threadId, perThread);
  }
  const lim = perThread.get(f.resource) ?? { user: f.user, verbs: new Set<string>(), scopes: new Set<string>() };
  lim.verbs.add(f.verb);
  lim.scopes.add(f.scope);
  perThread.set(f.resource, lim);
}

function isAccessBlocked(threadId: string, resource: string, scope: string): AccessLimit | null {
  const lim = accessLimits.get(threadId)?.get(resource);
  if (!lim) return null;
  // Cluster-wide Forbidden says nothing about a single namespace (common RBAC shape), so "*"
  // only blocks cluster-wide queries; several denied namespaces mean "no access anywhere".
  const namespaced = Array.from(lim.scopes).filter((x) => x !== "*").length;
  if (lim.scopes.has(scope) || namespaced >= FORBIDDEN_SCOPES_BEFORE_GLOBAL) return lim;
  return null;
}

function accessDeniedMessage(resource: string, lim: AccessLimit): string {
  const where = Array.from(lim.scopes).map((x) => (x === "*" ? "cluster scope" : x)).join(", ");
  return (
    `ACCESS_DENIED: user "${lim.user}" is not permitted to ${Array.from(lim.verbs).join("/")} ${resource} ` +
    `(Forbidden in: ${where}). This is an RBAC limit, not a typo — do NOT retry ${resource} in other ` +
    `namespaces or with other flags. Use data you already have, or tell the user which access is missing.`
  );
}

/** Hint appended to a Forbidden tool result so the model stops probing. */
export function forbiddenHint(output: string): string | null {
  const f = parseForbidden(output);
  if (!f) return null;
  return (
    `\n\nACCESS_DENIED: "${f.user}" cannot ${f.verb} ${f.resource}` +
    `${f.scope === "*" ? " at cluster scope" : ` in namespace ${f.scope}`}. ` +
    `This is final — do not retry ${f.resource} with other flags. Work with what you have and tell the user what access is missing.`
  );
}

/** Lines for the system prompt describing what this thread has learned the user cannot do. */
export function describeAccessLimits(threadId: string): string[] {
  const out: string[] = [];
  for (const [resource, lim] of accessLimits.get(threadId) ?? []) {
    const where = Array.from(lim.scopes).map((x) => (x === "*" ? "cluster scope" : `namespace ${x}`)).join(", ");
    out.push(`cannot ${Array.from(lim.verbs).join("/")} ${resource} (${where}) as ${lim.user}`);
  }
  return out;
}

/**
 * If this command / resource intent was already run, return prior output + hard stop.
 * Discovery budget: after MAX_DISCOVERY_PER_TURN, refuse all kubectl/bash.
 */
export function checkRepeat(threadId: string, tool: string, command: string): string | null {
  const resource = commandResource(tool, command);
  if (resource) {
    const lim = isAccessBlocked(threadId, resource, commandScope(command));
    if (lim) return accessDeniedMessage(resource, lim);
  }

  const discovery = threadDiscoveryCounts.get(threadId) ?? 0;
  if (discovery >= MAX_DISCOVERY_PER_TURN) {
    return forceDashboardMsg();
  }

  const exactKey = callKey(threadId, tool, command);
  const prevExact = callHistory.get(exactKey);
  if (prevExact && prevExact.count >= 1) {
    return forceDashboardMsg(prevExact.lastOutput);
  }

  const intent = discoveryIntent(tool, command);
  if (intent) {
    const intentKey = `${threadId}::intent::${intent}`;
    const prevIntent = callHistory.get(intentKey);
    // One successful get pods / get deployments is enough. One failed forbidden is enough.
    if (prevIntent && prevIntent.count >= 1) {
      return forceDashboardMsg(prevIntent.lastOutput);
    }
  }

  return null;
}

export function recordCall(threadId: string, tool: string, command: string, output: string): void {
  const exactKey = callKey(threadId, tool, command);
  const intent = discoveryIntent(tool, command);
  const wasError = looksLikeError(output);

  const forbidden = parseForbidden(output);
  if (forbidden) registerForbidden(threadId, forbidden);

  const keys = [exactKey];
  // A Forbidden result is handled by the access guard; recording it as "already have
  // this data" would tell the model to build a dashboard from an error.
  if (intent && !forbidden) keys.push(`${threadId}::intent::${intent}`);

  for (const key of keys) {
    const prev = callHistory.get(key);
    callHistory.set(key, {
      count: (prev?.count ?? 0) + 1,
      lastOutput: output,
      wasError,
    });
  }

  threadDiscoveryCounts.set(threadId, (threadDiscoveryCounts.get(threadId) ?? 0) + 1);
  pruneHistory();
}

/** Clear per-thread guards so a new user question can re-fetch intentionally. */
export function resetAgentCallGuards(threadId: string): void {
  threadDiscoveryCounts.set(threadId, 0);
  const prefix = `${threadId}::`;
  for (const key of Array.from(callHistory.keys())) {
    if (key.startsWith(prefix)) callHistory.delete(key);
  }
}

