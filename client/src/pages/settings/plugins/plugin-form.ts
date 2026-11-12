/**
 * The settings form of one plugin, as plain data: what the inputs hold while someone edits them, and
 * the PluginUpdate values a Save sends (only what changed). The page renders any plugin from its fields.
 */
import type { FieldValue, PluginField, PluginInfo, PluginValues } from "@shared/plugins";

/** One name → value pair of a map field, as typed (an empty name is dropped on save). */
export interface MapRow {
  key: string;
  value: string;
}

/** A field while it is edited: a list is the comma-separated text, a map its rows. */
export type DraftValue = string | boolean | MapRow[];
export type Draft = Record<string, DraftValue>;

type FormPlugin = Pick<PluginInfo, "fields" | "values" | "envPinned">;

/** "a, b\nc" → ["a", "b", "c"]: commas or new lines separate, blanks and repeats are dropped. */
export function parseList(raw: string): string[] {
  return [...new Set(raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
}

export const formatList = (list: readonly string[]): string => list.join(", ");

export function mapToRows(map: Record<string, string>): MapRow[] {
  return Object.entries(map).map(([key, value]) => ({ key, value }));
}

/** Rows → map; names are trimmed, rows without a name are dropped, a later row wins over an earlier one. */
export function rowsToMap(rows: readonly MapRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) map[key] = row.value.trim();
  }
  return map;
}

const asString = (v: FieldValue | undefined) => (typeof v === "string" ? v : "");
const asList = (v: FieldValue | undefined) => (Array.isArray(v) ? v : typeof v === "string" ? parseList(v) : []);
const asMap = (v: FieldValue | undefined): Record<string, string> =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};

/** What the input of a field starts with. A secret always starts empty: the browser never gets it. */
export function draftValue(field: PluginField, value: FieldValue | undefined): DraftValue {
  switch (field.kind) {
    case "secret": return "";
    case "boolean": return value === true;
    case "list": return formatList(asList(value));
    case "map": return mapToRows(asMap(value));
    default: return asString(value);
  }
}

export function draftFrom(plugin: Pick<PluginInfo, "fields" | "values">): Draft {
  return Object.fromEntries(plugin.fields.map((f) => [f.key, draftValue(f, plugin.values[f.key])]));
}

/** The value a field's input stands for, as the API takes it. */
export function wireValue(field: PluginField, draft: DraftValue | undefined): FieldValue {
  switch (field.kind) {
    case "boolean": return draft === true;
    case "list": return parseList(typeof draft === "string" ? draft : "");
    case "map": return rowsToMap(Array.isArray(draft) ? draft : []);
    default: return typeof draft === "string" ? draft.trim() : "";
  }
}

export function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  }
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/**
 * The values a Save sends: the fields whose input differs from what is stored. A secret is sent only
 * when something was typed (empty keeps the stored one); fields the server's environment pins are never sent.
 */
export function changedValues(plugin: FormPlugin, draft: Draft): PluginValues {
  const pinned = new Set(plugin.envPinned);
  const out: PluginValues = {};
  for (const field of plugin.fields) {
    if (pinned.has(field.key)) continue;
    const next = wireValue(field, draft[field.key]);
    if (field.kind === "secret") {
      if (next !== "") out[field.key] = next;
      continue;
    }
    // the stored value through the same input round trip, so both sides compare in one shape
    const stored = wireValue(field, draftValue(field, plugin.values[field.key]));
    if (!sameValue(next, stored)) out[field.key] = next;
  }
  return out;
}

export const hasChanges = (plugin: FormPlugin, draft: Draft): boolean => Object.keys(changedValues(plugin, draft)).length > 0;
