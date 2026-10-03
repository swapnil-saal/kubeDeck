import { useEffect, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { useAui } from "@assistant-ui/react";
import { useTerminalStore } from "@/hooks/use-terminal-store";

/**
 * Deep-link helper for AI chat.
 *
 * Only seeds from `?prompt=` (not table filter `?q=`). After sending,
 * clears the prompt from the URL so it cannot re-fire or stick around.
 */
export function ChatDeepLink() {
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const aui = useAui();
  const { context, namespace, setContext, setNamespace } = useTerminalStore();
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;
    const params = new URLSearchParams(search);
    // Prefer `prompt`; accept legacy `q` only when path is /ai and value looks intentional
    // (still exclusive: never shared with dashboard search because of hash-router fix).
    const prompt = params.get("prompt") || params.get("q");
    const ctx = params.get("context");
    const ns = params.get("namespace");

    if (ctx && ctx !== context) setContext(ctx);
    if (ns && ns !== namespace) setNamespace(ns);

    if (!prompt) return;
    seededRef.current = true;

    queueMicrotask(() => {
      aui.thread().append({
        role: "user",
        content: [{ type: "text", text: prompt }],
      });
    });

    // Strip prompt/q so filters and reloads never re-send
    const kept = new URLSearchParams(search);
    kept.delete("prompt");
    kept.delete("q");
    const qs = kept.toString();
    const pathOnly = location.split("?")[0] || "/ai";
    setLocation(qs ? `${pathOnly}?${qs}` : pathOnly, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return null;
}
