import { useSyncExternalStore, useCallback } from "react";
import {
  getTerminalState,
  subscribe,
  setContext as _setContext,
  setNamespace as _setNamespace,
  toggleTerminal as _toggleTerminal,
} from "@/lib/terminal-store";

export function useTerminalStore() {
  const state = useSyncExternalStore(subscribe, getTerminalState, getTerminalState);

  const setContext = useCallback((ctx: string) => _setContext(ctx), []);
  const setNamespace = useCallback((ns: string) => _setNamespace(ns), []);
  const toggleTerminal = useCallback(() => _toggleTerminal(), []);

  return {
    context: state.context,
    namespace: state.namespace,
    terminalOpen: state.terminalOpen,
    setContext,
    setNamespace,
    toggleTerminal,
  };
}
