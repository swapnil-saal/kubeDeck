import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback } from "react";
import { api, buildUrl } from "@shared/routes";
import { queryClient } from "@/lib/queryClient";

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
    retry: (failureCount, error) => {
      if (error instanceof K8sError && error.isForbidden) return false;
      return failureCount < 2;
    },
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
    retry: (failureCount, error) => {
      if (error instanceof K8sError && error.isForbidden) return false;
      return failureCount < 2;
    },
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
    retry: (failureCount, error) => {
      if (error instanceof K8sError && error.isForbidden) return false;
      return failureCount < 2;
    },
  });
}

// ── Pod actions ─────────────────────────────────────

export function useDeletePod() {
  return useMutation({
    mutationFn: async ({ name, context, namespace }: { name: string; context: string; namespace: string }) => {
      const url = buildUrl(api.k8s.podDelete.path, { name, context, namespace });
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new K8sError(body.message || "Failed to delete pod", res.status); }
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
      const url = buildUrl(api.k8s.podEnv.path, params);
      return k8sFetch(url, api.k8s.podEnv.responses[200]);
    },
    enabled,
    retry: false,
  });
}

export function usePortForward() {
  return useMutation({
    mutationFn: async ({ name, context, namespace, port }: { name: string; context: string; namespace: string; port: number }) => {
      const url = buildUrl(api.k8s.portForward.path, { name, context, namespace });
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port }) });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new K8sError(body.message || "Failed", res.status); }
      return res.json();
    },
  });
}

// ── Detail hooks ────────────────────────────────────

export function useResourceDescribe(type: string, name: string, context: string, namespace: string, enabled = true) {
  return useQuery({
    queryKey: ["resourceDescribe", type, name, context, namespace],
    queryFn: () => {
      const url = buildUrl(api.k8s.resourceDescribe.path, { type, name, context, namespace });
      return k8sFetchRaw(url);
    },
    enabled: !!name && enabled,
    retry: false,
  });
}

export function useResourceYaml(type: string, name: string, context: string, namespace: string, enabled = true) {
  return useQuery({
    queryKey: ["resourceYaml", type, name, context, namespace],
    queryFn: () => {
      const url = buildUrl(api.k8s.resourceYaml.path, { type, name, context, namespace });
      return k8sFetchRaw(url);
    },
    enabled: !!name && enabled,
    retry: false,
  });
}

export function useResourceEvents(type: string, name: string, context: string, namespace: string, enabled = true) {
  return useQuery({
    queryKey: ["resourceEvents", type, name, context, namespace],
    queryFn: () => {
      const url = buildUrl(api.k8s.resourceEvents.path, { type, name, context, namespace });
      return k8sFetchRaw(url);
    },
    enabled: !!name && enabled,
    retry: false,
    refetchInterval: 15000, // refresh events every 15s
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
        setLogs(prev => {
          const next = [...prev, line];
          // Keep last 5000 lines to prevent memory bloat
          return next.length > 5000 ? next.slice(-5000) : next;
        });
      } catch {
        setLogs(prev => [...prev, event.data]);
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
      setIsConnected(false);
    };
  }, [name, context, namespace, container, enabled]);

  return { logs, isConnected, clear };
}

export { K8sError };
