import { useEffect, useMemo, useState } from "react";
import { Plus, Puzzle } from "lucide-react";
import type { ApiResource } from "@shared/routes";
import { CreateResourceDialog } from "@/components/yaml/CreateResourceDialog";
import { useServerMode } from "@/hooks/use-server-mode";
import { skeletonFor, templateFor, YAML_TEMPLATES } from "@/lib/yaml-templates";
import { useLocation, useRoute } from "wouter";
import type { UseQueryResult } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { CommandBar, buildListCommands } from "@/components/CommandBar";
import { LiveRefresh } from "@/components/LiveRefresh";
import {
  useK8sConfigMaps, useK8sCronJobs, useK8sDaemonSets, useK8sDeployments, useK8sHpa, useK8sIngresses, useK8sJobs,
  useApiResources, useK8sNodes, useK8sPods, useK8sPvcs, useK8sSecrets, useK8sServices, useK8sStatefulSets,
} from "@/hooks/use-k8s";
import { useHashParams } from "@/hooks/use-hash-params";
import { useResourceNav } from "@/hooks/use-resource-nav";
import { useScopeFromUrl } from "@/hooks/use-scope-from-url";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { kindByKey, type ResourceKind } from "@/lib/resource-kinds";
import { SimpleResourceList, type SimpleKindKey } from "@/pages/dashboard/SimpleResourceList";
import { DeploymentList } from "@/pages/resources/DeploymentList";
import { GenericList } from "@/pages/resources/GenericList";
import { PodList, PodViewToggle } from "@/pages/resources/PodList";
import { useResourceActions } from "@/pages/resources/resource-actions";

type ListHook = (context: string, namespace: string) => UseQueryResult<any[], Error>;

/** One query per simple kind; the page mounts per kind, so only that kind is ever fetched. */
const SIMPLE_QUERIES: Record<SimpleKindKey, ListHook> = {
  services: useK8sServices as ListHook,
  statefulsets: useK8sStatefulSets as ListHook,
  daemonsets: useK8sDaemonSets as ListHook,
  jobs: useK8sJobs as ListHook,
  cronjobs: useK8sCronJobs as ListHook,
  configmaps: useK8sConfigMaps as ListHook,
  secrets: useK8sSecrets as ListHook,
  ingresses: useK8sIngresses as ListHook,
  nodes: ((context: string) => useK8sNodes(context)) as ListHook,
  hpa: useK8sHpa as ListHook,
  pvcs: useK8sPvcs as ListHook,
};

/** Item count for the heading: pods and deployments are polled app-wide (alerts), so this is free. */
function useCount(kindKey: string, context: string, namespace: string): number | undefined {
  const pods = useK8sPods(context, namespace).data;
  const deployments = useK8sDeployments(context, namespace).data;
  return kindKey === "pods" ? pods?.length : kindKey === "deployments" ? deployments?.length : undefined;
}

function SimpleKind({ kind, context, namespace }: { kind: SimpleKindKey; context: string; namespace: string }) {
  const { get, set } = useHashParams();
  const { openDetail } = useResourceNav();
  const query = SIMPLE_QUERIES[kind](context, namespace);
  return (
    <SimpleResourceList
      kind={kind}
      query={{ data: query.data, isLoading: query.isLoading, isError: query.isError, error: query.error }}
      search={get("q") || ""}
      onSearchChange={(q) => set("q", q || null)}
      nsScoped={namespace !== "all"}
      goToDetail={openDetail}
    />
  );
}

/** A kind from the registry, or any listable kind the cluster serves (custom resources included). */
function useKind(key: string, context: string): { kind?: ResourceKind; group?: string; api?: ApiResource; unknown: boolean } {
  const known = kindByKey(key);
  // discovery is cached; it also tells "Create" the apiVersion of kinds without a template
  const discovery = useApiResources(context);
  return useMemo(() => {
    const r = discovery.data?.find((d) => d.id === key || d.name === key || (known && (d.name === known.kubectl || d.shortNames.includes(known.kubectl))));
    if (known) return { kind: known, api: r, unknown: false };
    if (!r) return { unknown: discovery.isSuccess || discovery.isError };
    const label = r.name.charAt(0).toUpperCase() + r.name.slice(1);
    return {
      kind: { key: r.id, label, type: r.id, kubectl: r.id, icon: Puzzle, group: "Cluster", clusterScoped: !r.namespaced, generic: true },
      group: r.group || "core",
      api: r,
      unknown: false,
    };
  }, [known, key, discovery.data, discovery.isSuccess, discovery.isError]);
}

/** `/resources/:kind` — one resource kind in the current scope. */
export default function ResourceList() {
  const [, params] = useRoute("/resources/:kind");
  const [, navigate] = useLocation();
  useScopeFromUrl();
  const { context, namespace } = useTerminalStore();
  const { kind, group, api, unknown } = useKind(decodeURIComponent(params?.kind ?? ""), context);
  const { canWrite } = useServerMode();
  const [creating, setCreating] = useState(false);
  const starter =
    templateFor(kind?.key)?.yaml ??
    (api ? skeletonFor(api.kind, api.group ? `${api.group}/${api.version}` : api.version, api.namespaced) : YAML_TEMPLATES[0].yaml);
  const actions = useResourceActions({ context, namespace });
  const count = useCount(kind?.key ?? "", context, namespace);

  useEffect(() => {
    if (unknown) navigate("/resources", { replace: true });
  }, [unknown, navigate]);
  if (!kind) return null;

  const scope = kind.clusterScoped ? "whole cluster" : namespace === "all" ? "all namespaces" : namespace;

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <AppHeader
        breadcrumbs={[{ label: "Overview", href: "/" }, ...(group ? [{ label: "All resources", href: "/resources" }] : []), { label: kind.label }]}
        rightSlot={<LiveRefresh />}
      />
      <main className="relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-3 px-5 py-4 sm:px-7">
          {/* one row: what this is, how many, where; kind-specific controls on the right */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <kind.icon className="h-4 w-4" />
            </span>
            <h1 className="flex items-baseline gap-2 text-lg font-bold tracking-tight text-foreground">
              {kind.label}
              {count !== undefined && <span className="text-sm font-medium tabular-nums text-muted-foreground">{count}</span>}
            </h1>
            <span className="text-xs text-muted-foreground">
              {context || "…"} · {scope}{group ? ` · ${group}` : ""}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {kind.key === "pods" && <PodViewToggle />}
              {canWrite && kind.key !== "events" && (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
                >
                  <Plus className="h-3.5 w-3.5" />Create
                </button>
              )}
            </div>
          </div>

          {/* keyed by kind: switching kinds starts fresh, and hooks stay in a fixed order */}
          {kind.key === "pods" ? (
            <PodList key="pods" context={context} namespace={namespace} actions={actions} />
          ) : kind.key === "deployments" ? (
            <DeploymentList key="deployments" context={context} namespace={namespace} actions={actions} />
          ) : kind.generic ? (
            <GenericList key={kind.key} type={kind.type} label={kind.label} context={context} namespace={namespace} clusterScoped={kind.clusterScoped} />
          ) : (
            <SimpleKind key={kind.key} kind={kind.key as SimpleKindKey} context={context} namespace={namespace} />
          )}
        </div>
      </main>
      <CommandBar commands={buildListCommands(kind.kubectl, context, namespace)} />
      {actions.dialogs}
      {canWrite && (
        <CreateResourceDialog
          open={creating}
          onClose={() => setCreating(false)}
          context={context}
          namespace={kind.clusterScoped ? "" : namespace}
          initialYaml={starter}
        />
      )}
    </div>
  );
}
