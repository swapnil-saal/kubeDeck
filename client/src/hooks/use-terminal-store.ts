import { useSyncExternalStore, useCallback } from "react";
import {
  getTerminalState,
  subscribe,
  setContext as _setContext,
  setNamespace as _setNamespace,
  setScope as _setScope,
} from "@/lib/terminal-store";

/** The selected context and namespace, and setters for them. */

export function useTerminalStore() {
  const state = useSyncExternalStore(subscribe, getTerminalState, getTerminalState);

  const setContext = useCallback((ctx: string) => _setContext(ctx), []);
  const setNamespace = useCallback((ns: string) => _setNamespace(ns), []);
  const setScope = useCallback((ctx: string, ns: string) => _setScope(ctx, ns), []);

  return {
    context: state.context,
    namespace: state.namespace,
    setContext,
    setNamespace,
    setScope,
  };
}
