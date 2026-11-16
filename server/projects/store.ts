/**
 * Where projects are kept: the `project` table (this module owns it), or memory for this run when
 * KubeDeck has no database (a desktop whose home folder is not writable).
 */
import type { ProjectScope } from "@shared/projects";
import type { Database } from "../db";

export interface StoredProject {
  id: string;
  name: string;
  description: string;
  scopes: ProjectScope[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface ProjectStore {
  all(): Promise<StoredProject[]>;
  save(p: StoredProject): Promise<void>;
  remove(id: string): Promise<void>;
}

export function memoryProjectStore(): ProjectStore {
  const rows = new Map<string, StoredProject>();
  return {
    all: async () => [...rows.values()],
    save: async (p) => { rows.set(p.id, p); },
    remove: async (id) => { rows.delete(id); },
  };
}

function parseScopes(raw: unknown): ProjectScope[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.filter((s) => s && typeof s.context === "string" && typeof s.namespace === "string") : [];
  } catch {
    return [];
  }
}

export function databaseProjectStore(d: Database): ProjectStore {
  return {
    async all() {
      const rows = await d.db.selectFrom("project").selectAll().orderBy("name").execute();
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? "",
        scopes: parseScopes(r.scopes),
        createdAt: r.created_at,
        createdBy: r.created_by ?? "",
        updatedAt: r.updated_at,
      }));
    },
    async save(p) {
      const row = { name: p.name, description: p.description, scopes: JSON.stringify(p.scopes), created_at: p.createdAt, created_by: p.createdBy, updated_at: p.updatedAt };
      await d.db.insertInto("project").values({ id: p.id, ...row }).onConflict((oc) => oc.column("id").doUpdateSet(row)).execute();
    },
    async remove(id) {
      await d.db.deleteFrom("project").where("id", "=", id).execute();
    },
  };
}
