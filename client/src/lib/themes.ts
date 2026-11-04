import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

/**
 * Colour palettes. The mode (light / dark / system) is next-themes' (`kubedeck-theme`);
 * the palette for each mode is chosen separately and kept in localStorage, so the quick
 * light/dark toggle always switches between the user's two favourites.
 * Colours are in themes.css (defaults: index.css). index.html applies the saved palette
 * before the first paint, so there is no flash of the default.
 */
export type ThemeMode = "light" | "dark";

export interface Palette {
  id: string;
  label: string;
  mode: ThemeMode;
  description: string;
}

export const PALETTES: readonly Palette[] = [
  { id: "oled", label: "OLED black", mode: "dark", description: "True black, brightest text" },
  { id: "contrast-dark", label: "High contrast", mode: "dark", description: "Black, white text, bright borders" },
  { id: "charcoal", label: "Charcoal", mode: "dark", description: "Neutral charcoal, brand cyan" },
  { id: "midnight", label: "Midnight", mode: "dark", description: "Deep navy, sky blue" },
  { id: "forest", label: "Forest", mode: "dark", description: "Green-black, emerald" },
  { id: "plum", label: "Plum", mode: "dark", description: "Aubergine, violet" },
  { id: "paper", label: "Paper", mode: "light", description: "Clean white, brand teal" },
  { id: "contrast", label: "High contrast", mode: "light", description: "Black on white, strong borders" },
  { id: "arctic", label: "Arctic", mode: "light", description: "Cool blue-white, blue" },
  { id: "sand", label: "Sand", mode: "light", description: "Warm paper, terracotta" },
  { id: "meadow", label: "Meadow", mode: "light", description: "Soft green, deep green" },
];

/** OLED black and Paper by default. index.html repeats these for the pre-paint script. */
export const DEFAULT_PALETTE: Record<ThemeMode, string> = { dark: "oled", light: "paper" };

const storageKey = (mode: ThemeMode) => `kubedeck-palette-${mode}`;
const CHANGED = "kubedeck:palette-changed";

export function getPalette(mode: ThemeMode): string {
  try {
    const id = localStorage.getItem(storageKey(mode));
    if (id && PALETTES.some((p) => p.id === id && p.mode === mode)) return id;
  } catch {
    // storage blocked: defaults
  }
  return DEFAULT_PALETTE[mode];
}

export function setPalette(mode: ThemeMode, id: string): void {
  try {
    localStorage.setItem(storageKey(mode), id);
  } catch {
    // storage blocked: applies for this session only
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => e.key?.startsWith("kubedeck-palette-") && onChange();
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage); // another tab changed it
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const snapshot = () => `${getPalette("light")}|${getPalette("dark")}`;

/** The chosen palette per mode, live. */
export function usePalettes(): Record<ThemeMode, string> & { choose: (mode: ThemeMode, id: string) => void } {
  const [light, dark] = useSyncExternalStore(subscribe, snapshot, () => `${DEFAULT_PALETTE.light}|${DEFAULT_PALETTE.dark}`).split("|");
  const choose = useCallback((mode: ThemeMode, id: string) => setPalette(mode, id), []);
  return { light, dark, choose };
}

/** Keeps `data-palette` on <html> in step with the current mode and the user's choice. Mount once. */
export function useApplyPalette(): void {
  const { resolvedTheme } = useTheme();
  const palettes = usePalettes();
  const mode: ThemeMode = resolvedTheme === "light" ? "light" : "dark";
  const id = palettes[mode];
  useEffect(() => {
    document.documentElement.dataset.palette = id;
  }, [id]);
}
