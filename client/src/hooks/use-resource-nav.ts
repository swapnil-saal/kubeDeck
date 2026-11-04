import { useCallback } from "react";
import { useLocation } from "wouter";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { addRecent } from "@/lib/pins";

/** Link to one resource's page, in the scope it lives in. */
export function resourceHref(type: string, name: string, context: string, namespace: string, tab?: string): string {
  const q = `context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(namespace)}${tab ? `&tab=${tab}` : ""}`;
  return `/resource/${type}/${encodeURIComponent(name)}?${q}`;
}

/** Open a resource (remembered in "recent"), its logs, or ask the assistant about it. */
export function useResourceNav() {
  const [, navigate] = useLocation();
  const { context, namespace } = useTerminalStore();

  const open = useCallback(
    (type: string, name: string, ns?: string, tab?: string) => {
      const where = ns || namespace;
      if (context) addRecent({ context, namespace: where, type, name });
      navigate(resourceHref(type, name, context, where, tab));
    },
    [navigate, context, namespace],
  );

  const askAi = useCallback(
    (prompt: string) =>
      navigate(`/ai?context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(namespace)}&prompt=${encodeURIComponent(prompt)}`),
    [navigate, context, namespace],
  );

  return {
    openDetail: open,
    openLogs: useCallback((type: string, name: string, ns?: string) => open(type, name, ns, "logs"), [open]),
    askAi,
  };
}
