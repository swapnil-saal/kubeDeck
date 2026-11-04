import { useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import type { UseQueryResult } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { CommandBar, buildListCommands } from "@/components/CommandBar";
import { LiveRefresh } from "@/components/LiveRefresh";
import {
  useK8sConfigMaps, useK8sCronJobs, useK8sDaemonSets, useK8sDeployments, useK8sHpa, useK8sIngresses, useK8sJobs,
  useK8sNodes, useK8sPods, useK8sPvcs, useK8sSecrets, useK8sServices, useK8sStatefulSets,
} from "@/hooks/use-k8s";
import { useHashParams } from "@/hooks/use-hash-params";
import { useResourceNav } from "@/hooks/use-resource-nav";
import { useScopeFromUrl } from "@/hooks/use-scope-from-url";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { kindByKey, listHref } from "@/lib/resource-kinds";
import { SimpleResourceList, type SimpleKindKey } from "@/pages/dashboard/SimpleResourceList";
import { DeploymentList } from "@/pages/resources/DeploymentList";
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

/** `/resources/:kind` — one resource kind in the current scope. */
export default function ResourceList() {
  const [, params] = useRoute("/resources/:kind");
  const [, navigate] = useLocation();
  const kind = kindByKey(params?.kind ?? "");
  useScopeFromUrl();
  const { context, namespace } = useTerminalStore();
  const actions = useResourceActions({ context, namespace });
  const count = useCount(kind?.key ?? "", context, namespace);

  useEffect(() => {
    if (!kind) navigate(listHref("pods"), { replace: true });
  }, [kind, navigate]);
  if (!kind) return null;

  const scope = kind.clusterScoped ? "whole cluster" : namespace === "all" ? "all namespaces" : namespace;

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <AppHeader breadcrumbs={[{ label: "Overview", href: "/" }, { label: kind.label }]} rightSlot={<LiveRefresh />} />
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
              {context || "…"} · {scope}
            </span>
            <div className="ml-auto">{kind.key === "pods" && <PodViewToggle />}</div>
          </div>

          {/* keyed by kind: switching kinds starts fresh, and hooks stay in a fixed order */}
          {kind.key === "pods" ? (
            <PodList key="pods" context={context} namespace={namespace} actions={actions} />
          ) : kind.key === "deployments" ? (
            <DeploymentList key="deployments" context={context} namespace={namespace} actions={actions} />
          ) : (
            <SimpleKind key={kind.key} kind={kind.key as SimpleKindKey} context={context} namespace={namespace} />
          )}
        </div>
      </main>
      <CommandBar commands={buildListCommands(kind.kubectl, context, namespace)} />
      {actions.dialogs}
    </div>
  );
}
