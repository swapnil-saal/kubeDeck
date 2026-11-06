import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Box, Layers, Network, RefreshCw, RotateCw, Server, Sparkles, X, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { OverviewViews } from "@/components/OverviewViews";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Button } from "@/components/ui/button";
import {
  useK8sContexts, useK8sPods, useK8sDeployments, useK8sServices, useK8sIngresses, useK8sJobs,
  useK8sNodes, useK8sPvcs, useClusterEvents, K8sError,
} from "@/hooks/use-k8s";
import { useNamespaceAccess, usePodMetrics, useNodeMetrics } from "@/hooks/use-cluster-extras";
import { useHashParams } from "@/hooks/use-hash-params";
import { useResourceNav } from "@/hooks/use-resource-nav";
import { useScopeFromUrl } from "@/hooks/use-scope-from-url";
import { useServerMode } from "@/hooks/use-server-mode";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import {
  analyzeHealth, parseCpuMilli, parseMemMi, recentChanges,
  type DeployLike, type EventLike, type JobLike, type NodeLike, type PodLike, type PvcLike,
} from "@/lib/cluster-health";
import { kindByKey, listHref } from "@/lib/resource-kinds";
import { AccessGate } from "@/pages/dashboard/AccessGate";
import { ConnectionGate } from "@/pages/dashboard/ConnectionGate";
import { HomeOverview } from "@/pages/dashboard/HomeOverview";
import { PinnedRecent } from "@/pages/dashboard/PinnedRecent";
import { StatTiles, type Tile, type TileState } from "@/pages/dashboard/StatTiles";

/** `/` — the health of the selected scope. Resource lists live at `/resources/:kind`. */
export default function Dashboard() {
  const { context: currentContext, namespace: currentNamespace, setContext: handleSetContext, setNamespace } = useTerminalStore();
  const [, navigate] = useLocation();
  const { get: getParam } = useHashParams();
  const { openDetail, openLogs, askAi } = useResourceNav();
  const serverMode = useServerMode();
  useScopeFromUrl();

  // Links from before the sidebar (`/?tab=deployments&q=api`) open the matching list.
  const legacyTab = getParam("tab");
  useEffect(() => {
    if (!legacyTab) return;
    const kind = kindByKey(legacyTab) ?? kindByKey("pods")!;
    const keep = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    keep.delete("tab");
    const qs = keep.toString();
    navigate(`/resources/${kind.key}${qs ? `?${qs}` : ""}`, { replace: true });
  }, [legacyTab, navigate]);

  const openList = (key: string, filter: "bad" | "restarts" | null) => navigate(listHref(key, filter));

  const {
    data: contexts,
    isFetched: contextsFetched,
    fetchStatus: contextsFetchStatus,
    error: contextsErrorObj,
    refetch: refetchContexts,
  } = useK8sContexts();

  // React Query clears `error` and flips `status` back to "pending" every time a
  // query that holds no data refetches. Keep the last failure so the error
  // screen below stays put instead of bouncing back to the spinner.
  const [contextsFailure, setContextsFailure] = useState<string | null>(null);
  useEffect(() => {
    if (contextsErrorObj) {
      setContextsFailure(contextsErrorObj instanceof Error ? contextsErrorObj.message : String(contextsErrorObj));
    } else if (contexts) {
      setContextsFailure(null);
    }
  }, [contextsErrorObj, contexts]);

  useEffect(() => {
    if (contexts && contexts.length > 0 && !currentContext) {
      const active = contexts.find((c) => c.isCurrent);
      handleSetContext((active || contexts[0]).name);
    }
  }, [contexts, currentContext, handleSetContext]);

  // Only what the health view and the tiles need; full lists load on their own pages.
  const { data: pods, isLoading: podsLoading, isFetching: podsFetching, isError: podsError, error: podsErrorObj, refetch: refetchPods } = useK8sPods(currentContext, currentNamespace);
  const { data: deployments, isLoading: deployLoading, isError: deployError, error: deployErrorObj } = useK8sDeployments(currentContext, currentNamespace);
  const { data: services, isLoading: servicesLoading, isError: servicesError, error: servicesErrorObj } = useK8sServices(currentContext, currentNamespace);
  const { data: ingresses } = useK8sIngresses(currentContext, currentNamespace);
  const { data: jobs } = useK8sJobs(currentContext, currentNamespace);
  const { data: pvcs } = useK8sPvcs(currentContext, currentNamespace);
  const { data: nodes, isLoading: nodesLoading, isError: nodesError, error: nodesErrorObj } = useK8sNodes(currentContext);

  const access = useNamespaceAccess(currentContext);
  const podMetrics = usePodMetrics(currentContext, currentNamespace);
  const nodeMetrics = useNodeMetrics(currentContext);
  const eventsQ = useClusterEvents(currentContext, currentNamespace, { warningsOnly: false, maxAgeMinutes: 60 });
  const podsForbidden = podsError && podsErrorObj instanceof K8sError && podsErrorObj.isForbidden;
  const podsUnreachable = podsError && podsErrorObj instanceof K8sError && podsErrorObj.isUnreachable;

  // If the saved scope isn't readable (e.g. "all namespaces" for a namespace-scoped user), move to
  // one that is — once per cluster, so a deliberate later choice is never overridden.
  const autoSwitched = useRef<Set<string>>(new Set());
  const [switchedNote, setSwitchedNote] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    const a = access.data;
    if (!a || !currentContext || autoSwitched.current.has(currentContext)) return;
    const denied = currentNamespace === "all" ? !a.all : a.namespaces.find((n) => n.name === currentNamespace)?.canListPods === false;
    if (!denied) return;
    const readable = a.namespaces.filter((n) => n.canListPods);
    if (readable.length === 0) return;
    autoSwitched.current.add(currentContext);
    const pick = readable.find((n) => n.name === "default") ?? readable[0];
    setNamespace(pick.name);
    setSwitchedNote({ from: currentNamespace, to: pick.name });
  }, [access.data, currentContext, currentNamespace, setNamespace]);
  useEffect(() => setSwitchedNote(null), [currentContext]);

  // One health engine for the whole app. A pod list that could not be read is `undefined`
  // (no score), never an empty list that would look healthy.
  const usageItems = podMetrics.data?.available ? podMetrics.data.items : undefined;
  const health = useMemo(
    () => analyzeHealth({
      pods: pods as unknown as PodLike[] | undefined,
      deployments: deployments as unknown as DeployLike[] | undefined,
      nodes: nodes as unknown as NodeLike[] | undefined,
      jobs: jobs as unknown as JobLike[] | undefined,
      pvcs: pvcs as unknown as PvcLike[] | undefined,
      events: eventsQ.data as unknown as EventLike[] | undefined,
      usage: usageItems,
    }),
    [pods, deployments, nodes, jobs, pvcs, eventsQ.data, usageItems],
  );
  const changes = useMemo(
    () => recentChanges({ pods: pods as unknown as PodLike[] | undefined, events: eventsQ.data as unknown as EventLike[] | undefined }),
    [pods, eventsQ.data],
  );
  const requests = useMemo(() => {
    let cpuMilli = 0, memMi = 0;
    for (const p of pods ?? []) { cpuMilli += parseCpuMilli(p.cpu); memMi += parseMemMi(p.memory); }
    return { cpuMilli, memMi };
  }, [pods]);
  const usageTotals = useMemo(
    () => (usageItems ? { cpuMilli: usageItems.reduce((t, u) => t + u.cpuMilli, 0), memMi: usageItems.reduce((t, u) => t + u.memMi, 0) } : null),
    [usageItems],
  );

  // Gate the spinner on whether the request has ever settled, never on the live
  // status: a refetch resets that to "pending" and would hang the screen again.
  // "paused" means React Query shelved the request and will not settle it.
  if (!currentContext && !contextsFetched && contextsFetchStatus !== "paused") {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
          <p className="text-muted-foreground text-sm font-medium">Connecting to cluster...</p>
        </div>
      </div>
    );
  }

  // The contexts request has settled but produced nothing usable. Never keep the
  // spinner up here — show what went wrong and how to recover.
  if (!currentContext) {
    const detail = contextsFailure
      ?? (contextsFetchStatus === "paused"
        ? "The request was shelved before it could complete, usually because the machine looked offline. Retry once you are back online."
        : "kubectl returned no contexts. Check that your kubeconfig contains at least one cluster.");
    return (
      <div className="flex flex-col h-full overflow-hidden text-foreground">
        <AppHeader breadcrumbs={[{ label: "Overview" }]} />
        <div className="flex-1 flex items-center justify-center p-7">
          <div className="max-w-xl w-full rounded-xl border border-destructive/20 bg-destructive/5 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Could not load cluster contexts</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  KubeDeck could not read your kubeconfig, so no cluster could be selected.
                </p>
              </div>
            </div>

            <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words text-destructive/90 bg-background/60 border border-border/50 rounded-lg p-3 max-h-48 overflow-y-auto">
              {detail}
            </pre>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => refetchContexts()} data-testid="button-retry-contexts">
                <RefreshCw size={14} className="mr-1.5" />
                Retry
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/settings")}>
                Open Settings
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const tileState = (loading: boolean, isErr: boolean, err: unknown): TileState =>
    loading ? "loading" : isErr ? (err instanceof K8sError && err.isForbidden ? "forbidden" : err instanceof K8sError && err.isUnreachable ? "offline" : "error") : "ok";
  const notRunning = health.pods.pending + health.pods.failed;
  const degradedDeploys = health.deployments.total - health.deployments.ready;
  const tiles: Tile[] = [
    {
      key: "pods", label: "Pods", icon: Box, state: tileState(podsLoading, podsError, podsErrorObj),
      value: `${health.pods.running + health.pods.done}/${health.pods.total}`,
      sub: notRunning > 0 ? `${notRunning} not running` : "all running", tone: health.pods.failed > 0 ? "bad" : notRunning > 0 ? "warn" : "good",
      onClick: () => openList("pods", notRunning > 0 ? "bad" : null), hint: "Open the pod list",
    },
    {
      key: "deploy", label: "Deployments", icon: Layers, state: tileState(deployLoading, deployError, deployErrorObj),
      value: `${health.deployments.ready}/${health.deployments.total}`,
      sub: degradedDeploys > 0 ? `${degradedDeploys} not ready` : "all ready", tone: degradedDeploys > 0 ? "bad" : "good",
      onClick: () => openList("deployments", degradedDeploys > 0 ? "bad" : null), hint: "Open the deployment list",
    },
    {
      key: "svc", label: "Services", icon: Network, state: tileState(servicesLoading, servicesError, servicesErrorObj),
      value: String(services?.length ?? 0), sub: ingresses && ingresses.length > 0 ? `${ingresses.length} ingress${ingresses.length === 1 ? "" : "es"}` : undefined, tone: "neutral",
      onClick: () => openList("services", null), hint: "Open the service list",
    },
    {
      key: "nodes", label: "Nodes", icon: Server, state: tileState(nodesLoading, nodesError, nodesErrorObj),
      value: `${health.nodes.ready}/${health.nodes.total}`,
      sub: health.nodes.ready < health.nodes.total ? `${health.nodes.total - health.nodes.ready} not ready` : nodeMetrics.data?.available && nodeMetrics.data.items?.length ? `CPU ${Math.round(nodeMetrics.data.items.reduce((t, n) => t + n.cpuPct, 0) / nodeMetrics.data.items.length)}% avg` : "all ready",
      tone: health.nodes.ready < health.nodes.total ? "bad" : "good", onClick: () => openList("nodes", null), hint: "Open the node list",
    },
    {
      key: "restarts", label: "Restarts", icon: RotateCw, state: tileState(podsLoading, podsError, podsErrorObj),
      value: String(health.restarts),
      sub: health.flakyTotal > 0 ? `${health.flakyTotal} flaky pod${health.flakyTotal === 1 ? "" : "s"}` : "none flaky", tone: health.flakyTotal > 0 ? "warn" : "good",
      onClick: () => openList("pods", health.flakyTotal > 0 ? "restarts" : null), hint: "Pods with 5 or more restarts",
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground selection:bg-primary/20">
      <AppHeader breadcrumbs={[{ label: "Overview" }]} rightSlot={<><OverviewViews /><LiveRefresh /></>} />
      <main className="relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-7 p-5 sm:p-7">

          {switchedNote && (
            <div role="status" className="flex items-center gap-3 rounded-lg border border-primary/25 bg-primary/[0.06] px-4 py-2.5 text-xs">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <p className="flex-1 text-foreground">
                Showing <span className="font-mono font-semibold">{switchedNote.to}</span> — your user can't list pods {switchedNote.from === "all" ? "across all namespaces" : `in ${switchedNote.from}`} on this cluster.
                Change it any time from the scope menu.
              </p>
              <button type="button" onClick={() => setSwitchedNote(null)} aria-label="Dismiss" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          {podsLoading && !pods ? (
            <div className="flex h-40 items-center justify-center rounded-xl border border-border/60 bg-card/40 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />Reading {currentContext}…
            </div>
          ) : podsUnreachable ? (
            <ConnectionGate
              context={currentContext}
              retrying={podsFetching}
              onRetry={() => void refetchPods()}
              otherContexts={(contexts ?? []).map((c) => c.name).filter((n) => n !== currentContext)}
              onSwitch={(name) => handleSetContext(name)}
              detail={podsErrorObj instanceof Error ? podsErrorObj.message : undefined}
            />
          ) : podsForbidden ? (
            <AccessGate context={currentContext} namespace={currentNamespace} access={access.data} onPick={setNamespace} />
          ) : pods ? (
            <HomeOverview
              context={currentContext}
              namespace={currentNamespace}
              health={health}
              changes={changes}
              usage={usageTotals}
              requests={requests}
              metricsReason={podMetrics.data && !podMetrics.data.available ? podMetrics.data.reason : undefined}
              nodeUsage={nodeMetrics.data?.available ? nodeMetrics.data.items : undefined}
              onAsk={serverMode.aiEnabled ? askAi : undefined}
              onOpen={openDetail}
              onLogs={openLogs}
              tiles={tiles}
              shortcuts={<PinnedRecent context={currentContext} onOpen={(r) => openDetail(r.type, r.name, r.namespace)} />}
            />
          ) : null}

          {/* without a readable pod list there is no hero: the tiles still show what can be read */}
          {!pods && !podsLoading && <StatTiles tiles={tiles} />}
        </div>
      </main>
    </div>
  );
}
