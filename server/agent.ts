import { spawn } from "child_process";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { MemorySaver, Command, interrupt } from "@langchain/langgraph";
import {
  AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage,
  type BaseMessage, type BaseMessageChunk,
} from "@langchain/core/messages";
import { createAgent } from "langchain";
import { getKubeconfigEnv } from "./settings";
import { getChatModel } from "./ai";
import { xmlToolCallMiddleware } from "./xml-tool-calls";

const MAX_OUTPUT_LENGTH = 6000;

// SRE operator — gather real cluster data, then present dashboards when useful.
const MAIN_SYSTEM_PROMPT = `You are KubeDeck AI — a senior SRE / platform engineer with live kubectl access.

## Core method
1. ALWAYS inspect the cluster with tools before answering about state, health, performance, or failures.
2. Prefer a SHORT data pass: 1–3 compact kubectl calls, then synthesize. Do NOT keep re-querying.
3. Never invent pods, events, metrics, or IP addresses.
4. Be decisive once you have list/status data.

## Anti-loop (CRITICAL — never break these)
- Never say "I need the full output" / "let me try again" / "let me re-run". Truncated output is enough.
- Never re-run the same or nearly identical kubectl/bash command. Tools will refuse and return prior data.
- After you have deployment/pod status (even partial), call present_dashboard and finish with a short verdict.
- If a command returns data OR says ALREADY_HAVE_DATA / STOP, immediately present_dashboard or answer — no more discovery loops.

## Deployments health (recommended single pass — 2 tools max then dashboard)
1. kubectl: \`get deploy -o wide --no-headers\`
2. kubectl: \`get pods -o wide --no-headers\`  (STATUS column shows CrashLoopBackOff / ImagePullBackOff — do not re-filter via jsonpath)
3. present_dashboard immediately — READY ratios, issues for non-ready deploys / bad STATUS pods, high restart pods
4. Brief markdown. Done. Never bash+jsonpath+grep loops.

Prefer table output. Avoid \`-o yaml\`, \`-o json\`, and complex jsonpath for list inventory.

## Tools
- kubectl: args WITHOUT the "kubectl" prefix. Context and active namespace are auto-injected.
- bash: pipes only when needed.
- monitor_logs: live tail for intermittent issues.
- ask_human: only for genuine ambiguity.
- present_dashboard: visual board after you have numbers. Required for health/dashboard/performance questions.

## present_dashboard rules
- Use only tool-collected numbers (never fabricate).
- One board per user question when possible.
- Issues: severity critical|warning|info with resource names.

## Safety
- BLOCKED: delete, drain, cordon, taint.
- Mutating ops: describe only unless user clearly requested.

## Response style
- Lead with verdict, then evidence. Concise markdown.`;

// ═══════════════════════════════════════════════════
//  SAFETY CLASSIFIER
// ═══════════════════════════════════════════════════

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

type SafetyLevel = "allow" | "warn" | "block";

function classifyKubectlCommand(command: string): SafetyLevel {
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
  return "warn";
}

function classifyBashCommand(command: string): SafetyLevel {
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

function sanitizeKubectlCommand(command: string): string {
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

function injectContextFlag(command: string, context: string): string {
  if (!context || command.includes("--context")) return command;
  const parts = command.trim().split(/\s+/);
  if (parts.length === 0) return command;
  return [parts[0], `--context=${context}`, ...parts.slice(1)].join(" ");
}

function injectContextIntoBash(command: string, context: string): string {
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

function injectNamespaceFlag(command: string, namespace: string): string {
  if (!namespace || namespace === "all") return command;
  if (commandHasNamespace(command)) return command;
  const parts = command.trim().split(/\s+/);
  const verb = parts[0]?.toLowerCase();
  if (!verb || !NAMESPACED_VERBS.has(verb)) return command;
  return `${command} -n ${namespace}`;
}

function injectNamespaceIntoBash(command: string, namespace: string): string {
  if (!namespace || namespace === "all") return command;
  // Add -n <ns> to each `kubectl <verb> ...` segment that doesn't already
  // specify one and uses a namespaced verb.
  return command.replace(/kubectl\s+(\S+)([^\|;&]*)/g, (match, verb: string, rest: string) => {
    if (!NAMESPACED_VERBS.has(verb.toLowerCase())) return match;
    if (/\s-n\s|\s--namespace[=\s]|\s-A\b|\s--all-namespaces\b/.test(rest)) return match;
    return `kubectl ${verb}${rest} -n ${namespace}`;
  });
}

// ═══════════════════════════════════════════════════
//  COMMAND EXECUTION
// ═══════════════════════════════════════════════════

function execCommand(
  cmd: string, args: string[], env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      env: env ? { ...process.env, ...env } : undefined,
      timeout: 30000,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    proc.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        code: code ?? 1,
      });
    });
    proc.on("error", (err) => resolve({ stdout: "", stderr: err.message, code: 1 }));
  });
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_LENGTH) return text;
  return (
    text.slice(0, MAX_OUTPUT_LENGTH) +
    "\n... (truncated — enough data to proceed; do NOT re-run this command; present_dashboard or answer now)"
  );
}

async function executeKubectl(command: string): Promise<string> {
  const env = getKubeconfigEnv();
  if (command.includes("|") || command.includes(">") || command.includes("&&")) {
    const r = await execCommand("sh", ["-c", `kubectl ${command}`], env);
    return truncate(r.stdout || r.stderr || "(no output)");
  }
  const args = command.trim().split(/\s+/);
  const r = await execCommand("kubectl", args, env);
  return truncate(r.stdout || r.stderr || "(no output)");
}

async function executeBash(command: string): Promise<string> {
  const env = getKubeconfigEnv();
  const r = await execCommand("sh", ["-c", command], env);
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

/**
 * If this command / resource intent was already run, return prior output + hard stop.
 * Discovery budget: after MAX_DISCOVERY_PER_TURN, refuse all kubectl/bash.
 */
function checkRepeat(threadId: string, tool: string, command: string): string | null {
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

function recordCall(threadId: string, tool: string, command: string, output: string): void {
  const exactKey = callKey(threadId, tool, command);
  const intent = discoveryIntent(tool, command);
  const wasError = looksLikeError(output);

  const keys = [exactKey];
  if (intent) keys.push(`${threadId}::intent::${intent}`);

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

// Back-compat name if anything imported the old helper
export const resetAgentBurstCounter = resetAgentCallGuards;

// ═══════════════════════════════════════════════════
//  TOOL FACTORIES (k8s context-bound)
// ═══════════════════════════════════════════════════

function buildKubectlTool(currentContext: string, currentNamespace: string, threadId: string) {
  return tool(
    async ({ command }) => {
      const sanitized = sanitizeKubectlCommand(command);
      const safety = classifyKubectlCommand(sanitized);
      if (safety === "block") {
        return `Blocked: '${command}' is a destructive operation. Use the KubeDeck UI or run it manually.`;
      }
      const withCtx = injectContextFlag(sanitized, currentContext);
      const withNs = injectNamespaceFlag(withCtx, currentNamespace);
      const repeatStop = checkRepeat(threadId, "kubectl", withNs);
      if (repeatStop) return repeatStop;
      const output = await executeKubectl(withNs);
      recordCall(threadId, "kubectl", withNs, output);
      return output;
    },
    {
      name: "kubectl",
      description:
        "Execute a kubectl command against the Kubernetes cluster. " +
        "Pass the command WITHOUT the 'kubectl' prefix. " +
        "Prefer compact tables: 'get deploy -o wide', 'get pods', 'top pods' — avoid huge -o yaml for lists. " +
        "For health dashboards: one get deploy (+ optional get pods), then present_dashboard. " +
        "Context AND the active namespace are auto-injected. Use -A for all namespaces. " +
        "Destructive commands (delete, drain, cordon, taint) are blocked. " +
        "Never re-run the same/similar command for 'fuller' output — truncated is enough.",
      schema: z.object({
        command: z.string().describe("The kubectl command to run (without the 'kubectl' prefix)"),
      }),
    },
  );
}

function buildBashTool(currentContext: string, currentNamespace: string, threadId: string) {
  return tool(
    async ({ command }) => {
      const safety = classifyBashCommand(command);
      if (safety === "block") {
        return `Blocked: this command is not allowed for safety reasons.`;
      }
      const withCtx = injectContextIntoBash(command, currentContext);
      const withNs = injectNamespaceIntoBash(withCtx, currentNamespace);
      const repeatStop = checkRepeat(threadId, "bash", withNs);
      if (repeatStop) return repeatStop;
      const output = await executeBash(withNs);
      recordCall(threadId, "bash", withNs, output);
      return output;
    },
    {
      name: "bash",
      description:
        "Pipes only when table kubectl is insufficient (e.g. jq count). Prefer the kubectl tool for lists. " +
        "Do NOT loop on jsonpath — tables already include STATUS and RESTARTS. " +
        "Context/namespace auto-injected. Allowed: kubectl, jq, grep, awk, sed, sort, head, tail, wc, cut, uniq, tr, cat, echo, date, xargs. " +
        "Never re-run the same/similar command.",
      schema: z.object({
        command: z.string().describe("The shell command to execute"),
      }),
    },
  );
}

// ═══════════════════════════════════════════════════
//  DEBUG-SPECIFIC TOOLS (monitor + ask_human)
// ═══════════════════════════════════════════════════

/**
 * Tails new log lines from a pod since the last invocation (per session).
 * Uses kubectl `--since-time=<RFC3339>` so each call returns only what arrived
 * after the previous one. Cursors are stored per thread+pod combination.
 */
function buildMonitorLogsTool(currentContext: string, threadId: string) {
  return tool(
    async ({ pod, namespace, container, grep, sinceSeconds }) => {
      const ns = namespace ? `-n ${namespace}` : "-A";
      const cont = container ? `-c ${container}` : "";
      const ctxFlag = currentContext ? `--context=${currentContext}` : "";

      const cursorKey = `${threadId}::${currentContext || "default"}::${namespace || ""}::${pod}::${container || ""}`;
      const previous = monitorCursors.get(cursorKey);
      const sinceFlag = previous
        ? `--since-time=${previous}`
        : `--since=${sinceSeconds || 60}s`;

      const now = new Date().toISOString();
      const baseCmd = `kubectl ${ctxFlag} logs ${pod} ${ns} ${cont} ${sinceFlag} --tail=500 --timestamps`.replace(/\s+/g, " ").trim();
      const fullCmd = grep ? `${baseCmd} | grep -i ${shellQuote(grep)}` : baseCmd;

      const r = await execCommand("sh", ["-c", fullCmd], getKubeconfigEnv());
      monitorCursors.set(cursorKey, now);

      const out = r.stdout || r.stderr || "(no new lines)";
      return truncate(out);
    },
    {
      name: "monitor_logs",
      description:
        "Continuously tail new log lines from a pod. Returns only lines emitted since the previous call (per session). " +
        "Use this for watching, reproducing intermittent issues, or end-to-end debugging where you need fresh data. " +
        "Optional 'grep' filters lines to those matching a pattern (case-insensitive). " +
        "Optional 'sinceSeconds' (default 60) is only used on the very first call.",
      schema: z.object({
        pod: z.string().describe("Pod name (or 'deploy/<name>' / 'svc/<name>')"),
        namespace: z.string().optional().describe("Namespace"),
        container: z.string().optional().describe("Container name (for multi-container pods)"),
        grep: z.string().optional().describe("Case-insensitive substring/regex to filter lines"),
        sinceSeconds: z.number().int().positive().optional().describe("Initial lookback window in seconds (default 60)"),
      }),
    },
  );
}

/**
 * Pauses execution and asks the human a question via LangGraph interrupt().
 * The graph will throw GraphInterrupt; the runtime surfaces it as an
 * `interrupt` event. The client resumes by POSTing a Command({ resume: "..." }).
 */
const askHumanTool = tool(
  async ({ question, options }) => {
    const answer = interrupt<{ question: string; options?: string[] }, string>({
      question,
      ...(options && options.length > 0 ? { options } : {}),
    });
    return `User answered: ${answer}`;
  },
  {
    name: "ask_human",
    description:
      "Ask the human user a clarifying question and PAUSE the agent until they reply. " +
      "Use ONLY when you genuinely need information you cannot infer (e.g. 'which pod is the entrypoint?', " +
      "'what request id should I trace?', 'should I include the staging namespace too?'). " +
      "Prefer up to 4 short options when possible. Do NOT use this for confirmations of obvious actions.",
    schema: z.object({
      question: z.string().describe("The question to ask the user (one sentence)"),
      options: z.array(z.string()).max(6).optional().describe("Optional short answer choices"),
    }),
  },
);

const monitorCursors = new Map<string, string>();

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// ═══════════════════════════════════════════════════
//  PRESENT DASHBOARD (structured viz for the chat UI)
// ═══════════════════════════════════════════════════

const presentDashboardTool = tool(
  async (input) => {
    // Tool result is the JSON payload the client Tool UI renders.
    return JSON.stringify(input);
  },
  {
    name: "present_dashboard",
    description:
      "Render a visual dashboard card in the chat: KPI metrics, charts (bar/line/area/pie), " +
      "ranked issues, and optional tables. REQUIRED for deployment/cluster health and dashboard requests " +
      "after 1–2 kubectl gathers. Use real numbers only. Then stop calling tools and give a short summary.",
    schema: z.object({
      title: z.string().describe("Short board title, e.g. 'Namespace health'"),
      summary: z.string().optional().describe("1–2 sentence executive read"),
      score: z.number().min(0).max(100).optional().describe("Optional health score 0–100"),
      metrics: z
        .array(
          z.object({
            label: z.string(),
            value: z.union([z.string(), z.number()]),
            unit: z.string().optional(),
            tone: z.enum(["good", "warn", "bad", "neutral"]).optional(),
          }),
        )
        .max(12)
        .optional(),
      charts: z
        .array(
          z.object({
            type: z.enum(["bar", "line", "area", "pie"]),
            title: z.string().optional(),
            xKey: z.string().optional().describe("Category/time key for cartesian charts; default 'name'"),
            series: z
              .array(
                z.object({
                  key: z.string(),
                  label: z.string().optional(),
                }),
              )
              .min(1)
              .max(6),
            data: z
              .array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))
              .min(1)
              .max(40)
              .describe("Array of row objects, e.g. [{name:'api', restarts:12}]"),
          }),
        )
        .max(4)
        .optional(),
      issues: z
        .array(
          z.object({
            severity: z.enum(["critical", "warning", "info"]),
            title: z.string(),
            detail: z.string().optional(),
            resource: z.string().optional().describe("e.g. pod/foo or deploy/bar"),
          }),
        )
        .max(20)
        .optional(),
      tables: z
        .array(
          z.object({
            title: z.string().optional(),
            columns: z.array(z.string()).min(1).max(8),
            rows: z.array(z.array(z.string())).max(40),
          }),
        )
        .max(3)
        .optional(),
    }),
  },
);

// ═══════════════════════════════════════════════════
//  MEMORY (in-process checkpointer)
// ═══════════════════════════════════════════════════

const checkpointer = new MemorySaver();

// ═══════════════════════════════════════════════════
//  AGENT BUILDER
// ═══════════════════════════════════════════════════

function truncateSessionContext(sessionContext: string, maxChars = 2500): string {
  if (!sessionContext || sessionContext.length <= maxChars) return sessionContext;
  return (
    sessionContext.slice(0, maxChars) +
    "\n… (truncated — use kubectl to list resources if you need more names)"
  );
}

function buildAgent(currentContext: string, currentNamespace: string, sessionContext: string, threadId: string) {
  const model = getChatModel({ temperature: 0.25, maxTokens: 2048, streaming: true });

  const kubectlTool = buildKubectlTool(currentContext, currentNamespace, threadId);
  const bashTool = buildBashTool(currentContext, currentNamespace, threadId);
  const monitorTool = buildMonitorLogsTool(currentContext, threadId);

  const sessionSnippet = truncateSessionContext(sessionContext);
  const mainSystemPrompt = sessionSnippet
    ? `${MAIN_SYSTEM_PROMPT}\n\nCurrent session:\n${sessionSnippet}`
    : MAIN_SYSTEM_PROMPT;

  return createAgent({
    model,
    tools: [kubectlTool, bashTool, monitorTool, askHumanTool, presentDashboardTool],
    systemPrompt: mainSystemPrompt,
    middleware: [xmlToolCallMiddleware],
    checkpointer,
  });
}

// ═══════════════════════════════════════════════════
//  MESSAGE SERIALIZATION (LangChain → assistant-ui wire format)
// ═══════════════════════════════════════════════════

/** True streaming chunks only — NOT complete AIMessages that happen to have type "ai". */
function isStreamingChunk(m: unknown): boolean {
  if (m instanceof AIMessageChunk) return true;
  if (!m || typeof m !== "object") return false;
  const anyM = m as any;
  // Class name is the reliable signal for true stream chunks
  if (anyM.constructor?.name === "AIMessageChunk") return true;
  // Partial stream pieces sometimes only carry tool_call_chunks without being a full AIMessage
  if (
    anyM.constructor?.name !== "AIMessage" &&
    Array.isArray(anyM.tool_call_chunks) &&
    anyM.tool_call_chunks.length > 0 &&
    !Array.isArray(anyM.tool_calls)
  ) {
    return true;
  }
  return false;
}

function getMessageType(m: BaseMessage | BaseMessageChunk): string {
  const anyM = m as any;
  if (typeof anyM._getType === "function") return anyM._getType();
  if (anyM.type) return anyM.type;
  return "ai";
}

function normalizeToolCallArgs(args: unknown): Record<string, unknown> {
  if (args == null) return {};
  if (typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { input: parsed };
    } catch {
      return { input: args };
    }
  }
  return { input: args };
}

function serializeToolCalls(toolCalls: any[] | undefined): unknown[] | undefined {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined;
  return toolCalls.map((tc: any, i: number) => ({
    id: typeof tc.id === "string" && tc.id ? tc.id : `call_${i}`,
    name: tc.name ?? "",
    args: normalizeToolCallArgs(tc.args ?? tc.arguments),
    type: "tool_call",
    ...(typeof tc.index === "number" ? { index: tc.index } : {}),
  }));
}

/**
 * Serialize for assistant-ui langgraph wire format.
 *
 * CRITICAL: Do NOT label complete AIMessages as "AIMessageChunk".
 * useLangGraphMessages coerces type "ai" on the messages-tuple path into
 * AIMessageChunk and drops `tool_calls` (only keeps tool_call_chunks).
 * Complete messages must go out as messages/complete or values with type "ai".
 */
function serializeMessage(m: BaseMessage | BaseMessageChunk): Record<string, unknown> {
  const type = getMessageType(m);
  const anyM = m as any;
  const isChunk = isStreamingChunk(m);
  const base: Record<string, unknown> = {
    id: anyM.id,
    type: isChunk ? "AIMessageChunk" : type,
    content: anyM.content ?? "",
  };

  if (type === "ai" || isChunk) {
    const toolCalls = serializeToolCalls(anyM.tool_calls);
    if (toolCalls) base.tool_calls = toolCalls;
    if (anyM.tool_call_chunks?.length) {
      base.tool_call_chunks = (anyM.tool_call_chunks as any[]).map((chunk: any, i: number) => ({
        ...chunk,
        index: typeof chunk.index === "number" ? chunk.index : i,
        id: chunk.id ?? "",
        name: chunk.name ?? "",
        args:
          typeof chunk.args === "string"
            ? chunk.args
            : chunk.args
              ? JSON.stringify(chunk.args)
              : "",
      }));
    } else if (isChunk && toolCalls) {
      // Non-stream models sometimes still arrive as chunks with only tool_calls —
      // synthesize tool_call_chunks so the UI merge path keeps them.
      base.tool_call_chunks = (toolCalls as any[]).map((tc: any, i: number) => ({
        index: i,
        id: tc.id,
        name: tc.name,
        args: JSON.stringify(tc.args ?? {}),
      }));
    }
    if (anyM.additional_kwargs && Object.keys(anyM.additional_kwargs).length > 0) {
      base.additional_kwargs = anyM.additional_kwargs;
    }
  }
  if (type === "tool") {
    base.tool_call_id = anyM.tool_call_id;
    base.name = anyM.name;
    base.status = anyM.status || "success";
  }
  return base;
}

function isMessageLike(x: unknown): x is BaseMessage | BaseMessageChunk {
  if (!x || typeof x !== "object") return false;
  const anyX = x as any;
  return (
    typeof anyX._getType === "function" ||
    ["human", "ai", "system", "tool", "AIMessageChunk"].includes(anyX.type)
  );
}

/**
 * Recursively strip `messages` arrays out of a payload. The langgraph runtime
 * also tries to extract messages from `updates` events, but our updates carry
 * raw LangChain message instances that JSON-serialize as `lc:1 constructor`
 * objects. assistant-ui's converter returns `undefined` for those, which then
 * crashes downstream code that reads `.role`. Messages flow through the
 * dedicated `messages` event already, so it's safe to drop them here.
 */
function stripMessages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMessages);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "messages") continue;
      out[k] = stripMessages(v);
    }
    return out;
  }
  return value;
}

// ═══════════════════════════════════════════════════
//  PUBLIC AGENT API
// ═══════════════════════════════════════════════════

export type ChatRole = "system" | "user" | "assistant";
export interface AgentChatMessage { role: ChatRole; content: string }

export interface AgentStreamEvent {
  event: string; // "messages" | "messages/partial" | "updates" | "values" | "custom" | "error" | "info"
  data: unknown;
}

function toLcMessages(messages: AgentChatMessage[]): BaseMessage[] {
  return messages
    .filter((m) => m.role !== "system") // system prompt is owned by the agent
    .map((m) =>
      m.role === "assistant" ? new AIMessage(m.content) : new HumanMessage(m.content),
    );
}

/**
 * Input shape for `runAgent`. Either send new user messages (normal turn) or
 * a `resumeValue` to continue a thread that's paused on a HITL interrupt.
 */
export interface RunAgentOptions {
  resumeValue?: string;
}

/**
 * Run the deep agent and emit stream events suitable for
 * `@assistant-ui/react-langgraph` `useLangGraphRuntime`.
 *
 * Emits an `interrupt` event when the agent calls `interrupt()` (HITL).
 * To resume, call `runAgent([], threadId, emit, signal, { resumeValue })`.
 */
export async function runAgent(
  userMessages: AgentChatMessage[],
  threadId: string,
  emit: (event: AgentStreamEvent) => void,
  abortSignal?: AbortSignal,
  options: RunAgentOptions = {},
): Promise<void> {
  // The first system message from the client carries [Context: ..., Namespace: ...]
  const clientSystemMsg = userMessages[0]?.role === "system" ? userMessages[0].content : "";
  const ctxMatch = clientSystemMsg.match(/Context:\s*([^\s,\]]+)/i);
  const currentContext = ctxMatch?.[1] && ctxMatch[1] !== "default" ? ctxMatch[1] : "";
  const nsMatch = clientSystemMsg.match(/Namespace:\s*([^\s,\]]+)/i);
  const currentNamespace = nsMatch?.[1] && nsMatch[1] !== "all" ? nsMatch[1] : "";

  // New user turn: reset duplicate/budget guards so intentional re-checks work.
  if (options.resumeValue === undefined) {
    resetAgentCallGuards(threadId);
  }

  const agent = buildAgent(currentContext, currentNamespace, clientSystemMsg, threadId);

  // Either resume an interrupted run or send the new user message(s).
  const input = options.resumeValue !== undefined
    ? new Command({ resume: options.resumeValue })
    : { messages: toLcMessages(userMessages) };

  const config = {
    configurable: { thread_id: threadId },
    streamMode: ["messages", "updates", "custom", "values"] as ("messages" | "updates" | "custom" | "values")[],
    signal: abortSignal,
    // Discovery cap is enforced in tools; graph limit backstops tool-call loops
    recursionLimit: 14,
  };

  try {
    const stream = await (agent as any).stream(input, config);
    for await (const chunk of stream) {
      if (abortSignal?.aborted) break;
      // multi-mode stream yields [mode, data] tuples
      if (Array.isArray(chunk) && chunk.length === 2) {
        const [mode, payload] = chunk;
        if (mode === "messages") {
          // payload is [messageChunk, metadata]
          if (Array.isArray(payload) && payload.length >= 1) {
            const [msg, metadata] = payload;
            if (isMessageLike(msg)) {
              // Streaming chunks (AIMessageChunk) go on the messages-tuple path.
              // Complete AI / Tool messages MUST use messages/complete — the
              // messages tuple normalizer coerces type "ai" → AIMessageChunk and
              // drops tool_calls (keeps only tool_call_chunks), blanking the UI
              // for non-streaming OpenAI-compat gateways.
              if (isStreamingChunk(msg)) {
                emit({
                  event: "messages",
                  data: [serializeMessage(msg), metadata ?? {}],
                });
              } else {
                emit({
                  event: "messages/complete",
                  data: [serializeMessage(msg)],
                });
              }
            }
          }
        } else if (mode === "updates") {
          // Forward graph state updates with messages stripped — they're
          // delivered via the `messages` event already.
          const stripped = stripMessages(payload) as Record<string, unknown>;
          emit({ event: "updates", data: stripped });
          // Surface HITL interrupts as a dedicated event the client can render.
          const interrupts = extractInterrupts(payload);
          if (interrupts.length > 0) {
            emit({ event: "interrupt", data: interrupts });
          }
        } else if (mode === "custom") {
          emit({ event: "custom", data: payload });
        } else if (mode === "values") {
          // Forward values with serialized messages so the client can reconcile
          // the final message state (catches ToolMessages from Command-based
          // state updates that may not appear via the messages stream).
          const valuesPayload = payload as Record<string, unknown>;
          if (Array.isArray(valuesPayload?.messages)) {
            const serialized = (valuesPayload.messages as unknown[])
              .filter(isMessageLike)
              .map((msg) => serializeMessage(msg as BaseMessage));
            emit({ event: "values", data: { messages: serialized } });
          }
          const interrupts = extractInterrupts(payload);
          if (interrupts.length > 0) {
            emit({ event: "interrupt", data: interrupts });
          }
        }
      } else {
        // single-mode fallback
        emit({ event: "updates", data: chunk });
      }
    }

    // After the stream ends, push a final values snapshot so the UI can
    // reconcile tool_calls / ToolMessages (especially for non-streaming models
    // where intermediate message events alone are easy to drop).
    try {
      const state = await (agent as any).getState({ configurable: { thread_id: threadId } });
      const finalMessages = state?.values?.messages;
      if (Array.isArray(finalMessages) && finalMessages.length > 0) {
        const serialized = (finalMessages as unknown[])
          .filter(isMessageLike)
          .map((msg) => serializeMessage(msg as BaseMessage));
        emit({ event: "values", data: { messages: serialized } });
      }
      const tasks = state?.tasks ?? [];
      const pending: unknown[] = [];
      for (const t of tasks) {
        const ts = t?.interrupts;
        if (Array.isArray(ts) && ts.length > 0) pending.push(...ts);
      }
      if (pending.length > 0) {
        emit({ event: "interrupt", data: pending });
      }
    } catch {
      /* ignore — state inspection is best-effort */
    }
  } catch (err: any) {
    const raw = err?.message || String(err);
    const friendly = formatProviderError(raw);
    emit({ event: "error", data: { message: friendly } });
  }
}

function formatProviderError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("maximum context length") || lower.includes("context length") || lower.includes("too many tokens")) {
    return (
      `AI model context window exceeded. The model prompt (system + tools) is too large for this gateway. ` +
      `Try a shorter question, or use a model with a larger context. (${raw.slice(0, 220)})`
    );
  }
  if (lower.includes("503") || lower.includes("ring-balancer") || lower.includes("no healthy upstream")) {
    return (
      `AI provider is unavailable (503). Check Settings → AI base URL and model. ` +
      `Current gateway may be down — try a working endpoint and a model that exists there. ` +
      `(${raw.slice(0, 180)})`
    );
  }
  if (lower.includes("404") && lower.includes("model")) {
    return (
      `AI model not found (404). Update Settings → AI model to one available on your gateway. ` +
      `(${raw.slice(0, 180)})`
    );
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key")) {
    return `AI API key rejected. Update Settings → AI API key. (${raw.slice(0, 180)})`;
  }
  return raw;
}

/**
 * Pull out any `__interrupt__` entries from a payload. LangGraph attaches
 * them under that key on updates/values events for nodes that called
 * `interrupt()`.
 */
function extractInterrupts(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const out: unknown[] = [];
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    const obj = v as Record<string, unknown>;
    if (Array.isArray(obj.__interrupt__)) {
      for (const i of obj.__interrupt__) out.push(i);
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(payload);
  return out;
}
