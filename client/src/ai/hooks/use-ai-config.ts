import { useMemo } from "react";
import { useSettings } from "@/hooks/use-settings";

/** A small, cheap model by its name: haiku / mini / nano / flash / small, or ≤ 8B parameters. */
export function isFastModelName(model: string): boolean {
  if (/(^|[-:._])(haiku|mini|nano|flash|small|lite)([-:._]|$)/i.test(model)) return true;
  const size = model.match(/[:-](\d+(?:\.\d+)?)b\b/i);
  return !!size && Number.parseFloat(size[1]) <= 8;
}

export function useAiConfig() {
  const { data: settings } = useSettings();

  return useMemo(() => {
    const provider = settings?.ai?.provider || "openai";
    const model = settings?.ai?.model || "";
    const fastModel = settings?.ai?.fastModel || "";
    // a shared KubeDeck keeps its key on the server and says whether it has one
    const isConfigured = settings?.ai?.configured ?? !!(
      settings?.ai?.apiKey || provider === "ollama" || (provider === "custom" && settings?.ai?.baseUrl)
    );
    const hasFastModel = isConfigured && !!fastModel;
    // quick features (event summaries, status hints) run on the fast model: on once one is set,
    // or when the main model is itself a small one
    const isFast = hasFastModel || (isConfigured && isFastModelName(model));

    return { provider, model, fastModel, isFastModel: isFast, hasFastModel, isConfigured };
  }, [settings?.ai]);
}
