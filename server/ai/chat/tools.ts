import { tool } from "ai";
import { z } from "zod";
import { getKubeconfigEnv } from "../../settings";
import {
  checkRepeat,
  classifyBashCommand,
  classifyKubectlCommand,
  execCommand,
  executeBash,
  executeKubectl,
  forbiddenHint,
  quoteArg,
  type TruncateBias,
  injectContextFlag,
  injectContextIntoBash,
  injectNamespaceFlag,
  injectNamespaceIntoBash,
  recordCall,
  sanitizeKubectlCommand,
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

export interface KubeToolScope {
  context: string;
  namespace: string;
  threadId: string;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

const monitorCursors = new Map<string, string>();

/**
 * All agent tools, bound to the cluster context / namespace of one request.
 *
 * Mutating kubectl / bash commands set `needsApproval`: the SDK pauses the
 * turn and the client resumes it with the user's approve / deny response.
 * `ask_human` has no `execute` — the client renders the question and supplies
 * the answer as the tool output.
 */
export function buildKubeTools({ context, namespace, threadId }: KubeToolScope) {
  async function runKubectl(command: string, signal?: AbortSignal, bias?: TruncateBias): Promise<string> {
    const sanitized = sanitizeKubectlCommand(command);
    if (classifyKubectlCommand(sanitized) === "block") {
      return `Blocked: '${command}' is a destructive operation. Use the KubeDeck UI or run it manually.`;
    }
    const scoped = injectNamespaceFlag(injectContextFlag(sanitized, context), namespace);
    const repeatStop = checkRepeat(threadId, "kubectl", scoped);
    if (repeatStop) return repeatStop;
    const output = await executeKubectl(scoped, { signal, bias });
    recordCall(threadId, "kubectl", scoped, output);
    return output + (forbiddenHint(output) ?? "");
  }

  return {
    k8s_list: tool({
      description:
        "List Kubernetes resources (preferred for inventory / health). " +
        "resource e.g. pods, deployments, services, nodes, events. " +
        "Use fieldSelector like status.phase!=Running for non-ready pods when needed. " +
        "Namespace auto-scoped unless allNamespaces=true.",
      inputSchema: z.object({
        resource: token("resource").describe("Resource type: pods, deployments, services, nodes, jobs, events, …"),
        name: token("name").optional().describe("Optional specific name filter"),
        allNamespaces: z.boolean().optional().describe("List across all namespaces (-A)"),
        labelSelector: labelSelector.optional().describe("Label selector, e.g. app=api or 'app in (a,b)'"),
        fieldSelector: token("fieldSelector").optional().describe("Field selector, e.g. status.phase=Failed"),
        wide: z.boolean().optional().describe("Use -o wide (more columns)"),
      }),
      execute: async ({ resource, allNamespaces, labelSelector, fieldSelector, wide, name }, { abortSignal }) => {
        let cmd = `get ${resource}`;
        if (name) cmd += ` ${name}`;
        if (allNamespaces) cmd += " -A";
        cmd += wide ? " -o wide" : " --no-headers";
        if (labelSelector) cmd += ` -l ${quoteArg(labelSelector.trim())}`;
        if (fieldSelector) cmd += ` --field-selector=${fieldSelector}`;
        return runKubectl(cmd, abortSignal);
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
      execute: async ({ resource, name, namespace: ns }, { abortSignal }) =>
        runKubectl(`describe ${resource} ${name}${ns ? ` -n ${ns}` : ""}`, abortSignal),
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
      execute: async ({ name, namespace: ns, container, tail, previous, since }, { abortSignal }) => {
        let cmd = `logs ${name} --tail=${tail ?? 100}`;
        if (ns) cmd += ` -n ${ns}`;
        if (container) cmd += ` -c ${container}`;
        if (previous) cmd += " --previous";
        if (since) cmd += ` --since=${since}`;
        // the newest lines (and the crash) are at the end of a log
        return runKubectl(cmd, abortSignal, "tail");
      },
    }),

    kubectl: tool({
      description:
        "Free-form kubectl (WITHOUT the 'kubectl' prefix). Prefer k8s_list / k8s_describe / k8s_logs first. " +
        "Context and namespace are auto-injected. Use -A for all namespaces. " +
        "Deletes/drains are blocked. Mutating commands require human approval.",
      inputSchema: z.object({
        command: z.string().describe("The kubectl command to run (without the 'kubectl' prefix)"),
      }),
      needsApproval: ({ command }) => classifyKubectlCommand(sanitizeKubectlCommand(command)) === "warn",
      execute: async ({ command }, { abortSignal }) => runKubectl(command, abortSignal),
    }),

    bash: tool({
      description:
        "Pipes only when table kubectl is insufficient (e.g. jq count). Prefer k8s_list for inventory. " +
        "Do NOT loop on jsonpath. Context/namespace auto-injected. " +
        "Mutating kubectl inside bash requires human approval.",
      inputSchema: z.object({
        command: z.string().describe("The shell command to execute"),
      }),
      needsApproval: ({ command }) => classifyBashCommand(command) === "warn",
      execute: async ({ command }, { abortSignal }) => {
        if (classifyBashCommand(command) === "block") {
          return "Blocked: this command is not allowed for safety reasons.";
        }
        const scoped = injectNamespaceIntoBash(injectContextIntoBash(command, context), namespace);
        const repeatStop = checkRepeat(threadId, "bash", scoped);
        if (repeatStop) return repeatStop;
        const output = await executeBash(scoped, abortSignal);
        recordCall(threadId, "bash", scoped, output);
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
        grep: z.string().optional().describe("Case-insensitive substring/regex to filter lines"),
        sinceSeconds: z.number().int().positive().optional().describe("Initial lookback window in seconds (default 60)"),
      }),
      execute: async ({ pod, namespace: ns, container, grep, sinceSeconds }, { abortSignal }) => {
        const nsFlag = ns ? `-n ${ns}` : "-A";
        const cont = container ? `-c ${container}` : "";
        const ctxFlag = context ? `--context=${context}` : "";
        const cursorKey = `${threadId}::${context || "default"}::${ns || ""}::${pod}::${container || ""}`;
        const previous = monitorCursors.get(cursorKey);
        const sinceFlag = previous ? `--since-time=${previous}` : `--since=${sinceSeconds || 60}s`;
        const now = new Date().toISOString();
        const baseCmd = `kubectl ${ctxFlag} logs ${pod} ${nsFlag} ${cont} ${sinceFlag} --tail=500 --timestamps`
          .replace(/\s+/g, " ")
          .trim();
        const fullCmd = grep ? `${baseCmd} | grep -i ${shellQuote(grep)}` : baseCmd;
        const r = await execCommand("sh", ["-c", fullCmd], getKubeconfigEnv(), abortSignal);
        monitorCursors.set(cursorKey, now);
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
      // No execute: answered client-side via addToolOutput.
    }),

    present_dashboard: tool({
      description:
        "Render a visual dashboard card in the chat: KPI metrics, charts (bar/line/area/pie), " +
        "ranked issues, and optional tables. REQUIRED for deployment/cluster health and dashboard requests " +
        "after 1–2 kubectl gathers. Use real numbers only. Then stop calling tools and give a short summary.",
      inputSchema: dashboardSchema,
      // The tool input is the payload the client Tool UI renders.
      execute: async (input) => JSON.stringify(input),
    }),
  };
}
