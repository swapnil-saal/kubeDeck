import { useCallback, useRef, useState } from "react";

/**
 * Tiny hook for one-shot SSE-streamed AI endpoints.
 * Server emits `data: ${JSON.stringify({text}|{error})}\n\n` lines and `data: [DONE]\n\n`.
 *
 * Use for non-conversational flows like /api/ai/troubleshoot and /api/ai/explain-yaml.
 */
export function useStreamingAi() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (endpoint: string, body: unknown) => {
    setContent("");
    setError(null);
    setLoading(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(errBody.message || `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            if (json.error) {
              setError(String(json.error));
              break;
            }
            if (typeof json.text === "string") {
              full += json.text;
              setContent(full);
            }
          } catch {
            // ignore malformed line
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setError(err?.message || "Request failed");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setContent("");
    setError(null);
    setLoading(false);
  }, []);

  return { content, loading, error, run, cancel, reset };
}
