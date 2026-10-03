import { useQuery } from "@tanstack/react-query";
import { buildUrl } from "@shared/routes";
import { K8sError, k8sFetchJson, LIST_REFETCH_MS } from "@/hooks/use-k8s";
import type { UsageLike } from "@/lib/cluster-health";

/** Who can read what — lets the UI offer namespaces the user can open instead of "Access denied". */
export interface NamespaceAccess {
  all: boolean;
  namespaces: { name: string; canListPods: boolean }[];
  listed: boolean;
}

export function useNamespaceAccess(context?: string) {
  return useQuery({
    queryKey: ["namespaceAccess", context],
    queryFn: () => k8sFetchJson<NamespaceAccess>(buildUrl("/api/k8s/namespace-access", { context: context || "" })),
    enabled: !!context,
    staleTime: 60_000,
    retry: false,
  });
}

interface MetricsResponse<T> {
  available: boolean;
  reason?: "forbidden" | "no-metrics-server" | "error";
  items?: T[];
}

/** Live pod CPU / memory (metrics-server). `available:false` is a normal answer, not an error. */
export function usePodMetrics(context?: string, namespace?: string) {
  return useQuery({
    queryKey: ["podMetrics", context, namespace],
    queryFn: () => k8sFetchJson<MetricsResponse<UsageLike>>(buildUrl("/api/k8s/metrics/pods", { context: context || "", namespace: namespace || "" })),
    enabled: !!context,
    refetchInterval: LIST_REFETCH_MS * 3,
    staleTime: 15_000,
    retry: false,
  });
}

export interface NodeUsage { name: string; cpuMilli: number; cpuPct: number; memMi: number; memPct: number }

export function useNodeMetrics(context?: string) {
  return useQuery({
    queryKey: ["nodeMetrics", context],
    queryFn: () => k8sFetchJson<MetricsResponse<NodeUsage>>(buildUrl("/api/k8s/metrics/nodes", { context: context || "" })),
    enabled: !!context,
    refetchInterval: LIST_REFETCH_MS * 3,
    staleTime: 15_000,
    retry: false,
  });
}

export interface ClusterSummary {
  pods?: { total: number; running: number; pending: number; failing: number };
  deployments?: { ready: number; total: number } | null;
  nodes?: { ready: number; total: number } | null;
  error?: "forbidden" | "unreachable" | "error";
  message?: string;
}

/** One small health summary for a cluster (multi-cluster overview). Not polled: it is a snapshot. */
export function useClusterSummary(context: string, namespace: string, enabled = true) {
  return useQuery({
    queryKey: ["clusterSummary", context, namespace],
    queryFn: () => k8sFetchJson<ClusterSummary>(buildUrl("/api/k8s/summary", { context, namespace })),
    enabled: enabled && !!context,
    staleTime: 60_000,
    retry: (count, err) => !(err instanceof K8sError) && count < 1,
  });
}
