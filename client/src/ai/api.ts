/**
 * One-shot `/api/ai/*` calls. Non-AI code reaches the AI server only through
 * these functions (re-exported from `@/ai`), never by fetching the endpoints.
 */

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

export interface TranslateRequest {
  prompt: string;
  context?: string;
  namespace?: string;
  /** Resource names per kind, so the translator can resolve fuzzy names. */
  resources: Record<string, string[]>;
}

/** Natural language → a single kubectl command. Returns "" when the model gave nothing. */
export async function translateToKubectl(req: TranslateRequest): Promise<string> {
  const res = await fetch("/api/ai/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error("Translation failed");
  const data = await res.json();
  return (data.command || "").trim();
}

export interface ClusterBriefingRequest {
  context: string;
  namespace: string;
  signals: Record<string, unknown>;
}

/** Short SRE-style markdown briefing for a set of health signals. */
export async function fetchClusterBriefing(req: ClusterBriefingRequest): Promise<string> {
  const res = await fetch("/api/ai/cluster-briefing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Failed" }));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  const body = await res.json();
  return body.briefing || "";
}

export interface AiConnectionResult {
  ok: boolean;
  model?: string;
  message?: string;
}

/** Pings the saved AI provider config. */
export async function testAiConnection(): Promise<AiConnectionResult> {
  const res = await fetch("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" } });
  return res.json();
}
