/**
 * Remembered log-view settings: the "always hide" patterns per workload (so `/healthcheck` stays
 * hidden next time you open that app) and a few global preferences. localStorage only — a
 * convenience, never required.
 */
const KEY = "kubedeck-log-prefs";

export interface GlobalPrefs {
  wrap: boolean;
  showTime: boolean;
  /** "auto" picks pretty for JSON-heavy logs, raw otherwise */
  format: "auto" | "pretty" | "raw";
  tail: number;
  since: string;
}

export const DEFAULT_PREFS: GlobalPrefs = { wrap: true, showTime: true, format: "auto", tail: 500, since: "" };

interface Stored { prefs: Partial<GlobalPrefs>; hidden: Record<string, string[]> }

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : {};
    return { prefs: p.prefs ?? {}, hidden: p.hidden && typeof p.hidden === "object" ? p.hidden : {} };
  } catch {
    return { prefs: {}, hidden: {} };
  }
}

function write(s: Stored) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export function loadPrefs(): GlobalPrefs {
  return { ...DEFAULT_PREFS, ...read().prefs };
}

export function savePrefs(patch: Partial<GlobalPrefs>): void {
  const s = read();
  write({ ...s, prefs: { ...s.prefs, ...patch } });
}

export const hiddenKey = (context: string, namespace: string, kind: string, name: string) =>
  `${context}/${namespace}/${kind}/${name}`;

export function loadHidden(key: string): string[] {
  const list = read().hidden[key];
  return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
}

export function saveHidden(key: string, patterns: string[]): void {
  const s = read();
  const hidden = { ...s.hidden };
  if (patterns.length === 0) delete hidden[key];
  else hidden[key] = patterns;
  write({ ...s, hidden });
}
