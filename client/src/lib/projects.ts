import { useSyncExternalStore } from "react";

/**
 * Projects: an application seen as one thing, spread over namespaces in one or more clusters.
 * Kept in this browser only (no cluster permissions needed, nothing written to any cluster).
 */
export interface ProjectScope {
  context: string;
  namespace: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  scopes: ProjectScope[];
  createdAt: number;
}

const KEY = "kubedeck.projects";
const EVENT = "kubedeck:projects";

function read(): Project[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Project[]) : [];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string" && Array.isArray(p.scopes)) : [];
  } catch {
    return [];
  }
}

let cache: Project[] = read();

function write(next: Project[]) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: kept for this session */ }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  const reload = () => { cache = read(); onChange(); };
  const local = () => onChange();
  window.addEventListener("storage", reload); // other tabs
  window.addEventListener(EVENT, local);
  return () => {
    window.removeEventListener("storage", reload);
    window.removeEventListener(EVENT, local);
  };
}

export function useProjects(): Project[] {
  return useSyncExternalStore(subscribe, () => cache, () => cache);
}

/** "Payments API" → "payments-api", unique among existing ids. */
export function projectId(name: string, taken: string[]): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

/** Same cluster and namespace only once, in a stable order. */
export function normalizeScopes(scopes: ProjectScope[]): ProjectScope[] {
  const seen = new Set<string>();
  return scopes
    .filter((s) => s.context && s.namespace && s.namespace !== "all")
    .filter((s) => { const k = `${s.context}\u0000${s.namespace}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.context.localeCompare(b.context) || a.namespace.localeCompare(b.namespace));
}

export function saveProject(p: Omit<Project, "id" | "createdAt"> & { id?: string }): Project {
  const list = read();
  const existing = p.id ? list.find((x) => x.id === p.id) : undefined;
  const project: Project = {
    id: existing?.id ?? projectId(p.name, list.map((x) => x.id)),
    name: p.name.trim(),
    description: p.description?.trim() || undefined,
    scopes: normalizeScopes(p.scopes),
    createdAt: existing?.createdAt ?? Date.now(),
  };
  write(existing ? list.map((x) => (x.id === project.id ? project : x)) : [...list, project]);
  return project;
}

export function deleteProject(id: string) {
  write(read().filter((p) => p.id !== id));
}
