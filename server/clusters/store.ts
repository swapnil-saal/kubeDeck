/** Clusters and KubeDeck's connection to each in the `kubedeck_cluster` table (this module owns it). */
import type { Database } from "../db";

export interface StoredCluster {
  name: string;
  source: "kubeconfig" | "in-cluster";
  /** the uploaded kubeconfig, encrypted; "" for the pod's own service account */
  credentials: string;
  identity: string;
  server: string;
}

export interface ClusterStore {
  all(): Promise<StoredCluster[]>;
  save(c: StoredCluster, by: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export function databaseClusterStore(d: Database): ClusterStore {
  return {
    async all() {
      const rows = await d.db.selectFrom("kubedeck_cluster").selectAll().orderBy("name").execute();
      return rows.map((r) => ({
        name: r.name,
        source: r.source === "in-cluster" ? "in-cluster" : "kubeconfig",
        credentials: r.credentials ?? "",
        identity: r.identity ?? "",
        server: r.server ?? "",
      }));
    },
    async save(c, by) {
      const row = { source: c.source, credentials: c.credentials, identity: c.identity, server: c.server, updated_at: new Date().toISOString(), updated_by: by };
      await d.db.insertInto("kubedeck_cluster").values({ name: c.name, ...row }).onConflict((oc) => oc.column("name").doUpdateSet(row)).execute();
    },
    async remove(name) {
      await d.db.deleteFrom("kubedeck_cluster").where("name", "=", name).execute();
    },
  };
}
