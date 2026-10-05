/**
 * Pinned and recently opened resources, per cluster. Kept in localStorage — this is a
 * convenience for jumping back to the things you actually use, not shared state.
 */
const KEY = "kubedeck-pins";
const MAX_RECENT = 8;
const MAX_PINS = 12;

export interface ResourceRef {
  context: string;
  namespace: string;
  /** route type: pod, deployment, service, … */
  type: string;
  name: string;
}

interface Stored { pins: ResourceRef[]; recents: ResourceRef[] }

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: Stored | null = null;

function load(): Stored {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : {};
    cache = { pins: Array.isArray(p.pins) ? p.pins : [], recents: Array.isArray(p.recents) ? p.recents : [] };
  } catch {
    cache = { pins: [], recents: [] };
  }
  return cache;
}

function save(next: Stored) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}

export const sameRef = (a: ResourceRef, b: ResourceRef) =>
  a.context === b.context && a.namespace === b.namespace && a.type === b.type && a.name === b.name;

export function getPins(): Stored { return load(); }

export function isPinned(ref: ResourceRef): boolean {
  return load().pins.some((p) => sameRef(p, ref));
}

export function togglePin(ref: ResourceRef): boolean {
  const cur = load();
  const pinned = cur.pins.some((p) => sameRef(p, ref));
  save({ ...cur, pins: pinned ? cur.pins.filter((p) => !sameRef(p, ref)) : [ref, ...cur.pins].slice(0, MAX_PINS) });
  return !pinned;
}

export function addRecent(ref: ResourceRef): void {
  const cur = load();
  if (cur.recents[0] && sameRef(cur.recents[0], ref)) return;
  save({ ...cur, recents: [ref, ...cur.recents.filter((r) => !sameRef(r, ref))].slice(0, MAX_RECENT) });
}

export function subscribePins(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Test helper: forget the in-memory copy so the next read hits storage again. */
export function __resetPinsCache(): void { cache = null; }
