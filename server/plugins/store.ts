/**
 * Where plugin choices are kept: the `plugin_state` table (this module owns it), or memory when
 * KubeDeck has no database (a desktop whose home folder is not writable).
 */
import type { PluginValues } from "@shared/plugins";
import type { Database } from "../db";

export interface StoredPlugin {
  id: string;
  /** "builtin", or the kind of an added plugin ("mcp"), so it can be made again at start */
  kind: string;
  /** an added plugin's display name */
  name: string;
  enabled: boolean;
  /** saved settings; secret ones are encrypted */
  values: PluginValues;
  updatedAt: string;
  updatedBy: string;
}

export interface PluginStore {
  all(): Promise<StoredPlugin[]>;
  save(p: StoredPlugin): Promise<void>;
  remove(id: string): Promise<void>;
}

export function memoryStore(): PluginStore {
  const rows = new Map<string, StoredPlugin>();
  return {
    all: async () => [...rows.values()],
    save: async (p) => { rows.set(p.id, p); },
    remove: async (id) => { rows.delete(id); },
  };
}

export function databaseStore(d: Database): PluginStore {
  return {
    async all() {
      const rows = await d.db.selectFrom("plugin_state").selectAll().execute();
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        enabled: Number(r.enabled) === 1,
        values: JSON.parse(r.values || "{}") as PluginValues,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
      }));
    },
    async save(p) {
      const row = { kind: p.kind, name: p.name, enabled: p.enabled ? 1 : 0, values: JSON.stringify(p.values), updated_at: p.updatedAt, updated_by: p.updatedBy };
      await d.db
        .insertInto("plugin_state")
        .values({ id: p.id, ...row })
        .onConflict((oc) => oc.column("id").doUpdateSet(row))
        .execute();
    },
    async remove(id) {
      await d.db.deleteFrom("plugin_state").where("id", "=", id).execute();
    },
  };
}
