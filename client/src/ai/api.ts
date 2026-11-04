/**
 * Non-streaming `/api/ai/*` calls. Non-AI code reaches the AI server only through
 * these functions and `useAiTask` (re-exported from `@/ai`), never by fetching endpoints.
 */
import type { TranslateRequest, TranslateResult } from "@shared/ai";

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message || `HTTP ${res.status}`);
  return data as T;
}

/** Plain language → one kubectl command, with an explanation and its risk. */
export function translateToKubectl(req: TranslateRequest): Promise<TranslateResult> {
  return postJson<TranslateResult>("/api/ai/translate", req);
}

export interface AiConnectionResult {
  ok: boolean;
  model?: string;
  message?: string;
}

/** Ping the saved AI provider settings. */
export async function testAiConnection(): Promise<AiConnectionResult> {
  try {
    return await postJson<AiConnectionResult>("/api/ai/test");
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
