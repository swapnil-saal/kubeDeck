import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { loadSettings, type AiProviderSettings } from "./settings";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const DEFAULTS: Record<string, { baseUrl: string; defaultModel: string; defaultFastModel: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", defaultFastModel: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com", defaultModel: "claude-3-5-haiku-20241022", defaultFastModel: "claude-3-5-haiku-20241022" },
  ollama: { baseUrl: "http://localhost:11434", defaultModel: "llama3.2", defaultFastModel: "qwen3.5:0.8b" },
  custom: { baseUrl: "", defaultModel: "", defaultFastModel: "" },
};

export function getAiConfig(): AiProviderSettings {
  const settings = loadSettings();
  return settings.ai || { provider: "openai", apiKey: "", model: "gpt-4o-mini", baseUrl: "" };
}

export function resolveModel(config: AiProviderSettings, useFastModel?: boolean): string {
  if (useFastModel) {
    return config.fastModel
      || DEFAULTS[config.provider]?.defaultFastModel
      || config.model
      || DEFAULTS[config.provider]?.defaultModel
      || "gpt-4o-mini";
  }
  return config.model || DEFAULTS[config.provider]?.defaultModel || "gpt-4o-mini";
}

export interface ChatModelOptions {
  useFastModel?: boolean;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
}

/**
 * Build a LangChain BaseChatModel from current AI settings.
 * Used by both the simple completion helpers and the deep agent.
 */
export function getChatModel(opts: ChatModelOptions = {}): BaseChatModel {
  const config = getAiConfig();
  if (!config.apiKey && config.provider !== "ollama") {
    throw new Error(`No API key configured for ${config.provider}. Go to Settings → AI to add one.`);
  }
  const model = resolveModel(config, opts.useFastModel);
  const temperature = opts.temperature ?? 0.3;
  const maxTokens = opts.maxTokens ?? 2048;
  const streaming = opts.streaming ?? false;

  if (config.provider === "anthropic") {
    return new ChatAnthropic({
      model,
      apiKey: config.apiKey,
      temperature,
      maxTokens,
      streaming,
    }) as unknown as BaseChatModel;
  }

  if (config.provider === "ollama") {
    return new ChatOllama({
      model,
      baseUrl: config.baseUrl || DEFAULTS.ollama.baseUrl,
      temperature,
      streaming,
    }) as unknown as BaseChatModel;
  }

  // openai or openai-compatible "custom"
  const baseURL = config.baseUrl || DEFAULTS[config.provider]?.baseUrl || DEFAULTS.openai.baseUrl;
  return new ChatOpenAI({
    model,
    apiKey: config.apiKey || "EMPTY",
    temperature,
    maxTokens,
    streaming,
    configuration: { baseURL },
  }) as unknown as BaseChatModel;
}

function toLcMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((m) => {
    if (m.role === "system") return new SystemMessage(m.content);
    if (m.role === "assistant") return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === "string" ? part : part?.text || ""))
      .join("");
  }
  return "";
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { useFastModel?: boolean },
): Promise<{ content: string; model: string }> {
  const config = getAiConfig();
  const model = resolveModel(config, opts?.useFastModel);
  const llm = getChatModel({ useFastModel: opts?.useFastModel });
  const result = await llm.invoke(toLcMessages(messages));
  return { content: extractText(result.content), model };
}

export async function streamChatCompletion(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  opts?: { useFastModel?: boolean },
): Promise<{ model: string }> {
  const config = getAiConfig();
  const model = resolveModel(config, opts?.useFastModel);
  const llm = getChatModel({ useFastModel: opts?.useFastModel, streaming: true });
  const stream = await llm.stream(toLcMessages(messages));
  for await (const chunk of stream) {
    const text = extractText(chunk.content);
    if (text) onChunk(text);
  }
  return { model };
}
