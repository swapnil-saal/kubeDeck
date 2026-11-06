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

/** PUT /api/settings; the server keeps whatever part the body leaves out (except the kubeconfig list). */
async function putSettings(body: Record<string, unknown>, failure: string): Promise<{ message: string }> {
  const res = await fetch(api.settings.update.path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || failure);
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
    mutationFn: (kubeconfigPaths: string[]) => putSettings({ kubeconfigPaths }, "Failed to save settings"),
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
    mutationFn: ({ ai, kubeconfigPaths }: { ai: AiSettingsInput; kubeconfigPaths: string[] }) =>
      putSettings({ kubeconfigPaths, ai }, "Failed to save AI settings"),
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

export interface ObservabilityInput {
  tempoUrl: string;
  tempoToken: string;
  tempoTenant: string;
  lokiUrl: string;
  lokiToken: string;
  lokiTenant: string;
  clusters: Record<string, string>;
  grafanaUrl: string;
  grafanaTempoDatasource: string;
  mcpUrl: string;
  mcpToken: string;
}

/** Save the Tempo / Grafana settings (the kubeconfig list and AI settings stay as they are). */
export function useUpdateObservability() {
  return useMutation({
    mutationFn: ({ observability, kubeconfigPaths }: { observability: ObservabilityInput; kubeconfigPaths: string[] }) =>
      putSettings({ kubeconfigPaths, observability }, "Failed to save the observability settings"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.settings.get.path] });
      // tracing status, clusters and the Grafana connection all depend on these
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/traces") });
    },
  });
}
