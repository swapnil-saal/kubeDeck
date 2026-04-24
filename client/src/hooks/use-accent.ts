import { useCallback, useEffect, useSyncExternalStore } from "react";

export const ACCENT_THEMES = [
  { id: "coral",    label: "Coral",    color: "hsl(15, 85%, 55%)" },
  { id: "blue",     label: "Ocean",    color: "hsl(210, 85%, 52%)" },
  { id: "violet",   label: "Violet",   color: "hsl(262, 80%, 55%)" },
  { id: "emerald",  label: "Emerald",  color: "hsl(160, 70%, 38%)" },
  { id: "rose",     label: "Rose",     color: "hsl(340, 75%, 52%)" },
  { id: "amber",    label: "Amber",    color: "hsl(38, 90%, 48%)" },
  { id: "cyan",     label: "Cyan",     color: "hsl(192, 80%, 42%)" },
] as const;

export type AccentId = (typeof ACCENT_THEMES)[number]["id"];

const STORAGE_KEY = "kubedeck-accent";
const listeners = new Set<() => void>();

function getSnapshot(): AccentId {
  return (localStorage.getItem(STORAGE_KEY) as AccentId) || "coral";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function applyAccent(id: AccentId) {
  const root = document.documentElement;
  ACCENT_THEMES.forEach((t) => root.classList.remove(`accent-${t.id}`));
  if (id !== "coral") {
    root.classList.add(`accent-${id}`);
  }
}

export function useAccent() {
  const accent = useSyncExternalStore(subscribe, getSnapshot, () => "coral" as AccentId);

  useEffect(() => applyAccent(accent), [accent]);

  const setAccent = useCallback((id: AccentId) => {
    localStorage.setItem(STORAGE_KEY, id);
    applyAccent(id);
    listeners.forEach((cb) => cb());
  }, []);

  return { accent, setAccent, themes: ACCENT_THEMES };
}
