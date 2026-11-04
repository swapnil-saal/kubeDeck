import { tool, type ToolApprovalStatus } from "ai";
import { z } from "zod";
import { getKubeconfigEnv } from "../../settings";
import { isWebMode, webAgentRefusal } from "../../web-mode";
import {
  classifyBashCommand,
  classifyKubectlCommand,
  hasShellSyntax,
  sanitizeKubectlCommand,
  type SafetyLevel,
} from "../../kubectl-safety";
import {
  checkRepeat,
  execCommand,
  executeBash,
  executeKubectl,
  executePipeline,
  forbiddenHint,
  quoteArg,
  summarizeTable,
  type TruncateBias,
  injectContextFlag,
  injectContextIntoBash,
  injectNamespaceFlag,
  injectNamespaceIntoBash,
  narrowToNamespace,
  narrowBashToNamespace,
  recordCall,
  truncate,
} from "./kubectl";

export const dashboardSchema = z.object({
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
});

/** Resource names / selectors are interpolated into a command line — keep them to plain tokens. */
const token = (what: string) =>
  z.string().regex(/^[\w.\-\/:,=!@]+$/, `${what} must be a plain token (no spaces, quotes or shell characters)`);

/**
 * Label selector in full kubectl syntax: `app=api`, `tier!=db`, `env in (prod,staging)`, `!canary`, `a,b=c`.
 * The character set has no quotes, `$`, backticks, `;`, `|`, `&`, `<`, `>` or newlines, so it cannot
 * break out of the (single-quoted) argument it is placed in.
 */
const labelSelector = z
  .string()
  .max(200)
  .regex(/^[\w.\-\/:,=!() ]+$/, "labelSelector may only contain letters, digits and . - _ / : , = ! ( ) and spaces");


/** The cluster scope one agent request runs in. Passed to every cluster tool as its `context`. */
export const kubeScopeSchema = z.object({
  /** kube context name; empty = kubeconfig default */
  context: z.string(),
  /** namespace selected in the header; empty = all namespaces */
  namespace: z.string(),
  /** chat thread, for the repeat-call and access guards */
  threadId: z.string(),
  /** who asked (web mode's signed-in user), for audit lines; empty on the desktop */
  user: z.string().default(""),
});
export type KubeScope = z.infer<typeof kubeScopeSchema>;

const BLOCKED_REASON =
  "Blocked: this command is destructive or outside what the assistant may run. Use the KubeDeck UI or run it yourself.";

const SHELL_IN_KUBECTL_REASON =
  "Blocked: the kubectl tool runs one kubectl command without a shell. Use the bash tool for pipes (kubectl … | grep / wc / jq).";

/** Safety level → approval decision: reads run, changes wait for the user, destructive commands are refused. */
function approvalFor(level: SafetyLevel): ToolApprovalStatus | undefined {
  if (level === "block") return { type: "denied", reason: BLOCKED_REASON };
  if (level === "warn") return "user-approval";
  return undefined;
}

/** The level, then the shared-host limits (web mode), then the usual approval rule. */
function decide(command: string, tool: "kubectl" | "bash", level: SafetyLevel): ToolApprovalStatus | undefined {
  const refusal = webAgentRefusal(command, tool, level);
  return refusal ? { type: "denied", reason: refusal } : approvalFor(level);
}

/** Approval policy for the tools that run free-form commands. Every other tool is read-only. */
export const kubeToolApproval = {
  kubectl: ({ command }: { command: string }): ToolApprovalStatus | undefined =>
    hasShellSyntax(command)
      ? { type: "denied", reason: SHELL_IN_KUBECTL_REASON }
      : decide(command, "kubectl", classifyKubectlCommand(sanitizeKubectlCommand(command))),
  bash: ({ command }: { command: string }) => decide(command, "bash", classifyBashCommand(command)),
};

/** Audit line for a command that changes the cluster (it only runs after the user approved it). */
function logMutation(tool: string, command: string, scope: KubeScope): void {
  console.log(
    `[kubedeck:agent] running approved ${tool}${scope.user ? ` user=${JSON.stringify(scope.user)}` : ""} ` +
      `thread=${scope.threadId} context=${scope.context || "default"} command=${JSON.stringify(command)}`,
  );
}

/** Run kubectl in the request's scope, with the repeat-call and access guards. */
async function runKubectl(
  command: string,
  scope: KubeScope,
  signal?: AbortSignal,
  opts: { bias?: TruncateBias; transform?: (stdout: string) => string } = {},
): Promise<string> {
  // the approval policy already refuses these; checked again here so no caller can skip it
  if (hasShellSyntax(command)) return SHELL_IN_KUBECTL_REASON;
  const sanitized = sanitizeKubectlCommand(command);
  const level = classifyKubectlCommand(sanitized);
  if (level === "block") return BLOCKED_REASON;
  const refusal = webAgentRefusal(command, "kubectl", level);
  if (refusal) return refusal;
  const narrowed = narrowToNamespace(sanitized, scope.namespace);
  const scoped = injectNamespaceFlag(injectContextFlag(narrowed.command, scope.context), scope.namespace);
  const repeatStop = checkRepeat(scope.threadId, "kubectl", scoped);
  if (repeatStop) return repeatStop;
  if (classifyKubectlCommand(sanitized) === "warn") logMutation("kubectl", scoped, scope);
  const output = await executeKubectl(scoped, { signal, ...opts });
  recordCall(scope.threadId, "kubectl", scoped, output);
  const note = narrowed.narrowed
    ? `[Scoped to namespace "${scope.namespace}" — the user selected it in the header. Do not retry with -A; ask them to pick "all namespaces" if they want a wider view.]\n`
    : "";
  return note + output + (forbiddenHint(output) ?? "");
}

/** Last-seen timestamp per watched log stream, so monitor_logs returns only new lines. Bounded. */
const monitorCursors = new Map<string, string>();
const MAX_MONITOR_CURSORS = 500;

function rememberCursor(key: string, at: string): void {
  monitorCursors.delete(key);
  monitorCursors.set(key, at);
  if (monitorCursors.size > MAX_MONITOR_CURSORS) {
    const oldest = monitorCursors.keys().next().value;
    if (oldest !== undefined) monitorCursors.delete(oldest);
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * The agent's tools. Cluster tools receive the request's scope as `context` (see `kubeScopeSchema`);
 * whether a command may run is decided by `kubeToolApproval`, not inside the tools.
 * `ask_human` has no `execute`: the client shows the question and sends the answer back as its output.
 */
export const kubeTools = {
  k8s_list: tool({
    description:
      "List Kubernetes resources. resource e.g. pods, deployments, services, nodes, events. " +
      "view='summary' returns EXACT counts computed by KubeDeck (total, by STATUS, not ready, restarts, per namespace) — " +
      "use it for 'how many / which are unhealthy / what restarts most' instead of reading rows. " +
      "view='names' returns just names. view='table' (default) returns rows. " +
      "Filter at the source: fieldSelector (status.phase!=Running, spec.nodeName=x) and labelSelector. " +
      "Namespace auto-scoped unless allNamespaces=true.",
    inputSchema: z.object({
      resource: token("resource").describe("Resource type: pods, deployments, services, nodes, jobs, events, …"),
      name: token("name").optional().describe("Optional specific name filter"),
      allNamespaces: z.boolean().optional().describe("List across all namespaces (-A); ignored when the user selected a namespace"),
      labelSelector: labelSelector.optional().describe("Label selector, e.g. app=api or 'app in (a,b)'"),
      fieldSelector: token("fieldSelector").optional().describe("Field selector, e.g. status.phase=Failed"),
      wide: z.boolean().optional().describe("Use -o wide (more columns); table view only"),
      view: z.enum(["table", "summary", "names"]).optional().describe("table (default) | summary (exact counts) | names"),
    }),
    contextSchema: kubeScopeSchema,
    execute: async ({ resource, allNamespaces, labelSelector, fieldSelector, wide, name, view = "table" }, { abortSignal, context }) => {
      let cmd = `get ${resource}`;
      if (name) cmd += ` ${name}`;
      if (allNamespaces) cmd += " -A";
      // a summary needs the header row to find its columns
      if (view === "names") cmd += " -o name";
      else if (view === "table") cmd += wide ? " -o wide" : " --no-headers";
      if (labelSelector) cmd += ` -l ${quoteArg(labelSelector.trim())}`;
      if (fieldSelector) cmd += ` --field-selector=${fieldSelector}`;
      return runKubectl(cmd, context, abortSignal, view === "summary" ? { transform: (out) => summarizeTable(out, resource) } : {});
    },
  }),

  k8s_describe: tool({
    description:
      "Describe a single resource (status, events summary, conditions). Prefer over huge -o yaml for diagnosis.",
    inputSchema: z.object({
      resource: token("resource").describe("Resource type, e.g. pod, deployment"),
      name: token("name").describe("Resource name"),
      namespace: token("namespace").optional().describe("Namespace override if not the session default"),
    }),
    contextSchema: kubeScopeSchema,
    execute: async ({ resource, name, namespace }, { abortSignal, context }) =>
      runKubectl(`describe ${resource} ${name}${namespace ? ` -n ${namespace}` : ""}`, context, abortSignal),
  }),

  k8s_logs: tool({
    description:
      "Fetch recent logs from a pod (or deploy/NAME, svc/NAME). Use previous=true for the last crashed container.",
    inputSchema: z.object({
      name: token("name").describe("Pod name or deploy/x / svc/x"),
      namespace: token("namespace").optional(),
      container: token("container").optional(),
      tail: z.number().int().positive().max(500).optional().describe("Lines to fetch (default 100)"),
      previous: z.boolean().optional().describe("Logs from previous crashed container"),
      since: token("since").optional().describe("Relative duration e.g. 15m, 1h"),
    }),
    contextSchema: kubeScopeSchema,
    execute: async ({ name, namespace, container, tail, previous, since }, { abortSignal, context }) => {
      let cmd = `logs ${name} --tail=${tail ?? 100}`;
      if (namespace) cmd += ` -n ${namespace}`;
      if (container) cmd += ` -c ${container}`;
      if (previous) cmd += " --previous";
      if (since) cmd += ` --since=${since}`;
      // the newest lines (and the crash) are at the end of a log
      return runKubectl(cmd, context, abortSignal, { bias: "tail" });
    },
  }),

  kubectl: tool({
    description:
      "Free-form kubectl (WITHOUT the 'kubectl' prefix). Prefer k8s_list / k8s_describe / k8s_logs first. " +
      "Context and namespace are auto-injected; -A is narrowed to the selected namespace. " +
      "Deletes/drains are blocked. Mutating commands require human approval.",
    inputSchema: z.object({
      command: z.string().describe("The kubectl command to run (without the 'kubectl' prefix)"),
    }),
    contextSchema: kubeScopeSchema,
    execute: async ({ command }, { abortSignal, context }) => runKubectl(command, context, abortSignal),
  }),

  bash: tool({
    description:
      "kubectl piped into text filters, for answers no other tool gives directly: counts by a field, grouping, " +
      "searching output (e.g. kubectl get pods --no-headers | awk '{print $3}' | sort | uniq -c). " +
      "Only kubectl plus filters reading stdin (jq, grep, awk, sed, sort, head, tail, wc, cut, uniq, tr, column); no files. " +
      "Context/namespace auto-injected. Mutating kubectl inside bash requires human approval.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to execute"),
    }),
    contextSchema: kubeScopeSchema,
    execute: async ({ command }, { abortSignal, context }) => {
      const level = classifyBashCommand(command);
      if (level === "block") return BLOCKED_REASON;
      const refusal = webAgentRefusal(command, "bash", level);
      if (refusal) return refusal;
      const scoped = injectNamespaceIntoBash(
        injectContextIntoBash(narrowBashToNamespace(command, context.namespace), context.context),
        context.namespace,
      );
      const repeatStop = checkRepeat(context.threadId, "bash", scoped);
      if (repeatStop) return repeatStop;
      if (level === "warn") logMutation("bash", scoped, context);
      // a shared server runs the pipeline without a shell: each command is spawned directly
      const output = await (isWebMode() ? executePipeline(scoped, abortSignal) : executeBash(scoped, abortSignal));
      recordCall(context.threadId, "bash", scoped, output);
      return output + (forbiddenHint(output) ?? "");
    },
  }),

  monitor_logs: tool({
    description:
      "Continuously tail new log lines from a pod. Returns only lines emitted since the previous call (per session). " +
      "Use this for watching, reproducing intermittent issues, or end-to-end debugging where you need fresh data. " +
      "Optional 'grep' filters lines to those matching a pattern (case-insensitive). " +
      "Optional 'sinceSeconds' (default 60) is only used on the very first call.",
    inputSchema: z.object({
      pod: token("pod").describe("Pod name (or 'deploy/<name>' / 'svc/<name>')"),
      namespace: token("namespace").optional().describe("Namespace"),
      container: token("container").optional().describe("Container name (for multi-container pods)"),
      grep: z.string().max(200).optional().describe("Case-insensitive substring/regex to filter lines"),
      sinceSeconds: z.number().int().positive().max(86_400).optional().describe("Initial lookback window in seconds (default 60)"),
    }),
    contextSchema: kubeScopeSchema,
    execute: async ({ pod, namespace, container, grep, sinceSeconds }, { abortSignal, context }) => {
      const ns = namespace || context.namespace;
      const cursorKey = [context.threadId, context.context || "default", ns, pod, container ?? ""].join("::");
      const previous = monitorCursors.get(cursorKey);
      const now = new Date().toISOString();
      const args = [
        "kubectl",
        context.context ? `--context=${context.context}` : "",
        `logs ${pod}`,
        ns ? `-n ${ns}` : "",
        container ? `-c ${container}` : "",
        previous ? `--since-time=${previous}` : `--since=${sinceSeconds ?? 60}s`,
        "--tail=500 --timestamps",
      ].filter(Boolean).join(" ");
      const line = grep ? `${args} | grep -i -- ${shellQuote(grep)}` : args;
      const r = await execCommand("sh", ["-c", line], getKubeconfigEnv(), abortSignal);
      rememberCursor(cursorKey, now);
      return truncate(r.stdout || r.stderr || "(no new lines)", "tail");
    },
  }),

  ask_human: tool({
    description:
      "Ask the human user a clarifying question and PAUSE the agent until they reply. " +
      "Use ONLY when you genuinely need information you cannot infer (e.g. 'which pod is the entrypoint?', " +
      "'what request id should I trace?', 'should I include the staging namespace too?'). " +
      "Prefer up to 4 short options when possible. Do NOT use this for confirmations of obvious actions.",
    inputSchema: z.object({
      question: z.string().describe("The question to ask the user (one sentence)"),
      options: z.array(z.string()).max(6).optional().describe("Optional short answer choices"),
    }),
  }),

  present_dashboard: tool({
    description:
      "Render a visual dashboard card in the chat: KPI metrics, charts (bar/line/area/pie), " +
      "ranked issues, and optional tables. REQUIRED for deployment/cluster health and dashboard requests " +
      "after 1–2 kubectl gathers. Use real numbers only. Then stop calling tools and give a short summary.",
    inputSchema: dashboardSchema,
    // the input is the payload the client renders; echo it back as the result
    execute: async (input) => JSON.stringify(input),
  }),
};

export type KubeTools = typeof kubeTools;

/** Names of the tools that need the cluster scope as their context. */
const SCOPED_TOOLS = ["k8s_list", "k8s_describe", "k8s_logs", "kubectl", "bash", "monitor_logs"] as const;

/** The per-tool context map for one request: every cluster tool gets the same scope. */
export function kubeToolsContext(scope: KubeScope) {
  return Object.fromEntries(SCOPED_TOOLS.map((name) => [name, scope])) as Record<(typeof SCOPED_TOOLS)[number], KubeScope>;
}
