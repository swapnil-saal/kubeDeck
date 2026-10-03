import { generateText, streamText } from "ai";
import {
  defaultMaxOutputTokens,
  getAiConfig,
  getLanguageModel,
  resolveModel,
} from "./provider";

export { getAiConfig, resolveModel };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const ONE_SHOT_TIMEOUT_MS = 90_000;

/** AI SDK v7 takes system prompts via `instructions`, not as messages. */
function splitSystem(messages: ChatMessage[]) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content);
  return {
    instructions: system.length > 0 ? system.join("\n\n") : undefined,
    messages: messages.filter((m) => m.role !== "system") as { role: "user" | "assistant"; content: string }[],
  };
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { useFastModel?: boolean },
): Promise<{ content: string; model: string }> {
  const { model, modelId, provider } = getLanguageModel({ useFastModel: opts?.useFastModel });
  const result = await generateText({
    model,
    ...splitSystem(messages),
    temperature: 0.3,
    maxOutputTokens: defaultMaxOutputTokens(provider),
    abortSignal: AbortSignal.timeout(ONE_SHOT_TIMEOUT_MS),
  });
  return { content: result.text, model: modelId };
}

export async function streamChatCompletion(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  opts?: { useFastModel?: boolean },
): Promise<{ model: string }> {
  const { model, modelId, provider } = getLanguageModel({ useFastModel: opts?.useFastModel });
  let streamError: unknown;
  const result = streamText({
    model,
    ...splitSystem(messages),
    temperature: 0.3,
    maxOutputTokens: defaultMaxOutputTokens(provider),
    abortSignal: AbortSignal.timeout(ONE_SHOT_TIMEOUT_MS),
    onError: ({ error }) => {
      streamError = error;
    },
  });
  for await (const text of result.textStream) {
    if (text) onChunk(text);
  }
  if (streamError) throw streamError instanceof Error ? streamError : new Error(String(streamError));
  return { model: modelId };
}
