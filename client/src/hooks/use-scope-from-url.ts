import { useEffect } from "react";
import { useHashParams } from "@/hooks/use-hash-params";
import { useTerminalStore } from "@/hooks/use-terminal-store";

/**
 * A link like `#/resources/pods?context=e2dev&namespace=e2` sets the scope, then tidies the URL.
 * `keepInUrl`: pages that read the scope from their own URL (a resource's page) keep it there.
 */
export function useScopeFromUrl({ keepInUrl = false }: { keepInUrl?: boolean } = {}): void {
  const { get, setMany } = useHashParams();
  const { context, namespace, setScope } = useTerminalStore();
  const urlContext = get("context");
  const urlNamespace = get("namespace");
  useEffect(() => {
    if (!urlContext && !urlNamespace) return;
    setScope(urlContext || context, urlNamespace || namespace);
    if (!keepInUrl) setMany({ context: null, namespace: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlContext, urlNamespace]);
}
