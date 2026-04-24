import { spawn } from "child_process";
import { getKubeconfigEnv } from "./settings";
import {
  chatCompletionWithTools,
  type AgentMessage,
  type ToolDefinition,
} from "./ai";

const MAX_ITERATIONS = 10;
const MAX_OUTPUT_LENGTH = 8000;

// ═══════════════════════════════════════════════════
//  SYSTEM PROMPT
// ═══════════════════════════════════════════════════

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
- For destructive operations (delete, drain, cordon, taint), explain what would be done instead of executing

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

  const dangerous = ["rm ", "rm -", "rmdir", "mkfs", "dd ", "shutdown", "reboot", "kill ", "killall"];
  for (const d of dangerous) {
    if (trimmed.startsWith(d) || trimmed.includes(` ${d}`)) return "block";
  }

  return "allow";
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
  | { done: true; model: string; iterations: number }
  | { error: string };

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

      if (result.content && result.toolCalls?.length) {
        emit({ thinking: result.content });
      }

      if (result.toolCalls?.length) {
        agentMessages.push({
          role: "assistant",
          content: result.content || undefined,
          toolCalls: result.toolCalls,
        });

        for (const tc of result.toolCalls) {
          const toolCommand = tc.arguments?.command;
          if (!toolCommand) {
            agentMessages.push({ role: "tool", toolCallId: tc.id, content: "Error: no command provided" });
            continue;
          }

          let output: string;
          let code: number;

          if (tc.name === "kubectl") {
            let cmd = toolCommand;
            // Inject --context flag if we have a context and it's not already in the command
            if (currentContext && !cmd.includes("--context")) {
              cmd = `--context=${currentContext} ${cmd}`;
            }
            const safety = classifyKubectlCommand(toolCommand);
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
            let cmd = toolCommand;
            // Inject --context into kubectl commands within bash pipes
            if (currentContext && cmd.includes("kubectl") && !cmd.includes("--context")) {
              cmd = cmd.replace(/kubectl\s+/g, `kubectl --context=${currentContext} `);
            }
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
      if (result.content) {
        emit({ text: result.content });
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
