/**
 * Clusters of a shared (web) KubeDeck: added by an admin under Settings → Clusters, each with the
 * connection KubeDeck itself uses for it (an uploaded kubeconfig, or the pod's own service account
 * when KubeDeck runs inside that cluster). Web mode never reads a kubeconfig from the server's disk:
 * these are the only clusters, and people reach one only through a group (Settings → Groups).
 */
import { z } from "zod";
import { contextNameSchema } from "./groups";

export const clusterPaths = {
  list: "/api/clusters",
  one: "/api/clusters/:name",
  /** a cluster's namespaces, read with its connection (for the group forms) */
  namespaces: "/api/clusters/:name/namespaces",
} as const;

export const clusterInfoSchema = z.object({
  name: z.string(),
  source: z.enum(["kubeconfig", "in-cluster"]),
  /** whom the connection signs in as ("" when the cluster could not say) */
  identity: z.string(),
  server: z.string(),
  /** the groups that have a service account on it */
  usedBy: z.array(z.string()),
});
export type ClusterInfo = z.infer<typeof clusterInfoSchema>;

export const clusterListSchema = z.object({
  clusters: z.array(clusterInfoSchema),
  /** KubeDeck runs in a pod, so "this cluster" (its own service account) can be added */
  inClusterAvailable: z.boolean(),
});
export type ClusterList = z.infer<typeof clusterListSchema>;

export const createClusterSchema = z.discriminatedUnion("source", [
  z.object({ name: contextNameSchema, source: z.literal("kubeconfig"), kubeconfig: z.string().min(1, "Upload or paste a kubeconfig.").max(64_000) }),
  z.object({ name: contextNameSchema, source: z.literal("in-cluster") }),
]);
export type CreateClusterInput = z.input<typeof createClusterSchema>;

export const updateClusterSchema = z.object({ kubeconfig: z.string().min(1).max(64_000) });

export const namespaceListSchema = z.object({ namespaces: z.array(z.string()), error: z.string().optional() });
