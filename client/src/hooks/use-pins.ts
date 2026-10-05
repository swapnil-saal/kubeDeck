import { useCallback, useSyncExternalStore } from "react";
import { getPins, isPinned, subscribePins, togglePin, type ResourceRef } from "@/lib/pins";

export function usePins(context: string) {
  const snap = useSyncExternalStore(subscribePins, getPins, getPins);
  const pins = snap.pins.filter((p) => p.context === context);
  const recents = snap.recents.filter((r) => r.context === context && !snap.pins.some((p) => p.type === r.type && p.name === r.name && p.namespace === r.namespace && p.context === r.context));
  const pinned = useCallback((ref: ResourceRef) => snap.pins.length >= 0 && isPinned(ref), [snap]);
  return { pins, recents, isPinned: pinned, toggle: togglePin };
}
