/**
 * Per-context, per-namespace history of executed kubectl commands.
 * Stored in localStorage. Kept short (12 most-recent) so the palette
 * "Recent" section stays scannable.
 */

const STORAGE_KEY = "kubedeck.kubectl.history";
const MAX_PER_SCOPE = 12;

interface Entry {
  command: string;
  at: number;
  context: string;
  namespace: string;
}

type Store = Record<string, Entry[]>;

function scopeKey(context: string, namespace: string): string {
  return `${context}::${namespace || "all"}`;
}

function readAll(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(store: Store): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch {}
}

export function recordKubectlHistory(command: string, context: string, namespace: string): void {
  const trimmed = command.trim();
  if (!trimmed) return;
  const store = readAll();
  const key = scopeKey(context, namespace);
  const list = (store[key] || []).filter((e) => e.command !== trimmed);
  list.unshift({ command: trimmed, at: Date.now(), context, namespace });
  store[key] = list.slice(0, MAX_PER_SCOPE);
  writeAll(store);
}

export function getKubectlHistory(context: string, namespace: string): Entry[] {
  if (!context) return [];
  const store = readAll();
  return store[scopeKey(context, namespace)] || [];
}

export function clearKubectlHistory(context: string, namespace: string): void {
  const store = readAll();
  delete store[scopeKey(context, namespace)];
  writeAll(store);
}
