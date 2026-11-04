import { APICallError } from "ai";
import { isWebMode } from "../web-mode";

/** Where the AI provider is configured: the Settings page, or the server's environment on a shared KubeDeck. */
export function aiSettingsPlace(): string {
  return isWebMode() ? "the server's KUBEDECK_AI_* settings (ask whoever runs this KubeDeck)" : "Settings → AI";
}

/** Turn a provider failure into a message that tells the user what to fix, and where. */
export function formatProviderError(error: unknown): string {
  const place = aiSettingsPlace();
  const raw = error instanceof Error ? error.message : String(error);
  const status = APICallError.isInstance(error) ? error.statusCode : undefined;
  const lower = raw.toLowerCase();
  const detail = raw.slice(0, 200);

  if (lower.includes("context length") || lower.includes("too many tokens")) {
    return `The request is larger than the model's context window. Try a shorter question or a model with a larger context. (${detail})`;
  }
  if (status === 401 || status === 403 || lower.includes("unauthorized") || lower.includes("invalid api key")) {
    return `The AI provider rejected the API key. Update it in ${place}. (${detail})`;
  }
  if (status === 404 || (lower.includes("404") && lower.includes("model"))) {
    return `The AI model was not found. Pick a model your provider serves in ${place}. (${detail})`;
  }
  if (status === 503 || lower.includes("no healthy upstream") || lower.includes("ring-balancer")) {
    return `The AI provider is unavailable (503). Check the base URL and model in ${place}. (${detail})`;
  }
  if (lower.includes("econnrefused") || lower.includes("fetch failed")) {
    return `Could not reach the AI provider. Check the base URL in ${place}. (${detail})`;
  }
  return raw;
}
