/**
 * Alert history, preferences and delivery. History is kept in localStorage (newest first, capped)
 * so the bell survives a restart; delivery is a macOS/Windows system notification via the Web
 * Notification API (Electron and browsers both support it), plus an in-app toast when the window
 * is already in front.
 */
import type { Alert } from "./alerts";
import type { Severity } from "./cluster-health";

const HISTORY_KEY = "kubedeck-alerts";
const PREFS_KEY = "kubedeck-alert-prefs";
const MAX_HISTORY = 60;

export interface StoredAlert extends Alert {
  id: string;
  context: string;
  namespace: string;
  read: boolean;
}

export interface AlertPrefs {
  enabled: boolean;
  /** show system (desktop) notifications, not just the bell */
  system: boolean;
  /** least severe level that interrupts you */
  minSeverity: Severity;
  /** also tell me when a failing deployment recovers */
  recoveries: boolean;
  /** play a short chime with each alert */
  sound: boolean;
}

const DEFAULT_PREFS: AlertPrefs = { enabled: true, system: true, minSeverity: "warning", recoveries: false, sound: true };
const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

interface State { history: StoredAlert[]; prefs: AlertPrefs }

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch { return fallback; }
}

function loadHistory(): StoredAlert[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.slice(0, MAX_HISTORY) : [];
  } catch { return []; }
}

let state: State = { history: loadHistory(), prefs: load(PREFS_KEY, DEFAULT_PREFS) };
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
    localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
  } catch { /* storage unavailable: alerts still work for this session */ }
}
function emit() { persist(); listeners.forEach((l) => l()); }

export const subscribeAlerts = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getAlertState = () => state;

export function setAlertPrefs(patch: Partial<AlertPrefs>) {
  state = { ...state, prefs: { ...state.prefs, ...patch } };
  emit();
}
export function markAllRead() {
  if (!state.history.some((a) => !a.read)) return;
  state = { ...state, history: state.history.map((a) => (a.read ? a : { ...a, read: true })) };
  emit();
}
export function clearAlerts() { state = { ...state, history: [] }; emit(); }

export function notificationPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

/** Where clicking an alert should land. */
export function alertHref(a: Pick<StoredAlert, "resource" | "context" | "namespace">): string {
  const ns = a.resource.namespace || a.namespace;
  const q = `context=${encodeURIComponent(a.context)}&namespace=${encodeURIComponent(ns)}`;
  if (a.resource.type === "node") return `#/?${q}`;
  const tab = a.resource.type === "pod" ? "&tab=logs" : "";
  return `#/resource/${a.resource.type}/${encodeURIComponent(a.resource.name)}?${q}${tab}`;
}

type Deliver = (a: StoredAlert) => void;
let inAppToast: Deliver | null = null;
/** the app shell registers how to show an in-app toast (keeps this module free of React) */
export function setToastHandler(fn: Deliver | null) { inAppToast = fn; }

let audio: AudioContext | null = null;

/**
 * A short two-note chime made with Web Audio (no asset to ship): rising for warnings, a lower,
 * longer pair for critical failures. The OS notification sound is unreliable (Focus modes, a
 * per-app "play sound" switch), so the app plays its own.
 */
export function playAlertSound(severity: Severity = "warning") {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === "suspended") void audio.resume();
    const notes = severity === "critical" ? [440, 330, 440] : [660, 880];
    const t0 = audio.currentTime + 0.02;
    notes.forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      const start = t0 + i * 0.16;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain).connect(audio!.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  } catch { /* autoplay blocked or no audio device: the visual alert still shows */ }
}

function systemNotify(a: StoredAlert) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(a.title, { body: a.body, tag: a.key, silent: osChimeMuted() });
    n.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      window.location.hash = alertHref(a);
      n.close();
    };
  } catch { /* some platforms throw when notifications are disabled by the OS */ }
}

// the app plays its own chime, so the OS one is muted to avoid a double sound
const osChimeMuted = () => state.prefs.sound;

/** Record alerts for a scope and deliver those that pass the user's preferences. */
export function publishAlerts(alerts: Alert[], scope: { context: string; namespace: string }): StoredAlert[] {
  const { prefs } = state;
  if (!prefs.enabled || alerts.length === 0) return [];
  const wanted = alerts.filter((a) => RANK[a.severity] <= RANK[prefs.minSeverity] && (a.kind !== "recovered" || prefs.recoveries));
  if (wanted.length === 0) return [];
  const stored: StoredAlert[] = wanted.map((a) => ({
    ...a, ...scope, id: `${a.key}@${a.at}`, read: false,
  }));
  state = { ...state, history: [...stored, ...state.history].slice(0, MAX_HISTORY) };
  emit();

  if (prefs.sound) playAlertSound(stored.some((s) => s.severity === "critical") ? "critical" : "warning");
  const visible = typeof document !== "undefined" && document.hasFocus();
  // a burst (many pods failing at once) becomes one notification, not a storm
  if (stored.length > 3) {
    const summary: StoredAlert = {
      ...stored[0],
      key: `burst:${scope.context}/${scope.namespace}`,
      title: `${stored.length} new problems in ${scope.namespace}`,
      body: stored.slice(0, 3).map((s) => s.resource.name).join(", ") + (stored.length > 3 ? "…" : ""),
    };
    if (visible) inAppToast?.(summary);
    else if (prefs.system) systemNotify(summary);
    return stored;
  }
  for (const a of stored) {
    if (visible) inAppToast?.(a);
    else if (prefs.system) systemNotify(a);
  }
  return stored;
}
