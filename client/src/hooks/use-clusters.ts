import { useQuery } from "@tanstack/react-query";
import { buildUrl } from "@shared/routes";
import { clusterListSchema, clusterPaths, namespaceListSchema, type ClusterList, type CreateClusterInput } from "@shared/clusters";
import { getParsed, requestJson } from "@/lib/request-json";
import { useInvalidatingMutation } from "./use-invalidating-mutation";

const CLUSTERS = [clusterPaths.list];
const one = (name: string) => buildUrl(clusterPaths.one, { name: encodeURIComponent(name) });

/** Settings → Clusters (web admins): the clusters and KubeDeck's connection to each. */
export function useClusters(enabled = true) {
  return useQuery({ queryKey: CLUSTERS, queryFn: getParsed(clusterListSchema, clusterPaths.list), enabled, staleTime: 15_000 });
}

/** A cluster change can change what anyone sees: refresh the clusters, the groups and the cluster picker. */
const useClusterMutation = <V>(fn: (v: V) => Promise<ClusterList>) =>
  useInvalidatingMutation(fn, [{ queryKey: CLUSTERS }, { queryKey: ["/api/groups"] }, { queryKey: ["/api/k8s/contexts"] }]);

export const useAddCluster = () => useClusterMutation((v: CreateClusterInput) => requestJson<ClusterList>("POST", clusterPaths.list, v));
export const useReplaceConnection = () => useClusterMutation(({ name, kubeconfig }: { name: string; kubeconfig: string }) => requestJson<ClusterList>("PATCH", one(name), { kubeconfig }));
export const useRemoveCluster = () => useClusterMutation((name: string) => requestJson<ClusterList>("DELETE", one(name)));

/** A cluster's namespaces, read with its connection (for the group forms). */
export function useClusterNamespaces(name: string | undefined) {
  return useQuery({
    queryKey: [clusterPaths.namespaces, name],
    queryFn: getParsed(namespaceListSchema, buildUrl(clusterPaths.namespaces, { name: encodeURIComponent(name ?? "") })),
    enabled: !!name,
    staleTime: 60_000,
    retry: false,
  });
}
