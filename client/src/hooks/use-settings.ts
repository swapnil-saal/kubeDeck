import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { SettingsResponse, KubeconfigFileInfo } from "@shared/routes";
import { queryClient } from "@/lib/queryClient";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return res.json();
}

export function useSettings() {
  return useQuery({
    queryKey: [api.settings.get.path],
    queryFn: () => fetchJson<SettingsResponse>(api.settings.get.path),
  });
}

export function useUpdateSettings() {
  return useMutation({
    mutationFn: async (kubeconfigPaths: string[]) => {
      const res = await fetch(api.settings.update.path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kubeconfigPaths }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to save settings");
      }
      return res.json() as Promise<{ message: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.settings.get.path] });
    },
  });
}

export interface AiSettingsInput {
  provider: string;
  apiKey: string;
  model: string;
  fastModel: string;
  baseUrl: string;
}

/** Save the AI provider settings (the kubeconfig list is sent unchanged, as the API expects both). */
export function useUpdateAiSettings() {
  return useMutation({
    mutationFn: async ({ ai, kubeconfigPaths }: { ai: AiSettingsInput; kubeconfigPaths: string[] }) => {
      const res = await fetch(api.settings.update.path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kubeconfigPaths, ai }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to save AI settings");
      }
      return res.json() as Promise<{ message: string }>;
    },
    // every AI feature reads these settings: refresh them right away
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.settings.get.path] }),
  });
}

export function useKubeconfigScan() {
  return useQuery({
    queryKey: [api.settings.kubeconfigScan.path],
    queryFn: () => fetchJson<KubeconfigFileInfo[]>(api.settings.kubeconfigScan.path),
    enabled: false, // only fetch on demand
  });
}
