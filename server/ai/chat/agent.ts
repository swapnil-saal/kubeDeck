import { randomBytes } from "crypto";
import type { ServerResponse } from "http";
import {
  convertToModelMessages,
  pipeUIMessageStreamToResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { defaultMaxOutputTokens, getLanguageModel } from "../provider";
import { describeAccessLimits, resetAgentCallGuards } from "./kubectl";
import { buildSystemPrompt, parseAgentMode } from "./prompts";
import { buildKubeTools } from "./tools";

/** Hard backstop against tool-call loops (the discovery budget is enforced in kubectl.ts). */
const MAX_STEPS = 14;

/**
 * Signs approval requests so a client cannot forge an approval for a mutating
 * command it was never asked about. Per-process: a server restart invalidates
 * approvals that were still pending.
 */
const APPROVAL_SECRET = randomBytes(32);

export function formatProviderError(raw: string): string {
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

export interface KubeAgentRequest {
  messages: UIMessage[];
  threadId: string;
  /** kube context name; empty = kubeconfig default */
  context: string;
  /** active namespace; empty = not scoped */
  namespace: string;
  mode?: string;
  /** free-form session summary appended to the system prompt */
  sessionContext?: string;
}

/**
 * Run one agent turn and stream it to `res` as an AI SDK UI message stream.
 * History lives on the client; a request that ends with an approval response
 * (or an `ask_human` answer) continues the same assistant message.
 */
export async function streamKubeAgent(
  req: KubeAgentRequest,
  res: ServerResponse,
  abortSignal: AbortSignal,
): Promise<void> {
  const { model, provider } = getLanguageModel();
  const tools = buildKubeTools({ context: req.context, namespace: req.namespace, threadId: req.threadId });

  // A fresh user question resets the duplicate / budget guards; resuming after an
  // approval (last message is the assistant's) must not.
  if (req.messages[req.messages.length - 1]?.role === "user") resetAgentCallGuards(req.threadId);

  const result = streamText({
    model,
    instructions: buildSystemPrompt(req.sessionContext ?? "", parseAgentMode(req.mode), describeAccessLimits(req.threadId)),
    messages: await convertToModelMessages(req.messages, { tools }),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    temperature: 0.25,
    maxOutputTokens: defaultMaxOutputTokens(provider),
    abortSignal,
    experimental_toolApprovalSecret: APPROVAL_SECRET,
  });

  await pipeUIMessageStreamToResponse({
    response: res,
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: req.messages,
      onError: (error) => formatProviderError(error instanceof Error ? error.message : String(error)),
    }),
  });
}
