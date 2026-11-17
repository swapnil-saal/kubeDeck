/**
 * Groups and their cluster access in the database: `kubedeck_group` and `group_cluster_access`
 * (this module owns both). An uploaded kubeconfig is stored encrypted, next to the access it belongs to.
 */
import { ALL_PERMISSIONS, appPermissionsSchema, type AppPermissions, type ClusterAccess, type Group } from "@shared/groups";
import type { Database } from "../db";

/** A group as stored: its uploaded kubeconfigs by context, encrypted. */
export interface StoredGroup extends Group {
  secrets: Record<string, string>;
}

export interface GroupStore {
  all(): Promise<StoredGroup[]>;
  /** insert or replace a group with all of its cluster access */
  save(g: StoredGroup, by: string): Promise<void>;
  remove(id: string): Promise<void>;
  reorder(ids: string[]): Promise<void>;
}

function accessRow(g: StoredGroup, a: ClusterAccess) {
  const sa = a.as === "serviceaccount";
  return {
    group_id: g.id,
    context: a.context,
    acts_as: a.as,
    namespace: sa ? a.namespace : "",
    service_account: sa ? a.serviceAccount : "",
    credentials: sa ? "" : g.secrets[a.context] ?? "",
    identity: sa ? "" : a.identity ?? "",
    server: sa ? "" : a.server ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAccess(r: any): ClusterAccess | null {
  if (r.acts_as === "serviceaccount") return { context: r.context, as: "serviceaccount", namespace: r.namespace, serviceAccount: r.service_account };
  if (r.acts_as === "credentials" && r.credentials) return { context: r.context, as: "credentials", identity: r.identity ?? "", server: r.server ?? "" };
  return null;
}

/** Stored permissions over the defaults: a feature added later starts on for every group. */
function readPermissions(raw: unknown): AppPermissions {
  try {
    const parsed = appPermissionsSchema.partial().safeParse(JSON.parse(String(raw || "{}")));
    return { ...ALL_PERMISSIONS, ...(parsed.success ? parsed.data : {}) };
  } catch {
    return { ...ALL_PERMISSIONS };
  }
}

export function databaseGroupStore(d: Database): GroupStore {
  return {
    async all() {
      const groups = await d.db.selectFrom("kubedeck_group").selectAll().orderBy("position").orderBy("id").execute();
      const rows = await d.db.selectFrom("group_cluster_access").selectAll().orderBy("context").execute();
      return groups.map((g) => {
        const mine = rows.filter((r) => r.group_id === g.id);
        return {
          id: g.id,
          name: g.name,
          description: g.description ?? "",
          position: Number(g.position),
          permissions: readPermissions(g.permissions),
          access: mine.map(toAccess).filter((a): a is ClusterAccess => a !== null),
          secrets: Object.fromEntries(mine.filter((r) => r.acts_as === "credentials" && r.credentials).map((r) => [r.context, r.credentials])),
        };
      });
    },
    async save(g, by) {
      await d.db.transaction().execute(async (tx) => {
        const row = { name: g.name, description: g.description, position: g.position, permissions: JSON.stringify(g.permissions), updated_at: new Date().toISOString(), updated_by: by };
        await tx.insertInto("kubedeck_group").values({ id: g.id, ...row }).onConflict((oc) => oc.column("id").doUpdateSet(row)).execute();
        await tx.deleteFrom("group_cluster_access").where("group_id", "=", g.id).execute();
        if (g.access.length) await tx.insertInto("group_cluster_access").values(g.access.map((a) => accessRow(g, a))).execute();
      });
    },
    async remove(id) {
      await d.db.transaction().execute(async (tx) => {
        await tx.deleteFrom("group_cluster_access").where("group_id", "=", id).execute();
        await tx.deleteFrom("kubedeck_group").where("id", "=", id).execute();
      });
    },
    async reorder(ids) {
      await d.db.transaction().execute(async (tx) => {
        for (const [i, id] of ids.entries()) await tx.updateTable("kubedeck_group").set({ position: i }).where("id", "=", id).execute();
      });
    },
  };
}
