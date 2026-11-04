import { randomBytes } from "crypto";
import type { ServerResponse } from "http";
import {
  ToolLoopAgent,
  isStepCount,
  pipeAgentUIStreamToResponse,
  validateUIMessages,
  type InferAgentUIMessage,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import { formatProviderError } from "../errors";
import { defaultMaxOutputTokens, getLanguageModel } from "../provider";
import { describeAccessLimits, resetAgentCallGuards } from "./kubectl";
import { buildSystemPrompt, parseAgentMode } from "./prompts";
import { kubeScopeSchema, kubeToolApproval, kubeTools, kubeToolsContext } from "./tools";

/** Hard backstop against tool-call loops (the discovery budget is enforced in kubectl.ts). */
const MAX_STEPS = 14;

/**
 * Signs approval requests so a client cannot forge an approval for a command it was
 * never asked about. Per process: a server restart invalidates approvals still pending.
 */
const APPROVAL_SECRET = randomBytes(32);

/** What one agent request carries besides the messages. */
export const agentCallOptionsSchema = z.object({
  scope: kubeScopeSchema,
  /** chat | troubleshoot | briefing | investigate */
  mode: z.string().optional(),
  /** free-form session summary from the client, appended to the instructions */
  sessionContext: z.string().max(10_000).optional(),
});
export type AgentCallOptions = z.infer<typeof agentCallOptionsSchema>;

function createKubeAgent(model: LanguageModel) {
  return new ToolLoopAgent({
    id: "kubedeck",
    model,
    tools: kubeTools,
    // the real scope arrives with each request (prepareCall); this default is never used for a call
    toolsContext: kubeToolsContext({ context: "", namespace: "", threadId: "", user: "" }),
    callOptionsSchema: agentCallOptionsSchema,
    toolApproval: kubeToolApproval,
    experimental_toolApprovalSecret: APPROVAL_SECRET,
    stopWhen: isStepCount(MAX_STEPS),
    temperature: 0.25,
    // Settings can change between requests, so the model and prompt are resolved per call.
    prepareCall: ({ options, ...settings }) => {
      const { model: current, provider } = getLanguageModel();
      return {
        ...settings,
        model: current,
        maxOutputTokens: defaultMaxOutputTokens(provider),
        instructions: buildSystemPrompt(
          options.sessionContext ?? "",
          parseAgentMode(options.mode),
          describeAccessLimits(options.scope.threadId),
          options.scope,
        ),
        toolsContext: kubeToolsContext(options.scope),
      };
    },
  });
}

type KubeAgent = ReturnType<typeof createKubeAgent>;

/** A chat message with KubeDeck's typed tool parts. */
export type KubeAgentUIMessage = InferAgentUIMessage<KubeAgent>;

/** One audit line per approval decision the browser sends, so every change to a cluster can be traced. */
function logApprovalResponses(messages: KubeAgentUIMessage[], threadId: string, user: string): void {
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant") return;
  for (const part of last.parts) {
    if (!("approval" in part) || part.state !== "approval-responded" || !part.approval) continue;
    const input = "input" in part ? (part.input as { command?: string }) : undefined;
    console.log(
      `[kubedeck:agent] approval ${part.approval.approved ? "GRANTED" : "denied"}${user ? ` user=${JSON.stringify(user)}` : ""} thread=${threadId} ` +
        `tool=${part.type.replace(/^tool-/, "")} command=${JSON.stringify(input?.command ?? "")}`,
    );
  }
}

let agent: KubeAgent | undefined;

/** The KubeDeck agent. Built on first use, so a missing AI configuration surfaces as a request error. */
export function getKubeAgent() {
  agent ??= createKubeAgent(getLanguageModel().model);
  return agent;
}

/**
 * Run one agent turn and stream it to `response` as an AI SDK UI message stream.
 * History lives on the client; a request that ends with an approval response
 * (or an `ask_human` answer) continues the same assistant message.
 */
export async function streamKubeAgent(
  { messages, options }: { messages: unknown[]; options: AgentCallOptions },
  response: ServerResponse,
  abortSignal: AbortSignal,
): Promise<void> {
  const kubeAgent = getKubeAgent();
  const uiMessages = await validateUIMessages<KubeAgentUIMessage>({ messages, tools: kubeAgent.tools });

  logApprovalResponses(uiMessages, options.scope.threadId, options.scope.user);

  // A fresh user question resets the duplicate / budget guards; resuming after an approval must not.
  if (uiMessages[uiMessages.length - 1]?.role === "user") resetAgentCallGuards(options.scope.threadId);

  await pipeAgentUIStreamToResponse({
    response,
    agent: kubeAgent,
    uiMessages,
    options,
    abortSignal,
    originalMessages: uiMessages,
    onError: formatProviderError,
  });
}
