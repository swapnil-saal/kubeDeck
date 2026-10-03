import { useMemo } from "react";
import { useSettings } from "@/hooks/use-settings";

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
    const fastModel = settings?.ai?.fastModel || "";
    const isConfigured = !!(
      settings?.ai?.apiKey || provider === "ollama"
    );
    const isFast = isConfigured && isFastModelName(model);
    const hasFastModel = isConfigured && !!fastModel;

    return { provider, model, fastModel, isFastModel: isFast, hasFastModel, isConfigured };
  }, [settings?.ai]);
}
