import { spawn } from "child_process";
import { getKubeconfigEnv } from "./settings";
import {
  chatCompletionWithTools,
  type AgentMessage,
  type ToolDefinition,
} from "./ai";

const MAX_ITERATIONS = 10;
const MAX_OUTPUT_LENGTH = 8000;
const MAX_SUB_AGENTS = 4;

// ═══════════════════════════════════════════════════
//  SYSTEM PROMPT
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
  delete <resource> <name> [-n ns]
  port-forward <pod|svc/name> <local>:<remote> [-n ns]
  config get-contexts | current-context | use-context <name>
  cluster-info
  api-resources [--namespaced=true]
  events [-n ns] [--sort-by=.lastTimestamp] [--field-selector=involvedObject.name=X]
  expose <resource> <name> --type=NodePort|ClusterIP|LoadBalancer --port=P [--target-port=TP] [-n ns]
  label|annotate <resource> <name> key=value [-n ns]
  cordon|uncordon|drain <node>

RESOURCE SHORTHANDS:
  po=pods, deploy=deployments, svc=services, ing=ingress, cm=configmaps,
  ns=namespaces, no=nodes, rs=replicasets, sts=statefulsets, ds=daemonsets,
  hpa=horizontalpodautoscalers, pvc=persistentvolumeclaims, pv=persistentvolumes,
  sa=serviceaccounts, cj=cronjobs, ep=endpoints

MULTI-RESOURCE QUERY PATTERNS:
  kubectl get pods,svc -n default
  kubectl get all -n default
  kubectl get events --field-selector reason=Failed -n default

PIPING PATTERNS (use bash tool):
  kubectl get pods -A --no-headers | wc -l
  kubectl get pods -A --no-headers | grep -v Running
  kubectl top pods -n default --no-headers | sort -k3 -rn | head -5
  kubectl get pods -o json | jq '.items[] | select(.status.phase != "Running")'
`;

const AGENT_SYSTEM_PROMPT = `You are KubeDeck AI — a Kubernetes expert with live cluster access through tools.

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
- If a command fails, try an alternative approach before giving up
- BLOCKED (destructive): delete, drain, cordon, taint — explain what WOULD be done, do not execute

KUBECTL SYNTAX — MUST FOLLOW:
- Flags go AFTER the verb and resource: "get pods -n default --context=mycluster"
- NEVER put flags before the verb: "--context=mycluster get pods" is WRONG
- The --context and -n flags are added automatically — do NOT add them yourself unless the user specifies a different context/namespace
${KUBECTL_CHEATSHEET}
PARALLEL SUB-AGENTS:
- For complex questions that touch multiple areas (e.g. "give me a full cluster health report"), use the parallel_tasks tool to decompose into independent sub-tasks.
- Each sub-task runs its own mini-agent with kubectl/bash access, executing simultaneously for speed.
- After all sub-tasks complete, synthesize their findings into one cohesive answer.
- Only use parallel_tasks for genuinely multi-faceted questions. Simple queries should use kubectl/bash directly.

RESPONSE FORMAT:
- Be concise — use markdown headers, bold, code blocks, and lists
- Always include specific data from command output
- If unsure, say so — never hallucinate`;

// ═══════════════════════════════════════════════════
//  TOOL DEFINITIONS
// ═══════════════════════════════════════════════════

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "kubectl",
    description:
      "Execute a kubectl command against the Kubernetes cluster. " +
      "The command string should NOT include the 'kubectl' prefix. " +
      "Examples: 'get pods -n default', 'describe pod my-pod -n kube-system', " +
      "'logs my-pod --tail=100 -n default', 'top pods -n monitoring'.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The kubectl command to run (without the 'kubectl' prefix)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "bash",
    description:
      "Execute a shell command. Useful for piping kubectl output through grep, awk, sort, wc, jq, etc. " +
      "Include the full command including 'kubectl' if needed. " +
      "Examples: 'kubectl get pods --no-headers -A | wc -l', " +
      "'kubectl top pods -n default | sort -k3 -rn | head -5'.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "parallel_tasks",
    description:
      "Decompose a complex question into multiple independent sub-tasks that can be investigated in parallel. " +
      "Use this when a question requires gathering data from multiple unrelated areas (e.g. checking pods AND services AND logs simultaneously). " +
      "Each sub-task gets its own agent that runs kubectl/bash commands independently. Results are gathered and you synthesize a final answer. " +
      "Do NOT use this for simple single-command questions.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "Array of sub-tasks to run in parallel (max 4)",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Short identifier for this sub-task" },
              goal: { type: "string", description: "What this sub-task should investigate or find out" },
            },
            required: ["id", "goal"],
          },
        },
      },
      required: ["tasks"],
    },
  },
];

// ═══════════════════════════════════════════════════
//  SAFETY CLASSIFIER
// ═══════════════════════════════════════════════════

const READ_ONLY_VERBS = new Set([
  "get", "describe", "logs", "log", "top", "explain",
  "api-resources", "api-versions", "version", "auth",
  "cluster-info", "diff", "events", "wait",
]);

const BLOCKED_VERBS = new Set([
  "delete", "drain", "cordon", "uncordon", "taint",
]);

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
    const blockedArr = Array.from(BLOCKED_VERBS);
    for (let i = 0; i < blockedArr.length; i++) {
      if (new RegExp(`kubectl\\s+${blockedArr[i]}\\b`).test(trimmed)) return "block";
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
  if (firstCmd && !ALLOWED_BASH_PREFIXES.includes(firstCmd)) {
    if (!trimmed.includes("kubectl")) return "block";
  }

  return "allow";
}

/**
 * Fix common kubectl syntax errors:
 * - Flags before the verb: "--context=X get pods" → "get pods --context=X"
 * - "cluster info" → "cluster-info"
 */
function sanitizeKubectlCommand(command: string): string {
  let cmd = command.trim();

  // Fix "cluster info" → "cluster-info"
  cmd = cmd.replace(/\bcluster\s+info\b/gi, "cluster-info");

  // Fix flags placed before the verb: extract leading flags, move them to end
  const leadingFlags: string[] = [];
  const tokens = cmd.split(/\s+/);
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
  // Insert --context after the verb (first token)
  return [parts[0], `--context=${context}`, ...parts.slice(1)].join(" ");
}

function injectContextIntoBash(command: string, context: string): string {
  if (!context || command.includes("--context")) return command;
  // For bash commands, find each "kubectl <verb>" and inject --context after it
  return command.replace(/kubectl\s+(\S+)/g, `kubectl $1 --context=${context}`);
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
    proc.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: 1 });
    });
  });
}

async function executeKubectl(command: string): Promise<{ output: string; code: number }> {
  const env = getKubeconfigEnv();

  if (command.includes("|") || command.includes(">") || command.includes("&&")) {
    const r = await execCommand("sh", ["-c", `kubectl ${command}`], env);
    return { output: truncate(r.stdout || r.stderr || "(no output)"), code: r.code };
  }

  const args = command.trim().split(/\s+/);
  const r = await execCommand("kubectl", args, env);
  return { output: truncate(r.stdout || r.stderr || "(no output)"), code: r.code };
}

async function executeBash(command: string): Promise<{ output: string; code: number }> {
  const env = getKubeconfigEnv();
  const r = await execCommand("sh", ["-c", command], env);
  return { output: truncate(r.stdout || r.stderr || "(no output)"), code: r.code };
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_LENGTH
    ? text.slice(0, MAX_OUTPUT_LENGTH) + "\n... (truncated)"
    : text;
}

// ═══════════════════════════════════════════════════
//  AGENT EVENT TYPES
// ═══════════════════════════════════════════════════

export type AgentEvent =
  | { exec_start: string }
  | { exec_result: string; exit_code: number }
  | { text: string }
  | { thinking: string }
  | { sub_agent_start: string; id: string }
  | { sub_agent_done: string; id: string; result: string }
  | { done: true; model: string; iterations: number }
  | { error: string };

// ═══════════════════════════════════════════════════
//  SUB-AGENT RUNNER
// ═══════════════════════════════════════════════════

const SUB_AGENT_TOOLS: ToolDefinition[] = TOOL_DEFINITIONS.filter(t => t.name !== "parallel_tasks");

async function runSubAgent(
  goal: string,
  currentContext: string,
  systemContext: string,
): Promise<string> {
  const subPrompt = `You are a focused Kubernetes investigation sub-agent. Your ONLY job is to answer this specific question by running kubectl/bash commands:

"${goal}"

KUBECTL SYNTAX (flags go AFTER verb, never before):
  kubectl <verb> <resource> [name] [flags]
  CORRECT: get pods -n default --context=mycluster
  WRONG:   --context=mycluster get pods

Rules:
- Run the minimum commands needed to answer this question
- Return a concise summary of your findings with specific data
- Do NOT use parallel_tasks — you are already a sub-agent
- The --context flag is auto-injected — do NOT add it yourself
${systemContext ? `\nContext info: ${systemContext}` : ""}`;

  const messages: AgentMessage[] = [
    { role: "system", content: subPrompt },
    { role: "user", content: goal },
  ];

  let result = "";
  let iterations = 0;

  while (iterations < 5) {
    iterations++;
    try {
      const response = await chatCompletionWithTools(messages, SUB_AGENT_TOOLS);

      let content = response.content || "";
      content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

      if (response.toolCalls?.length) {
        messages.push({
          role: "assistant",
          content: content || undefined,
          toolCalls: response.toolCalls,
        });

        for (const tc of response.toolCalls) {
          const cmd = tc.arguments?.command;
          if (!cmd) {
            messages.push({ role: "tool", toolCallId: tc.id, content: "Error: no command" });
            continue;
          }

          let output: string;
          if (tc.name === "kubectl") {
            let c = sanitizeKubectlCommand(cmd);
            c = injectContextFlag(c, currentContext);
            const safety = classifyKubectlCommand(sanitizeKubectlCommand(cmd));
            if (safety === "block") {
              output = `Blocked: '${cmd}' is destructive.`;
            } else {
              const r = await executeKubectl(c);
              output = r.output;
            }
          } else if (tc.name === "bash") {
            let c = cmd;
            c = injectContextIntoBash(c, currentContext);
            const safety = classifyBashCommand(cmd);
            if (safety === "block") {
              output = `Blocked: command not allowed.`;
            } else {
              const r = await executeBash(c);
              output = r.output;
            }
          } else {
            output = `Unknown tool: ${tc.name}`;
          }

          messages.push({ role: "tool", toolCallId: tc.id, content: output });
        }
        continue;
      }

      result = content || "No findings.";
      break;
    } catch (err: any) {
      result = `Sub-agent error: ${err.message}`;
      break;
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════
//  AGENT LOOP
// ═══════════════════════════════════════════════════

export async function runAgent(
  userMessages: Array<{ role: string; content: string }>,
  emit: (event: AgentEvent) => void,
): Promise<void> {
  const clientSystemMsg = userMessages[0]?.role === "system" ? userMessages[0].content : "";
  const systemContent = clientSystemMsg
    ? AGENT_SYSTEM_PROMPT + "\n\nCurrent session context:\n" + clientSystemMsg
    : AGENT_SYSTEM_PROMPT;

  // Extract k8s context from the client system message for --context injection
  const ctxMatch = clientSystemMsg.match(/Context:\s*([^\s,\]]+)/i);
  const currentContext = ctxMatch?.[1] && ctxMatch[1] !== "default" ? ctxMatch[1] : "";

  const agentMessages: AgentMessage[] = [
    { role: "system", content: systemContent },
    ...userMessages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role as AgentMessage["role"], content: m.content })),
  ];

  let model = "";
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`[agent] iteration ${iteration}/${MAX_ITERATIONS}`);

    try {
      const result = await chatCompletionWithTools(agentMessages, TOOL_DEFINITIONS);
      model = result.model;

      // Extract <think>...</think> blocks from content (qwen3.5, gemma4, etc.)
      let mainContent = result.content || "";
      const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
      let thinkMatch: RegExpExecArray | null;
      while ((thinkMatch = thinkRegex.exec(mainContent)) !== null) {
        const thinkText = thinkMatch[1].trim();
        if (thinkText) emit({ thinking: thinkText });
      }
      mainContent = mainContent.replace(thinkRegex, "").trim();

      if (mainContent && result.toolCalls?.length) {
        emit({ thinking: mainContent });
      }

      if (result.toolCalls?.length) {
        agentMessages.push({
          role: "assistant",
          content: result.content || undefined,
          toolCalls: result.toolCalls,
        });

        for (const tc of result.toolCalls) {
          let output: string;
          let code: number;

          if (tc.name === "parallel_tasks") {
            // parallel_tasks uses 'tasks' not 'command' — handle separately
            const tasks = (tc.arguments?.tasks || []).slice(0, MAX_SUB_AGENTS) as Array<{ id: string; goal: string }>;
            if (tasks.length === 0) {
              output = "No tasks provided.";
              code = 1;
            } else {
              emit({ thinking: `Decomposing into ${tasks.length} parallel sub-agents...` });
              for (const t of tasks) {
                emit({ sub_agent_start: t.goal, id: t.id });
              }

              const results = await Promise.all(
                tasks.map(async (t) => {
                  try {
                    const r = await runSubAgent(t.goal, currentContext, clientSystemMsg);
                    emit({ sub_agent_done: t.goal, id: t.id, result: r.slice(0, 500) });
                    return { id: t.id, goal: t.goal, result: r };
                  } catch (err: any) {
                    const errMsg = `Error: ${err.message}`;
                    emit({ sub_agent_done: t.goal, id: t.id, result: errMsg });
                    return { id: t.id, goal: t.goal, result: errMsg };
                  }
                }),
              );

              output = results.map(r => `## Sub-task: ${r.id}\n**Goal:** ${r.goal}\n**Findings:**\n${r.result}`).join("\n\n---\n\n");
              code = 0;
            }
            agentMessages.push({ role: "tool", toolCallId: tc.id, content: output });
            continue;
          }

          const toolCommand = tc.arguments?.command;
          if (!toolCommand) {
            agentMessages.push({ role: "tool", toolCallId: tc.id, content: "Error: no command provided" });
            continue;
          }

          if (tc.name === "kubectl") {
            let cmd = sanitizeKubectlCommand(toolCommand);
            cmd = injectContextFlag(cmd, currentContext);
            const safety = classifyKubectlCommand(sanitizeKubectlCommand(toolCommand));
            if (safety === "block") {
              output = `Blocked: '${toolCommand}' is a destructive operation. Use the KubeDeck UI or run it manually.`;
              code = 1;
              emit({ exec_start: `kubectl ${toolCommand}` });
              emit({ exec_result: output, exit_code: code });
            } else {
              if (safety === "warn") {
                console.log(`[agent] mutation command: kubectl ${cmd}`);
              }
              emit({ exec_start: `kubectl ${cmd}` });
              const r = await executeKubectl(cmd);
              output = r.output;
              code = r.code;
              emit({ exec_result: output, exit_code: code });
            }
          } else if (tc.name === "bash") {
            let cmd = injectContextIntoBash(toolCommand, currentContext);
            const safety = classifyBashCommand(toolCommand);
            if (safety === "block") {
              output = `Blocked: this command is not allowed for safety reasons.`;
              code = 1;
              emit({ exec_start: toolCommand });
              emit({ exec_result: output, exit_code: code });
            } else {
              emit({ exec_start: cmd });
              const r = await executeBash(cmd);
              output = r.output;
              code = r.code;
              emit({ exec_result: output, exit_code: code });
            }
          } else {
            output = `Unknown tool: ${tc.name}`;
            code = 1;
          }

          agentMessages.push({ role: "tool", toolCallId: tc.id, content: output });
        }

        continue;
      }

      // No tool calls — final text response
      if (mainContent) {
        emit({ text: mainContent });
      } else {
        emit({ text: "I wasn't able to generate a response. Please try rephrasing your question." });
      }
      break;
    } catch (err: any) {
      console.error(`[agent] iteration ${iteration} error:`, err.message);
      emit({ error: err.message || "Agent error" });
      return;
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    emit({ text: "\n\n*Reached maximum tool iterations. Showing results so far.*" });
  }

  emit({ done: true, model, iterations: iteration });
}
