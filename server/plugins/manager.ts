/**
 * The plugin manager: knows every plugin, keeps each one's choices (on/off, settings), and starts and
 * stops them while KubeDeck runs, so switching one on in Settings needs no restart.
 *
 * A plugin's settings are, in order of strength: what the server's environment pins, what an admin
 * saved, then empty. Secret settings are encrypted at rest and never sent to the browser.
 */
import type { PluginInfo, PluginStatus, PluginUpdate, PluginValues } from "@shared/plugins";
import { emit, type PluginChanged } from "../events";
import { decrypt, encrypt, secretKey } from "./secrets";
import { memoryStore, type PluginStore, type StoredPlugin } from "./store";
import type { PluginDefinition, PluginFactory, PluginRuntime } from "./types";

interface Entry {
  def: PluginDefinition;
  saved: StoredPlugin | null;
  runtime: PluginRuntime | null;
  /** why it is not running although it is on: missing settings, or start failed */
  problem: PluginStatus | null;
  status: { at: number; value: PluginStatus } | null;
}

const STATUS_TTL_MS = 30_000;
const CHECK_TIMEOUT_MS = 8_000;

const definitions = new Map<string, PluginDefinition>();
const factories = new Map<string, PluginFactory>();
const entries = new Map<string, Entry>();
const queues = new Map<string, Promise<unknown>>();
let store: PluginStore = memoryStore();
let env: NodeJS.ProcessEnv = process.env;
let key: Buffer | null = null;

/** A built-in plugin; called once when its module loads. */
export function definePlugin(def: PluginDefinition): void {
  if (definitions.has(def.id)) throw new Error(`Plugin "${def.id}" is defined twice.`);
  definitions.set(def.id, def);
}

/** How to make plugins an admin adds, by kind ("mcp"). */
export function definePluginKind(kind: string, factory: PluginFactory): void {
  factories.set(kind, factory);
}

export const addableKinds = (): string[] => [...factories.keys()];

/** One plugin operation at a time per plugin (start, stop, save), in the order asked. */
function serial<T>(id: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(id) ?? Promise.resolve()).then(task, task);
  queues.set(id, next.catch(() => undefined));
  return next;
}

const secretKeys = (def: PluginDefinition) => new Set(def.fields.filter((f) => f.kind === "secret").map((f) => f.key));
const getKey = () => (key ??= secretKey(env));

function openSecrets(def: PluginDefinition, values: PluginValues): PluginValues {
  const secret = secretKeys(def);
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, secret.has(k) && typeof v === "string" ? decrypt(v, getKey()) : v]));
}

function sealSecrets(def: PluginDefinition, values: PluginValues): PluginValues {
  const secret = secretKeys(def);
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, secret.has(k) && typeof v === "string" && v ? encrypt(v, getKey()) : v]));
}

const pinned = (def: PluginDefinition): PluginValues => def.fromEnv?.(env) ?? {};

/** The settings a plugin runs with: saved, overridden by the environment. */
function effectiveValues(e: Entry): PluginValues {
  const saved = e.saved ? openSecrets(e.def, e.saved.values) : {};
  const fromEnv = Object.fromEntries(Object.entries(pinned(e.def)).filter(([, v]) => v !== "" && v !== undefined));
  return { ...saved, ...fromEnv };
}

function isEnabled(e: Entry): boolean {
  if (e.def.alwaysOn) return true;
  if (e.saved) return e.saved.enabled;
  return e.def.defaultEnabled?.(effectiveValues(e)) ?? false;
}

/** What gateways read: whether a plugin is on, and its settings. Safe to call at any time. */
export function pluginState(id: string): { enabled: boolean; values: PluginValues } {
  const e = entries.get(id);
  if (!e) return { enabled: false, values: {} };
  return { enabled: isEnabled(e) && !e.problem, values: effectiveValues(e) };
}

async function stopEntry(e: Entry): Promise<void> {
  const r = e.runtime;
  e.runtime = null;
  e.status = null;
  if (r?.stop) {
    try { await r.stop(); } catch (err) { console.error(`[kubedeck] plugin ${e.def.id} did not stop cleanly: ${message(err)}`); }
  }
}

async function startEntry(e: Entry): Promise<void> {
  await stopEntry(e);
  e.problem = null;
  if (!isEnabled(e)) return;
  const values = effectiveValues(e);
  const problems = e.def.validate?.(values) ?? [];
  if (problems.length > 0) {
    e.problem = { state: "unconfigured", message: problems.join(" ") };
    return;
  }
  try {
    e.runtime = await e.def.start({ id: e.def.id, values, log: (m) => console.log(`[kubedeck] ${e.def.name}: ${m}`) });
  } catch (err) {
    e.problem = { state: "error", message: `Could not start: ${message(err)}` };
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms / 1000}s`)), ms))]);
}

async function statusOf(e: Entry, fresh = false): Promise<PluginStatus> {
  if (!isEnabled(e)) return { state: "off" };
  if (e.problem) return e.problem;
  if (!fresh && e.status && Date.now() - e.status.at < STATUS_TTL_MS) return e.status.value;
  const check = fresh ? (e.runtime?.test ?? e.runtime?.status) : e.runtime?.status;
  let value: PluginStatus = { state: "ok" };
  if (check && e.runtime) {
    try { value = await withTimeout(Promise.resolve(check.call(e.runtime)), CHECK_TIMEOUT_MS); } catch (err) { value = { state: "error", message: message(err) }; }
  }
  e.status = { at: Date.now(), value };
  return value;
}

/** Load saved choices, make added plugins again, start everything that is on. Errors are logged, not fatal. */
export async function startPlugins(s: PluginStore, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  store = s;
  env = environment;
  key = null;
  const rows = await store.all();
  for (const row of rows) {
    if (row.kind === "builtin" || definitions.has(row.id)) continue;
    const factory = factories.get(row.kind);
    if (factory) definitions.set(row.id, factory({ id: row.id, name: row.name }));
  }
  const saved = new Map(rows.map((r) => [r.id, r]));
  for (const def of definitions.values()) {
    const e: Entry = { def, saved: saved.get(def.id) ?? null, runtime: null, problem: null, status: null };
    entries.set(def.id, e);
    await serial(def.id, () => startEntry(e));
    if (e.problem?.state === "error") console.warn(`[kubedeck] plugin ${def.name}: ${e.problem.message}`);
  }
}

/** Stop every plugin (shutdown, tests). */
export async function stopPlugins(): Promise<void> {
  for (const e of entries.values()) await serial(e.def.id, () => stopEntry(e));
  entries.clear();
  for (const [id, def] of definitions) if (def.kind !== "builtin") definitions.delete(id);
}

function info(e: Entry, status: PluginStatus, canManage: boolean): PluginInfo {
  const secret = secretKeys(e.def);
  const values = effectiveValues(e);
  const env = pinned(e.def);
  return {
    id: e.def.id,
    name: e.def.name,
    description: e.def.description,
    category: e.def.category,
    kind: e.def.kind,
    alwaysOn: !!e.def.alwaysOn,
    enabled: isEnabled(e),
    removable: e.def.kind !== "builtin",
    fields: e.def.fields.map((f) => ({ required: false, ...f })),
    values: canManage ? Object.fromEntries(Object.entries(values).map(([k, v]) => [k, secret.has(k) ? "" : v])) : {},
    secretsSet: canManage ? [...secret].filter((k) => typeof values[k] === "string" && values[k] !== "") : [],
    envPinned: Object.entries(env).filter(([, v]) => v !== "" && v !== undefined).map(([k]) => k),
    status,
    provides: { tools: e.def.provides?.tools ?? [], features: e.def.provides?.features ?? [] },
  };
}

export async function listPlugins(canManage: boolean): Promise<PluginInfo[]> {
  const list = [...entries.values()];
  const statuses = await Promise.all(list.map((e) => statusOf(e)));
  return list.map((e, i) => info(e, statuses[i], canManage));
}

export class PluginError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message); }
}

function entryOf(id: string): Entry {
  const e = entries.get(id);
  if (!e) throw new PluginError(404, `There is no plugin "${id}".`);
  return e;
}

/** Turn a plugin on or off and/or change its settings; it restarts with them. */
export function updatePlugin(id: string, update: PluginUpdate, by: string, change?: PluginChanged["change"]): Promise<PluginInfo> {
  const e = entryOf(id);
  return serial(id, async () => {
    if (update.enabled === false && e.def.alwaysOn) throw new PluginError(400, `${e.def.name} is always on.`);
    const known = new Set(e.def.fields.map((f) => f.key));
    const unknown = Object.keys(update.values ?? {}).filter((k) => !known.has(k));
    if (unknown.length) throw new PluginError(400, `${e.def.name} has no setting ${unknown.join(", ")}.`);
    const env = pinned(e.def);
    const secret = secretKeys(e.def);
    const saved = e.saved ? openSecrets(e.def, e.saved.values) : {};
    for (const [k, v] of Object.entries(update.values ?? {})) {
      if (env[k] !== undefined && env[k] !== "") continue; // pinned by the environment
      if (secret.has(k) && v === "") continue; // "" keeps the stored secret
      saved[k] = v;
    }
    const enabled = update.enabled ?? isEnabled(e);
    e.saved = {
      id, kind: e.saved?.kind ?? (e.def.kind === "builtin" ? "builtin" : e.def.kind), name: e.saved?.name ?? e.def.name,
      enabled, values: sealSecrets(e.def, saved), updatedAt: new Date().toISOString(), updatedBy: by,
    };
    await store.save(e.saved);
    await startEntry(e);
    emit("plugin.changed", { id, enabled, by, change: change ?? (update.values ? "settings" : enabled ? "enabled" : "disabled") });
    return info(e, await statusOf(e, true), true);
  });
}

/** "Test connection": a fresh check of a plugin that is on. */
export async function testPlugin(id: string): Promise<PluginStatus> {
  const e = entryOf(id);
  return serial(id, () => statusOf(e, true));
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "server";

/** Add a plugin of an addable kind (an MCP server); it starts on. */
export async function createPlugin(kind: string, name: string, values: PluginValues, by: string): Promise<PluginInfo> {
  const factory = factories.get(kind);
  if (!factory) throw new PluginError(400, `Plugins of kind "${kind}" cannot be added.`);
  let id = `${kind}:${slug(name)}`;
  for (let n = 2; definitions.has(id); n++) id = `${kind}:${slug(name)}-${n}`;
  const def = factory({ id, name });
  definitions.set(id, def);
  const e: Entry = { def, saved: { id, kind, name, enabled: true, values: {}, updatedAt: new Date().toISOString(), updatedBy: by }, runtime: null, problem: null, status: null };
  entries.set(id, e);
  return updatePlugin(id, { enabled: true, values }, by, "added");
}

/** Remove an added plugin (built-ins cannot be removed, only switched off). */
export function removePlugin(id: string, by: string): Promise<void> {
  const e = entryOf(id);
  if (e.def.kind === "builtin") return Promise.reject(new PluginError(400, `${e.def.name} is built in: switch it off instead.`));
  return serial(id, async () => {
    await stopEntry(e);
    await store.remove(id);
    entries.delete(id);
    definitions.delete(id);
    emit("plugin.changed", { id, enabled: false, by, change: "removed" });
  });
}
