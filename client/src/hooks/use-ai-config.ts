import { useMemo } from "react";
import { useSettings } from "./use-settings";

const FAST_MODELS = new Set([
  "qwen3.5:0.8b",
  "qwen3.5:2b",
  "gpt-4o-mini",
  "gpt-3.5-turbo",
  "phi3",
  "gemma2",
  "gemma4:e2b",
  "llama3.2",
]);

function isFastModelName(model: string): boolean {
  if (FAST_MODELS.has(model)) return true;
  if (model.startsWith("claude-3-5-haiku")) return true;
  if (model.startsWith("qwen3.5")) return true;
  const sizeSuffix = model.match(/:(\d+(?:\.\d+)?)b$/i);
  if (sizeSuffix && parseFloat(sizeSuffix[1]) <= 8) return true;
  return false;
}

export function useAiConfig() {
  const { data: settings } = useSettings();

  return useMemo(() => {
    const provider = settings?.ai?.provider || "openai";
    const model = settings?.ai?.model || "";
    const isConfigured = !!(
      settings?.ai?.apiKey || provider === "ollama"
    );
    const isFast = isConfigured && isFastModelName(model);

    return { provider, model, isFastModel: isFast, isConfigured };
  }, [settings?.ai]);
}

export async function fetchAiSuggestion(
  prompt: string,
  maxTokens = 200,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/ai/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, maxTokens }),
    signal,
  });
  if (!res.ok) throw new Error(`AI suggest failed: ${res.status}`);
  const data = await res.json();
  return data.suggestion || "";
}
