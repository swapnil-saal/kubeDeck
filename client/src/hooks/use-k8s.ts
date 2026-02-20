import { useQuery } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";

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
    enabled: !!context, // Only fetch if context is selected
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
