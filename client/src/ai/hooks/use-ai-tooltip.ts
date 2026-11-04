import { useCallback, useEffect, useRef, useState } from "react";
import { useAiTask } from "./use-ai-task";

/** Answers survive re-renders and other badges with the same resource and status. */
const cache = new Map<string, string>();
const HOVER_DELAY_MS = 300;

/** A one-sentence "why is it in this status, and how do I fix it", fetched on hover. */
export function useAiTooltip(resourceName: string, status: string) {
  const key = `${resourceName}:${status}`;
  const { text, loading, run } = useAiTask("explain-status");
  const [cached, setCached] = useState(() => cache.get(key) ?? null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const started = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!loading && text) cache.set(key, text);
  }, [key, loading, text]);

  const triggerFetch = useCallback(() => {
    const hit = cache.get(key);
    if (hit) return setCached(hit);
    if (started.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      started.current = true;
      void run({ resource: resourceName, status });
    }, HOVER_DELAY_MS);
  }, [key, resourceName, status, run]);

  return { suggestion: cached ?? (text || null), loading, triggerFetch };
}
