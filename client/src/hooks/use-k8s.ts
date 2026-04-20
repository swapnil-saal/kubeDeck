import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback } from "react";
import { api, buildUrl } from "@shared/routes";
import type { RelatedResources, PortForwardEntry } from "@shared/routes";
import { queryClient } from "@/lib/queryClient";

const LIST_REFETCH_MS = 10_000;

class K8sError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "K8sError";
  }
  get isForbidden() { return this.status === 403; }
}

async function k8sFetch<T>(url: string, schema: { parse: (data: unknown) => T }): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const body = await res.json(); if (body.message) message = body.message; } catch {}
    throw new K8sError(message, res.status);
  }
  return schema.parse(await res.json());
}

async function k8sFetchRaw(url: string): Promise<{ content: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const body = await res.json(); if (body.message) message = body.message; } catch {}
    throw new K8sError(message, res.status);
  }
  return res.json();
}

async function k8sFetchJson<T = any>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const body = await res.json(); if (body.message) message = body.message; } catch {}
    throw new K8sError(message, res.status);
  }
  return res.json();
}

// ── List hooks ──────────────────────────────────────

export function useK8sContexts() {
  return useQuery({
    queryKey: [api.k8s.contexts.path],
    queryFn: () => k8sFetch(api.k8s.contexts.path, api.k8s.contexts.responses[200]),
  });
}

export function useK8sNamespaces(context?: string) {
  return useQuery({
    queryKey: [api.k8s.namespaces.path, context],
    queryFn: () => {
      const url = buildUrl(api.k8s.namespaces.path, context ? { context } : undefined);
      return k8sFetch(url, api.k8s.namespaces.responses[200]);
    },
    enabled: !!context,
  });
}

export function useK8sPods(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.pods.path, context, namespace],
    queryFn: () => {
      const url = buildUrl(api.k8s.pods.path, { context: context || '', namespace: namespace || '' });
      return k8sFetch(url, api.k8s.pods.responses[200]);
    },
    enabled: !!context,
    refetchInterval: LIST_REFETCH_MS,
    retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

export function useK8sDeployments(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.deployments.path, context, namespace],
    queryFn: () => {
      const url = buildUrl(api.k8s.deployments.path, { context: context || '', namespace: namespace || '' });
      return k8sFetch(url, api.k8s.deployments.responses[200]);
    },
    enabled: !!context,
    refetchInterval: LIST_REFETCH_MS,
    retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

export function useK8sServices(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.services.path, context, namespace],
    queryFn: () => {
      const url = buildUrl(api.k8s.services.path, { context: context || '', namespace: namespace || '' });
      return k8sFetch(url, api.k8s.services.responses[200]);
    },
    enabled: !!context,
    refetchInterval: LIST_REFETCH_MS,
    retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

// ── New resource hooks ──────────────────────────────

export function useK8sConfigMaps(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.configmaps.path, context, namespace],
    queryFn: () => k8sFetch(buildUrl(api.k8s.configmaps.path, { context: context || '', namespace: namespace || '' }), api.k8s.configmaps.responses[200]),
    enabled: !!context, refetchInterval: LIST_REFETCH_MS, retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

export function useK8sSecrets(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.secrets.path, context, namespace],
    queryFn: () => k8sFetch(buildUrl(api.k8s.secrets.path, { context: context || '', namespace: namespace || '' }), api.k8s.secrets.responses[200]),
    enabled: !!context, refetchInterval: LIST_REFETCH_MS, retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

export function useK8sIngresses(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.ingresses.path, context, namespace],
    queryFn: () => k8sFetch(buildUrl(api.k8s.ingresses.path, { context: context || '', namespace: namespace || '' }), api.k8s.ingresses.responses[200]),
    enabled: !!context, refetchInterval: LIST_REFETCH_MS, retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

export function useK8sStatefulSets(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.statefulsets.path, context, namespace],
    queryFn: () => k8sFetch(buildUrl(api.k8s.statefulsets.path, { context: context || '', namespace: namespace || '' }), api.k8s.statefulsets.responses[200]),
    enabled: !!context, refetchInterval: LIST_REFETCH_MS, retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

export function useK8sDaemonSets(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.daemonsets.path, context, namespace],
    queryFn: () => k8sFetch(buildUrl(api.k8s.daemonsets.path, { context: context || '', namespace: namespace || '' }), api.k8s.daemonsets.responses[200]),
    enabled: !!context, refetchInterval: LIST_REFETCH_MS, retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

export function useK8sJobs(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.jobs.path, context, namespace],
    queryFn: () => k8sFetch(buildUrl(api.k8s.jobs.path, { context: context || '', namespace: namespace || '' }), api.k8s.jobs.responses[200]),
    enabled: !!context, refetchInterval: LIST_REFETCH_MS, retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

export function useK8sCronJobs(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.cronjobs.path, context, namespace],
    queryFn: () => k8sFetch(buildUrl(api.k8s.cronjobs.path, { context: context || '', namespace: namespace || '' }), api.k8s.cronjobs.responses[200]),
    enabled: !!context, refetchInterval: LIST_REFETCH_MS, retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

export function useK8sNodes(context?: string) {
  return useQuery({
    queryKey: [api.k8s.nodes.path, context],
    queryFn: () => k8sFetch(buildUrl(api.k8s.nodes.path, { context: context || '' }), api.k8s.nodes.responses[200]),
    enabled: !!context, refetchInterval: LIST_REFETCH_MS, retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

export function useK8sHpa(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.hpa.path, context, namespace],
    queryFn: () => k8sFetch(buildUrl(api.k8s.hpa.path, { context: context || '', namespace: namespace || '' }), api.k8s.hpa.responses[200]),
    enabled: !!context, refetchInterval: LIST_REFETCH_MS, retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

export function useK8sPvcs(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.pvcs.path, context, namespace],
    queryFn: () => k8sFetch(buildUrl(api.k8s.pvcs.path, { context: context || '', namespace: namespace || '' }), api.k8s.pvcs.responses[200]),
    enabled: !!context, refetchInterval: LIST_REFETCH_MS, retry: (fc, err) => err instanceof K8sError && err.isForbidden ? false : fc < 2,
  });
}

// ── Deployment actions ──────────────────────────────

export function useScaleDeployment() {
  return useMutation({
    mutationFn: async ({ name, context, namespace, replicas }: { name: string; context: string; namespace: string; replicas: number }) => {
      const url = buildUrl(api.k8s.deploymentScale.path, { name, context, namespace });
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replicas }) });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new K8sError(body.message || "Failed", res.status); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [api.k8s.deployments.path] }); },
  });
}

export function useRestartDeployment() {
  return useMutation({
    mutationFn: async ({ name, context, namespace }: { name: string; context: string; namespace: string }) => {
      const url = buildUrl(api.k8s.deploymentRestart.path, { name, context, namespace });
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new K8sError(body.message || "Failed", res.status); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [api.k8s.deployments.path] }); },
  });
}

export function useApplyYaml() {
  return useMutation({
    mutationFn: async ({ yaml, context }: { yaml: string; context: string }) => {
      const url = buildUrl(api.k8s.resourceApply.path, { context });
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ yaml }) });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new K8sError(body.message || "Failed", res.status); }
      return res.json() as Promise<{ message: string }>;
    },
  });
}

// ── Pod actions ─────────────────────────────────────

export function useDeletePod() {
  return useMutation({
    mutationFn: async ({ name, context, namespace }: { name: string; context: string; namespace: string }) => {
      const url = buildUrl(api.k8s.podDelete.path, { name, context, namespace });
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new K8sError(body.message || "Failed", res.status); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [api.k8s.pods.path] }); },
  });
}

export function usePodLogs(name: string, context: string, namespace: string, enabled: boolean) {
  return useQuery({
    queryKey: [api.k8s.podLogs.path, name, context, namespace],
    queryFn: () => {
      const url = buildUrl(api.k8s.podLogs.path, { name, context, namespace });
      return k8sFetch(url, api.k8s.podLogs.responses[200]);
    },
    enabled,
    retry: false,
  });
}

export function usePodEnv(name: string, context: string, namespace: string, enabled: boolean, container?: string) {
  return useQuery({
    queryKey: [api.k8s.podEnv.path, name, context, namespace, container],
    queryFn: () => {
      const params: Record<string, string> = { name, context, namespace };
      if (container) params.container = container;
      return k8sFetch(buildUrl(api.k8s.podEnv.path, params), api.k8s.podEnv.responses[200]);
    },
    enabled,
    retry: false,
  });
}

// ── Port Forward (with state) ───────────────────────

export function usePortForward() {
  return useMutation({
    mutationFn: async ({ name, context, namespace, port, remotePort }: { name: string; context: string; namespace: string; port: number; remotePort?: number }) => {
      const url = buildUrl(api.k8s.portForward.path, { name, context, namespace });
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port, remotePort }) });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new K8sError(body.message || "Failed", res.status); }
      return res.json() as Promise<{ message: string; id: string }>;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [api.k8s.portForwards.path] }); },
  });
}

export function usePortForwards() {
  return useQuery({
    queryKey: [api.k8s.portForwards.path],
    queryFn: () => k8sFetchJson<PortForwardEntry[]>(api.k8s.portForwards.path),
    refetchInterval: 5000,
  });
}

export function useStopPortForward() {
  return useMutation({
    mutationFn: async (id: string) => {
      const url = buildUrl(api.k8s.portForwardStop.path, { id });
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new K8sError(body.message || "Failed", res.status); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [api.k8s.portForwards.path] }); },
  });
}

// ── Detail hooks ────────────────────────────────────

export function useResourceDescribe(type: string, name: string, context: string, namespace: string, enabled = true) {
  return useQuery({
    queryKey: ["resourceDescribe", type, name, context, namespace],
    queryFn: () => k8sFetchRaw(buildUrl(api.k8s.resourceDescribe.path, { type, name, context, namespace })),
    enabled: !!name && enabled,
    retry: false,
  });
}

export function useResourceYaml(type: string, name: string, context: string, namespace: string, enabled = true) {
  return useQuery({
    queryKey: ["resourceYaml", type, name, context, namespace],
    queryFn: () => k8sFetchRaw(buildUrl(api.k8s.resourceYaml.path, { type, name, context, namespace })),
    enabled: !!name && enabled,
    retry: false,
  });
}

export function useResourceEvents(type: string, name: string, context: string, namespace: string, enabled = true) {
  return useQuery({
    queryKey: ["resourceEvents", type, name, context, namespace],
    queryFn: () => k8sFetchRaw(buildUrl(api.k8s.resourceEvents.path, { type, name, context, namespace })),
    enabled: !!name && enabled,
    retry: false,
    refetchInterval: 15000,
  });
}

export function useResourceRelated(type: string, name: string, context: string, namespace: string, enabled = true) {
  return useQuery({
    queryKey: ["resourceRelated", type, name, context, namespace],
    queryFn: () => k8sFetchJson<RelatedResources>(buildUrl(api.k8s.resourceRelated.path, { type, name, context, namespace })),
    enabled: !!name && enabled,
    retry: false,
  });
}

// ── Streaming logs hook (SSE) ───────────────────────

export function useStreamingLogs(name: string, context: string, namespace: string, enabled: boolean, container?: string) {
  const [logs, setLogs] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const clear = useCallback(() => setLogs([]), []);

  useEffect(() => {
    if (!enabled || !name) {
      esRef.current?.close();
      esRef.current = null;
      setIsConnected(false);
      return;
    }
    setLogs([]);
    const params = new URLSearchParams({ context, namespace });
    if (container) params.set("container", container);
    const url = `/api/k8s/pods/${encodeURIComponent(name)}/logs/stream?${params.toString()}`;
    const es = new EventSource(url);
    esRef.current = es;
    es.onopen = () => setIsConnected(true);
    es.onmessage = (event) => {
      try {
        const line = JSON.parse(event.data);
        if (line === "[stream connected]") return;
        if (line === "[stream ended]") { setIsConnected(false); return; }
        setLogs(prev => { const next = [...prev, line]; return next.length > 5000 ? next.slice(-5000) : next; });
      } catch { setLogs(prev => [...prev, event.data]); }
    };
    es.onerror = () => { setIsConnected(false); es.close(); };
    return () => { es.close(); esRef.current = null; setIsConnected(false); };
  }, [name, context, namespace, container, enabled]);

  return { logs, isConnected, clear };
}

export { K8sError };
