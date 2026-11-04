/**
 * The selected cluster context and namespace, shared by every page (a tiny pub-sub store,
 * persisted in localStorage). Historically named after the terminal it once also served.
 */

const STORAGE_KEY = "kubedeck-defaults";

interface KubeState {
  context: string;
  namespace: string;
  /** last namespace used in each context, so switching clusters comes back to where you were */
  namespaceByContext: Record<string, string>;
}

type Listener = (state: KubeState) => void;

let state: KubeState = loadFromStorage();
const listeners = new Set<Listener>();

function loadFromStorage(): KubeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const context: string = parsed.context || "";
    const namespace: string = parsed.namespace || "default";
    const remembered: Record<string, string> =
      parsed.namespaceByContext && typeof parsed.namespaceByContext === "object" ? parsed.namespaceByContext : {};
    return {
      context,
      namespace,
      // older versions did not remember per context; seed it from the current pair
      namespaceByContext: context && !remembered[context] ? { ...remembered, [context]: namespace } : remembered,
    };
  } catch {
    return { context: "", namespace: "default", namespaceByContext: {} };
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

/** Switch cluster, returning to the namespace last used there ("all" the first time). */
export function setContext(ctx: string) {
  state = { ...state, context: ctx, namespace: state.namespaceByContext[ctx] || "all" };
  persist();
  notify();
}

export function setNamespace(ns: string) {
  state = {
    ...state,
    namespace: ns,
    namespaceByContext: state.context ? { ...state.namespaceByContext, [state.context]: ns } : state.namespaceByContext,
  };
  persist();
  notify();
}

/** Apply a cluster + namespace together (deep links, "switch to a namespace you can read"). */
export function setScope(ctx: string, ns: string) {
  state = { ...state, context: ctx, namespace: ns, namespaceByContext: { ...state.namespaceByContext, [ctx]: ns } };
  persist();
  notify();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
