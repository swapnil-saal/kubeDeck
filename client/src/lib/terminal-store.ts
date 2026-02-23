/**
 * Lightweight global store for terminal + active k8s context/namespace.
 * Uses a simple pub-sub pattern so the TerminalPanel can live in App.tsx
 * while Dashboard/ResourceDetail can read/write the same state.
 */

const STORAGE_KEY = "kubedeck-defaults";

interface KubeState {
  context: string;
  namespace: string;
  terminalOpen: boolean;
}

type Listener = (state: KubeState) => void;

let state: KubeState = loadFromStorage();
const listeners = new Set<Listener>();

function loadFromStorage(): KubeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      context: parsed.context || "",
      namespace: parsed.namespace || "default",
      terminalOpen: parsed.terminalOpen ?? false,
    };
  } catch {
    return { context: "", namespace: "default", terminalOpen: false };
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function notify() {
  listeners.forEach((fn) => fn(state));
}

export function getTerminalState() {
  return state;
}

export function setContext(ctx: string) {
  state = { ...state, context: ctx, namespace: "default" };
  persist();
  notify();
}

export function setNamespace(ns: string) {
  state = { ...state, namespace: ns };
  persist();
  notify();
}

export function toggleTerminal() {
  state = { ...state, terminalOpen: !state.terminalOpen };
  persist();
  notify();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
