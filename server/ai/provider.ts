import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { loadSettings, type AiProviderSettings } from "../settings";
import { aiSettingsPlace } from "./errors";

export const DEFAULTS: Record<string, { baseUrl: string; defaultModel: string; defaultFastModel: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", defaultFastModel: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-5-5", defaultFastModel: "claude-haiku-5-5" },
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

export interface LanguageModelOptions {
  useFastModel?: boolean;
}

export interface ResolvedModel {
  model: LanguageModel;
  modelId: string;
  provider: AiProviderSettings["provider"];
}

/** Anthropic's base URL setting may omit the `/v1` suffix the AI SDK expects. */
function anthropicBaseUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/**
 * Build an AI SDK language model from the saved AI settings.
 *
 * `custom` and `ollama` go through the OpenAI-compatible provider, which reads
 * the non-standard `reasoning` / `reasoning_content` fields (vLLM, Ollama) as
 * reasoning parts — they never end up in the answer text.
 */
export function getLanguageModel(opts: LanguageModelOptions = {}): ResolvedModel {
  const config = getAiConfig();
  if (!config.apiKey && config.provider !== "ollama" && config.provider !== "custom") {
    throw new Error(`No API key configured for ${config.provider}. Add one in ${aiSettingsPlace()}.`);
  }
  const modelId = resolveModel(config, opts.useFastModel);
  const provider = config.provider;

  if (provider === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: config.apiKey,
      baseURL: anthropicBaseUrl(config.baseUrl || DEFAULTS.anthropic.baseUrl),
    });
    return { model: anthropic(modelId), modelId, provider };
  }

  if (provider === "ollama") {
    const base = (config.baseUrl || DEFAULTS.ollama.baseUrl).replace(/\/+$/, "").replace(/\/v1$/, "");
    const ollama = createOpenAICompatible({ name: "ollama", baseURL: `${base}/v1`, apiKey: config.apiKey || undefined });
    return { model: ollama.chatModel(modelId), modelId, provider };
  }

  if (provider === "custom") {
    if (!config.baseUrl) {
      throw new Error(`No base URL configured for the custom provider. Add one in ${aiSettingsPlace()}.`);
    }
    const custom = createOpenAICompatible({
      name: "custom",
      baseURL: config.baseUrl.replace(/\/+$/, ""),
      apiKey: config.apiKey || undefined,
      includeUsage: true,
    });
    return { model: custom.chatModel(modelId), modelId, provider };
  }

  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: (config.baseUrl || DEFAULTS.openai.baseUrl).replace(/\/+$/, ""),
  });
  return { model: openai.chat(modelId), modelId, provider };
}

/**
 * Output-token budget. Reasoning models (vLLM gateways, o-series) spend part of
 * it thinking before any answer text appears, so a small cap yields an empty
 * answer with `finishReason: "length"`.
 */
export function defaultMaxOutputTokens(provider: AiProviderSettings["provider"]): number {
  return provider === "custom" ? 8192 : 2048;
}
