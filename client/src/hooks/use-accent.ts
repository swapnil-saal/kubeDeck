import { useSyncExternalStore } from "react";

/** Brand is fixed to AI-icon cyan — kept for API compatibility only. */
export const ACCENT_THEMES = [
  { id: "cyan", label: "Cyan", color: "hsl(184, 65%, 58%)" },
] as const;

export type AccentId = (typeof ACCENT_THEMES)[number]["id"];

/** No-op: only the dark cyan brand exists. */
export function useAccent() {
  const accent = useSyncExternalStore(
    () => () => {},
    () => "cyan" as AccentId,
    () => "cyan" as AccentId,
  );

  return {
    accent,
    setAccent: (_id: AccentId) => {},
    themes: ACCENT_THEMES,
  };
}
