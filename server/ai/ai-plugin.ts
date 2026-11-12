/**
 * The assistant's model provider, kept like a plugin: an admin sets it under Settings → AI assistant
 * (the desktop's own user does on the desktop), the API key is encrypted at rest and never sent back,
 * and what the server's environment sets (KUBEDECK_AI_*) wins and is shown read-only. It is always on
 * and stays off the Plugins page, which lists optional integrations.
 */
import { definePlugin, type PluginStore, updatePlugin } from "../plugins";
import { generateText } from "ai";
import { aiConfigured, aiSettingsFrom, type AiProviderSettings } from "../settings";
import { formatProviderError } from "./errors";

export const AI_PLUGIN = "ai";

const ENV: Record<string, keyof AiProviderSettings> = {
  KUBEDECK_AI_PROVIDER: "provider",
  KUBEDECK_AI_API_KEY: "apiKey",
  KUBEDECK_AI_MODEL: "model",
  KUBEDECK_AI_FAST_MODEL: "fastModel",
  KUBEDECK_AI_BASE_URL: "baseUrl",
};

definePlugin({
  id: AI_PLUGIN,
  name: "AI provider",
  description: "The model provider and models the assistant and AI features use.",
  category: "core",
  kind: "builtin",
  alwaysOn: true,
  listed: false,
  fields: [
    {
      key: "provider", label: "Provider", kind: "select",
      options: [
        { value: "openai", label: "OpenAI" }, { value: "anthropic", label: "Anthropic" },
        { value: "ollama", label: "Ollama" }, { value: "custom", label: "OpenAI-compatible" },
      ],
    },
    { key: "baseUrl", label: "Endpoint", kind: "url", help: "Needed for Ollama and OpenAI-compatible gateways." },
    { key: "apiKey", label: "API key", kind: "secret" },
    { key: "model", label: "Model", kind: "text" },
    { key: "fastModel", label: "Fast model", kind: "text", help: "For short tasks; empty uses the provider's small model." },
  ],
  // only variables that are set pin a field, so an admin can still set the rest
  fromEnv: (env) => Object.fromEntries(Object.entries(ENV).filter(([k]) => (env[k] ?? "").trim() !== "").map(([k, field]) => [field, env[k]!.trim()])),
  start: (ctx) => ({
    status() {
      const ai = aiSettingsFrom(ctx.values);
      if (!aiConfigured(ai)) return { state: "unconfigured", message: ai.provider === "custom" ? "Set the endpoint." : "Add an API key." };
      return { state: "ok", detail: `${ai.provider} · ${ai.model || "default model"}` };
    },
    /** "Test connection": one tiny request to the model */
    async test() {
      const ai = aiSettingsFrom(ctx.values);
      if (!aiConfigured(ai)) return { state: "unconfigured", message: ai.provider === "custom" ? "Set the endpoint." : "Add an API key." };
      try {
        const { getLanguageModel } = await import("./provider"); // provider.ts loads this module
        const { model, modelId } = getLanguageModel();
        await generateText({ model, instructions: "Respond with exactly: OK", prompt: "ping", maxOutputTokens: 512, abortSignal: AbortSignal.timeout(30_000) });
        return { state: "ok", detail: `${ai.provider} · ${modelId} answered` };
      } catch (err) {
        return { state: "error", message: formatProviderError(err) };
      }
    },
  }),
});

/**
 * Once: the desktop's AI settings from ~/.kubedeck/settings.json become this plugin's, so nobody has to
 * set them again. Skipped when the plugin was ever saved.
 */
export async function migrateAiSettings(store: PluginStore, legacy: Partial<AiProviderSettings> | undefined): Promise<void> {
  if (!legacy || (await store.all()).some((p) => p.id === AI_PLUGIN)) return;
  const values = Object.fromEntries(Object.entries(legacy).filter(([k, v]) => k in { provider: 1, apiKey: 1, model: 1, fastModel: 1, baseUrl: 1 } && typeof v === "string" && v));
  if (Object.keys(values).length === 0) return;
  await updatePlugin(AI_PLUGIN, { values }, "migration");
}
