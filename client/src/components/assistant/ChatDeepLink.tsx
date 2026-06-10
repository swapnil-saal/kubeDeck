import { useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { useThreadRuntime } from "@assistant-ui/react";
import { useTerminalStore } from "@/hooks/use-terminal-store";

/**
 * Reads `?q=...` from the URL on mount, sets the chat scope from
 * `?context=` / `?namespace=` (if provided), and auto-sends the prompt as
 * a user message. Renders nothing.
 *
 * Use INSIDE an <AssistantRuntimeProvider> so it can append messages.
 */
export function ChatDeepLink() {
  const search = useSearch();
  const runtime = useThreadRuntime();
  const { context, namespace, setContext, setNamespace } = useTerminalStore();
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;
    const params = new URLSearchParams(search);
    const q = params.get("q") || params.get("prompt");
    const ctx = params.get("context");
    const ns = params.get("namespace");

    // Apply scope overrides from the URL first
    if (ctx && ctx !== context) setContext(ctx);
    if (ns && ns !== namespace) setNamespace(ns);

    if (!q) return;
    seededRef.current = true;

    // Defer one tick so the runtime is fully ready
    queueMicrotask(() => {
      runtime.append({
        role: "user",
        content: [{ type: "text", text: q }],
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return null;
}
