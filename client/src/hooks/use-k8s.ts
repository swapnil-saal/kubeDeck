import { useQuery, useMutation } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { queryClient } from "@/lib/queryClient";

export function useK8sContexts() {
  return useQuery({
    queryKey: [api.k8s.contexts.path],
    queryFn: async () => {
      const res = await fetch(api.k8s.contexts.path);
      if (!res.ok) throw new Error("Failed to fetch contexts");
      return api.k8s.contexts.responses[200].parse(await res.json());
    },
  });
}

export function useK8sNamespaces(context?: string) {
  return useQuery({
    queryKey: [api.k8s.namespaces.path, context],
    queryFn: async () => {
      const url = buildUrl(api.k8s.namespaces.path, context ? { context } : undefined);
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch namespaces");
      return api.k8s.namespaces.responses[200].parse(await res.json());
    },
    enabled: !!context,
  });
}

export function useK8sPods(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.pods.path, context, namespace],
    queryFn: async () => {
      const url = buildUrl(api.k8s.pods.path, { 
        context: context || '', 
        namespace: namespace || '' 
      });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch pods");
      return api.k8s.pods.responses[200].parse(await res.json());
    },
    enabled: !!context,
  });
}

export function useDeletePod() {
  return useMutation({
    mutationFn: async ({ name, context, namespace }: { name: string; context: string; namespace: string }) => {
      const url = buildUrl(api.k8s.podDelete.path, { name, context, namespace });
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete pod");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.k8s.pods.path] });
    },
  });
}

export function usePodLogs(name: string, context: string, namespace: string, enabled: boolean) {
  return useQuery({
    queryKey: [api.k8s.podLogs.path, name, context, namespace],
    queryFn: async () => {
      const url = buildUrl(api.k8s.podLogs.path, { name, context, namespace });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch logs");
      return api.k8s.podLogs.responses[200].parse(await res.json());
    },
    enabled,
  });
}

export function usePodEnv(name: string, context: string, namespace: string, enabled: boolean) {
  return useQuery({
    queryKey: [api.k8s.podEnv.path, name, context, namespace],
    queryFn: async () => {
      const url = buildUrl(api.k8s.podEnv.path, { name, context, namespace });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch env");
      return api.k8s.podEnv.responses[200].parse(await res.json());
    },
    enabled,
  });
}

export function usePortForward() {
  return useMutation({
    mutationFn: async ({ name, context, namespace, port }: { name: string; context: string; namespace: string; port: number }) => {
      const url = buildUrl(api.k8s.portForward.path, { name, context, namespace });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });
      if (!res.ok) throw new Error("Failed to initiate port forward");
      return res.json();
    },
  });
}

export function useK8sDeployments(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.deployments.path, context, namespace],
    queryFn: async () => {
      const url = buildUrl(api.k8s.deployments.path, { 
        context: context || '', 
        namespace: namespace || '' 
      });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch deployments");
      return api.k8s.deployments.responses[200].parse(await res.json());
    },
    enabled: !!context,
  });
}

export function useK8sServices(context?: string, namespace?: string) {
  return useQuery({
    queryKey: [api.k8s.services.path, context, namespace],
    queryFn: async () => {
      const url = buildUrl(api.k8s.services.path, { 
        context: context || '', 
        namespace: namespace || '' 
      });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch services");
      return api.k8s.services.responses[200].parse(await res.json());
    },
    enabled: !!context,
  });
}
