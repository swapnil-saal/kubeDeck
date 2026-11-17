/**
 * The clusters of a shared (web) KubeDeck (see shared/clusters.ts): added by an admin with the
 * connection KubeDeck uses for each. Web mode reads no kubeconfig from disk; these are its clusters.
 * This module owns the `kubedeck_cluster` table.
 */
export { addCluster, clusterFile, clusterNames, inClusterAvailable, listClusters, removeCluster, replaceConnection, startClusters, stopClusters } from "./manager";
export { registerClusterRoutes, type ClusterRouteDeps } from "./routes";
export { databaseClusterStore, type ClusterStore } from "./store";
