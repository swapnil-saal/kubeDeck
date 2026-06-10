import { spawn } from "child_process";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { MemorySaver, Command, interrupt } from "@langchain/langgraph";
import {
  AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage,
  type BaseMessage, type BaseMessageChunk,
} from "@langchain/core/messages";
import { createDeepAgent } from "deepagents";
import { getKubeconfigEnv } from "./settings";
import { getChatModel } from "./ai";

const MAX_OUTPUT_LENGTH = 8000;

// ═══════════════════════════════════════════════════
//  KUBECTL CHEATSHEET + SYSTEM PROMPT
// ═══════════════════════════════════════════════════

const KUBECTL_CHEATSHEET = `
KUBECTL SYNTAX RULES (CRITICAL — follow exactly):
  kubectl <verb> <resource> [name] [flags]
  Flags ALWAYS go AFTER the verb and resource, NEVER before.
  CORRECT: get pods --context=mycluster -n default
  WRONG:   --context=mycluster get pods -n default

COMMON VERBS & USAGE:
  get <resource> [name] [-n ns] [-o wide|yaml|json] [--sort-by=.field] [--field-selector=key=val]
  describe <resource> <name> [-n ns]
  logs <pod> [-n ns] [--tail=N] [-f] [-c container] [--previous]
  exec -it <pod> [-n ns] [-c container] -- <command>
  top pods|nodes [-n ns] [--sort-by=cpu|memory]
  scale deployment/<name> --replicas=N [-n ns]
  rollout status|restart|undo deployment/<name> [-n ns]
  apply -f <file|url> [-n ns]
  port-forward <pod|svc/name> <local>:<remote> [-n ns]
  config get-contexts | current-context | use-context <name>
  cluster-info
  api-resources [--namespaced=true]
  events [-n ns] [--sort-by=.lastTimestamp] [--field-selector=involvedObject.name=X]
  expose <resource> <name> --type=NodePort|ClusterIP|LoadBalancer --port=P [--target-port=TP] [-n ns]
  label|annotate <resource> <name> key=value [-n ns]

RESOURCE SHORTHANDS:
  po=pods, deploy=deployments, svc=services, ing=ingress, cm=configmaps,
  ns=namespaces, no=nodes, rs=replicasets, sts=statefulsets, ds=daemonsets,
  hpa=horizontalpodautoscalers, pvc=persistentvolumeclaims, pv=persistentvolumes,
  sa=serviceaccounts, cj=cronjobs, ep=endpoints
`;

const MAIN_SYSTEM_PROMPT = `You are KubeDeck AI — a Kubernetes expert with live cluster access through tools.

CRITICAL RULES FOR TOOL USAGE:
- You MUST use the kubectl or bash tool to answer ANY question about cluster state, resources, status, logs, metrics, or configuration. NEVER guess or assume — always query the cluster first.
- For questions that don't need cluster data (general K8s knowledge, explaining concepts), respond directly without tools.
- You can call tools multiple times. Chain commands to build a complete picture: e.g., first list pods, then describe a failing one, then check its logs.
- Always analyze tool output thoroughly before giving your final answer. Cite specific names, numbers, and details from the output.

TOOL GUIDELINES:
- kubectl tool: Pass the command WITHOUT the "kubectl" prefix. Example: "get pods -n default"
- bash tool: Use for piped commands, sorting, filtering. Include "kubectl" in the command. Example: "kubectl get pods -A --no-headers | wc -l"
- Prefer plain-text output for readability (avoid -o json unless parsing specific fields)
- Use --tail=100 for logs to avoid overwhelming output
- BLOCKED (destructive): delete, drain, cordon, taint — explain what WOULD be done, do not execute
- The --context flag is added automatically — do NOT add it yourself unless the user specifies a different context

PARALLEL INVESTIGATION:
- For complex, multi-faceted questions (e.g. "give me a full cluster health report"), use the "task" tool to dispatch the "kubernetes-investigator" subagent multiple times IN PARALLEL.
- Each subagent runs its own kubectl/bash commands and returns a focused summary.
- Synthesize the results into one cohesive answer.
- Only use subagents for genuinely multi-faceted questions. Simple queries should call kubectl/bash directly.

END-TO-END API DEBUGGING:
When the user asks to debug an API call, a failing request, a slow endpoint, or to trace a request across services, ALWAYS use the specialized debug sub-agents via the "task" tool:
  - "topology-mapper" — discovers the service call graph: ingress routes, services that the target depends on (env vars referencing other svc DNS names, service selectors). Call this FIRST to understand which pods are in play.
  - "log-hunter" — pulls and scans logs from one or more pods for errors/exceptions/timeouts/slow responses in a time window. Dispatch multiple in parallel (one per service in the call graph).
  - "trace-correlator" — given a correlation id (request-id, trace-id, x-correlation-id, customer id, timestamp) it greps that id across all services' logs and aligns the matches on a timeline so you can see who called what when.
  - "root-cause-synthesizer" — once you have evidence from the above, dispatch this to write the final hypothesis, citing exact log lines.

ASK FOR CLARIFICATION (Human-in-the-loop):
- If essential info is missing (e.g. which pod is the entrypoint, what request id to trace, time window), call the "ask_human" tool BEFORE running investigations. Do not guess.

CONTINUOUS MONITORING:
- The "monitor_logs" tool tails new log lines from a pod since the last call. Use it inside a debug session when the user asks to "watch", "keep an eye on", or reproduce an intermittent issue.
- Repeated calls to monitor_logs for the SAME pod are aggregated into a single live-streaming panel in the UI — keep calling it on the same target to keep the stream going. Do NOT spam dozens of calls back-to-back; pace them (every few seconds) and stop when you have enough or the user says stop.

${KUBECTL_CHEATSHEET}
RESPONSE FORMAT:
- Be concise — use markdown headers, bold, code blocks, and lists
- Always include specific data from command output
- If unsure, say so — never hallucinate`;

const INVESTIGATOR_SYSTEM_PROMPT = `You are a focused Kubernetes investigation sub-agent. Your ONLY job is to answer the specific question you receive by running kubectl/bash commands and returning a concise summary.

KUBECTL SYNTAX (flags go AFTER verb, never before):
  kubectl <verb> <resource> [name] [flags]
  CORRECT: get pods -n default
  WRONG:   --context=mycluster get pods

Rules:
- Run the minimum commands needed to answer the question
- Return a concise summary of your findings with specific data (names, numbers, statuses)
- The --context flag is auto-injected — do NOT add it yourself
- Do NOT delegate to other subagents
${KUBECTL_CHEATSHEET}`;

const TOPOLOGY_MAPPER_PROMPT = `You are the TOPOLOGY MAPPER. Given a target service or pod, your job is to map its end-to-end call graph.

Steps:
1. Find the target deployment/pod and read its spec (env vars, ports, container args). Look for URLs / service DNS names like \`http://foo.namespace:8080\`, \`grpc://bar:9090\`, env vars ending in _URL / _HOST / _ENDPOINT / _SERVICE.
2. Look at the Service / Ingress that fronts the target — find which clients call it (search Ingress rules, NetworkPolicies, ConfigMaps referencing the service).
3. Recursively resolve downstream services (one hop only — depth 2 unless asked) using the same method.
4. Return a concise, structured topology:
   - **Entrypoint**: how requests reach the target (ingress host/path, NodePort, etc.)
   - **Target**: service / deployment / pod names + namespace
   - **Upstream callers**: services that call the target (best-effort from ingress, network policies, env references)
   - **Downstream dependencies**: services the target calls
   - **Notes**: anything unusual (sidecars, init containers, mTLS via Istio, etc.)

Use kubectl/bash tools. Do NOT delegate. Do NOT make up services that aren't there.
${KUBECTL_CHEATSHEET}`;

const LOG_HUNTER_PROMPT = `You are the LOG HUNTER. You search logs from one or more pods for problems.

Inputs you'll receive: pod name(s) (or label selector), namespace, time window (default: last 15 minutes), and optionally a pattern or keyword.

Steps:
1. Identify the target pods. If given a label selector, resolve to actual pod names with \`get pods -l <selector> -n <ns> -o name\`.
2. For each pod, run \`logs <pod> -n <ns> --since=15m --tail=500\` (use the requested window). For multi-container pods, iterate containers.
3. Scan output for: ERROR/Error/Exception/FATAL/panic, HTTP 5xx, "timeout"/"refused"/"reset by peer", stack traces, slow query indicators (>1s), OOM/Killed.
4. Group findings by pod and by category. Quote the most representative lines verbatim with timestamps.
5. Return a structured summary:
   - **<pod-name>** — N error lines, N warning lines
     - Most common error: "<quoted line>" (×count)
     - Notable: "<one-line context>"

Limit to the most informative ~10 lines per pod. Do NOT delegate.
${KUBECTL_CHEATSHEET}`;

const TRACE_CORRELATOR_PROMPT = `You are the TRACE CORRELATOR. Given a correlation id (request id, trace id, customer id, order id, etc.) you find every log line that mentions it across multiple pods and align them on a timeline.

Inputs: correlation id, list of candidate pods (or a label selector), namespace, time window.

Steps:
1. For each candidate pod, run \`logs <pod> -n <ns> --since=<window> --tail=2000 | grep -i "<correlation-id>"\` using the bash tool.
2. Aggregate matching lines with their source pod and parse timestamps.
3. Sort the unified result chronologically — earliest to latest — to reconstruct the request's journey across services.
4. Highlight gaps (a pod that should have logged but didn't), errors, and anomalous latencies (compute diffs between consecutive lines).
5. Return:
   - **Timeline** (markdown table or sequence list): timestamp | pod | log line
   - **Findings**: where the request started, where it failed (if it did), notable latencies, missing hops.

Use bash tool with grep — never read full unfiltered logs. Do NOT delegate.
${KUBECTL_CHEATSHEET}`;

const RCA_SYNTHESIZER_PROMPT = `You are the ROOT CAUSE SYNTHESIZER. You DO NOT call kubectl/bash. You receive evidence (topology, log findings, timelines) from other sub-agents and turn it into one structured hypothesis.

Output exactly this structure:
**Summary** — one sentence describing what's broken.
**Most likely root cause** — your hypothesis, with confidence (low/medium/high).
**Evidence** — bulleted list of the specific log lines / metrics / config that point to the cause. Quote them.
**Why other plausible causes are ruled out** — short, one bullet each.
**Next actions for the human** — numbered, executable kubectl commands or config changes. Do NOT auto-execute.

If the evidence is insufficient to form a hypothesis, say so explicitly and list the missing pieces.`;

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
  return text.length > MAX_OUTPUT_LENGTH
    ? text.slice(0, MAX_OUTPUT_LENGTH) + "\n... (truncated)"
    : text;
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
//
// Agents sometimes get stuck re-running the same failing command. This
// guard records the last output for each (thread, tool, command) and
// short-circuits the 2nd+ identical call that produced an error, returning
// a hard-stop instruction that tells the model to stop or change tactics.

interface CallRecord {
  count: number;
  lastOutput: string;
  wasError: boolean;
}

const callHistory = new Map<string, CallRecord>(); // key: thread::tool::cmd

function callKey(threadId: string, tool: string, command: string): string {
  return `${threadId}::${tool}::${command.trim()}`;
}

function looksLikeError(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes("error from server") ||
    lower.includes("notfound") ||
    lower.startsWith("error:") ||
    lower.includes("failed to") ||
    lower.includes("forbidden") ||
    lower.includes("unable to") ||
    lower.includes("connection refused") ||
    lower.includes("no such")
  );
}

/**
 * Returns a short-circuit response if this exact (tool, command) was just
 * tried on this thread and failed. Otherwise returns null and updates the
 * history with the new result via `recordCall`.
 */
function checkRepeat(threadId: string, tool: string, command: string): string | null {
  const key = callKey(threadId, tool, command);
  const prev = callHistory.get(key);
  if (!prev || !prev.wasError) return null;
  const tries = prev.count + 1;
  // Always stop on the 2nd+ identical failing call.
  return (
    `STOP: this exact command was already tried ${prev.count} time(s) on this thread and failed.\n\n` +
    `Previous failure:\n${prev.lastOutput}\n\n` +
    `Do NOT retry the same command. Instead:\n` +
    `  • If the resource doesn't exist, list what does exist first (e.g. 'get pods -n <ns>') and pick a real name.\n` +
    `  • If access is forbidden, tell the user you don't have permission — do not retry.\n` +
    `  • If the cluster/network is unreachable, stop and report the error to the user.\n` +
    `  • Otherwise, change your approach or call ask_human for guidance.\n` +
    `(Repeat-call guard tripped after ${tries} identical attempts.)`
  );
}

function recordCall(threadId: string, tool: string, command: string, output: string): void {
  const key = callKey(threadId, tool, command);
  const prev = callHistory.get(key);
  callHistory.set(key, {
    count: (prev?.count ?? 0) + 1,
    lastOutput: output,
    wasError: looksLikeError(output),
  });
}

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
        "Examples: 'get pods', 'describe pod my-pod', 'logs my-pod --tail=100', 'top pods'. " +
        "Context AND the active namespace are auto-injected — do NOT add --context or -n yourself unless you need to target a different one. " +
        "Use -A to query across all namespaces. " +
        "Destructive commands (delete, drain, cordon, taint) are blocked. " +
        "If a command fails, do NOT retry the exact same command — list available resources first or change approach.",
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
        "Execute a shell command. Useful for piping kubectl output through grep, awk, sort, wc, jq. " +
        "Include the full command including 'kubectl' if needed. " +
        "The active context and namespace are auto-injected into each `kubectl` invocation — do NOT add --context or -n yourself. " +
        "Use -A on the kubectl call when you need all namespaces. " +
        "Only allowed prefixes: kubectl, jq, grep, awk, sed, sort, head, tail, wc, cut, uniq, tr, cat, echo, date, xargs. " +
        "If a command fails, do NOT retry the exact same command.",
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
//  MEMORY (in-process checkpointer)
// ═══════════════════════════════════════════════════

const checkpointer = new MemorySaver();

// ═══════════════════════════════════════════════════
//  AGENT BUILDER
// ═══════════════════════════════════════════════════

function buildAgent(currentContext: string, currentNamespace: string, sessionContext: string, threadId: string) {
  const model = getChatModel({ temperature: 0.3, maxTokens: 4096, streaming: true });

  const kubectlTool = buildKubectlTool(currentContext, currentNamespace, threadId);
  const bashTool = buildBashTool(currentContext, currentNamespace, threadId);
  const monitorTool = buildMonitorLogsTool(currentContext, threadId);

  const wrap = (prompt: string) =>
    sessionContext ? `${prompt}\n\nSession context: ${sessionContext}` : prompt;

  const mainSystemPrompt = sessionContext
    ? `${MAIN_SYSTEM_PROMPT}\n\nCurrent session context:\n${sessionContext}`
    : MAIN_SYSTEM_PROMPT;

  // All debug sub-agents get the full toolset minus ask_human (only the main
  // orchestrator can pause for the user).
  const debugTools = [kubectlTool, bashTool, monitorTool];

  return createDeepAgent({
    model,
    tools: [kubectlTool, bashTool, monitorTool, askHumanTool],
    systemPrompt: mainSystemPrompt,
    subagents: [
      {
        name: "kubernetes-investigator",
        description:
          "General-purpose Kubernetes investigation sub-agent. Use for focused single-topic questions (e.g. 'check all failing pods', 'inspect node pressure', 'audit ingress configuration'). Dispatch multiple in parallel for multi-faceted questions.",
        systemPrompt: wrap(INVESTIGATOR_SYSTEM_PROMPT),
        tools: debugTools,
      },
      {
        name: "topology-mapper",
        description:
          "Maps the end-to-end call graph for a target service or pod. Discovers entrypoints (ingress), upstream callers, and downstream dependencies by reading env vars, services, ingresses, network policies. Always call this FIRST when starting an API/end-to-end debug.",
        systemPrompt: wrap(TOPOLOGY_MAPPER_PROMPT),
        tools: debugTools,
      },
      {
        name: "log-hunter",
        description:
          "Pulls and scans logs from one or more pods for errors, exceptions, timeouts, and slow responses within a time window. Dispatch one per service in the call graph (in parallel) to gather evidence fast.",
        systemPrompt: wrap(LOG_HUNTER_PROMPT),
        tools: debugTools,
      },
      {
        name: "trace-correlator",
        description:
          "Given a correlation id (request id, trace id, customer id, order id, etc.) finds every log line mentioning it across multiple pods and aligns them on a unified timeline. Use to reconstruct the full path of a single request across services.",
        systemPrompt: wrap(TRACE_CORRELATOR_PROMPT),
        tools: debugTools,
      },
      {
        name: "root-cause-synthesizer",
        description:
          "Takes the evidence gathered by the other debug sub-agents (topology, logs, timeline) and produces a single structured root-cause hypothesis with citations and recommended next steps. Does NOT run kubectl. Call last, once you have evidence.",
        systemPrompt: wrap(RCA_SYNTHESIZER_PROMPT),
        tools: [],
      },
    ],
    checkpointer,
  });
}

// ═══════════════════════════════════════════════════
//  MESSAGE SERIALIZATION (LangChain → assistant-ui wire format)
// ═══════════════════════════════════════════════════

function getMessageType(m: BaseMessage | BaseMessageChunk): string {
  // BaseMessage classes have _getType(); chunks too.
  const anyM = m as any;
  if (typeof anyM._getType === "function") return anyM._getType();
  if (anyM.type) return anyM.type;
  return "ai";
}

function serializeMessage(m: BaseMessage | BaseMessageChunk): Record<string, unknown> {
  const type = getMessageType(m);
  const anyM = m as any;
  const base: Record<string, unknown> = {
    id: anyM.id,
    type: type === "AIMessageChunk" ? "AIMessageChunk" : type,
    content: anyM.content ?? "",
  };

  if (type === "ai" || type === "AIMessageChunk") {
    if (anyM.tool_calls?.length) base.tool_calls = anyM.tool_calls;
    if (anyM.tool_call_chunks?.length) base.tool_call_chunks = anyM.tool_call_chunks;
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
  return typeof anyX._getType === "function"
    || ["human", "ai", "system", "tool", "AIMessageChunk"].includes(anyX.type);
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

  const agent = buildAgent(currentContext, currentNamespace, clientSystemMsg, threadId);

  // Either resume an interrupted run or send the new user message(s).
  const input = options.resumeValue !== undefined
    ? new Command({ resume: options.resumeValue })
    : { messages: toLcMessages(userMessages) };

  const config = {
    configurable: { thread_id: threadId },
    streamMode: ["messages", "updates", "custom", "values"] as ("messages" | "updates" | "custom" | "values")[],
    signal: abortSignal,
    recursionLimit: 50,
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
              emit({
                event: "messages",
                data: [serializeMessage(msg), metadata ?? {}],
              });
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
          // Values events may also carry an __interrupt__ array
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

    // After the stream ends, check the graph state for a pending interrupt
    // that wasn't surfaced via updates (some langgraph versions only put it
    // on the post-run state snapshot).
    try {
      const state = await (agent as any).getState({ configurable: { thread_id: threadId } });
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
    console.error("[agent] error:", err?.message || err);
    emit({ event: "error", data: { message: err?.message || String(err) } });
  }
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
