import { useState, useRef, useCallback } from "react";
import { fetchAiSuggestion } from "./use-ai-config";

const globalCache = new Map<string, string>();

export function useAiTooltip(resourceName: string, status: string) {
  const [suggestion, setSuggestion] = useState<string | null>(
    () => globalCache.get(`${resourceName}:${status}`) ?? null,
  );
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const fetchedRef = useRef(false);

  const triggerFetch = useCallback(() => {
    const key = `${resourceName}:${status}`;
    if (globalCache.has(key)) {
      setSuggestion(globalCache.get(key)!);
      return;
    }
    if (fetchedRef.current || loading) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      fetchedRef.current = true;
      setLoading(true);
      try {
        const result = await fetchAiSuggestion(
          `In one brief sentence, explain why a Kubernetes resource "${resourceName}" has status "${status}" and how to fix it.`,
          150,
        );
        globalCache.set(key, result);
        setSuggestion(result);
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [resourceName, status, loading]);

  return { suggestion, loading, triggerFetch };
}
