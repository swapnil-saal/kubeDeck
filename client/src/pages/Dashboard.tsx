import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useHashParams } from "@/hooks/use-hash-params";
import {
  useK8sContexts, useK8sPods, useK8sDeployments, useK8sServices,
  useK8sConfigMaps, useK8sSecrets, useK8sIngresses, useK8sStatefulSets, useK8sDaemonSets,
  useK8sJobs, useK8sCronJobs, useK8sNodes, useK8sHpa, useK8sPvcs,
  useDeletePod, usePodEnv, usePortForward, usePortForwards, useStopPortForward,
  useScaleDeployment, useRestartDeployment, useClusterEvents,
  K8sError,
} from "@/hooks/use-k8s";
import { useNamespaceAccess, usePodMetrics, useNodeMetrics } from "@/hooks/use-cluster-extras";
import { usePins } from "@/hooks/use-pins";
import { addRecent, type ResourceRef } from "@/lib/pins";
import {
  analyzeHealth, parseCpuMilli, parseMemMi, recentChanges,
  type DeployLike, type EventLike, type JobLike, type NodeLike, type PodLike, type PvcLike,
} from "@/lib/cluster-health";
import { AccessGate } from "@/pages/dashboard/AccessGate";
import { StatTiles, type Tile, type TileState } from "@/pages/dashboard/StatTiles";
import { PinnedRecent } from "@/pages/dashboard/PinnedRecent";
import { TabStrip } from "@/pages/dashboard/TabStrip";
import { HomeOverview } from "@/pages/dashboard/HomeOverview";
import { ConnectionGate } from "@/pages/dashboard/ConnectionGate";
import { SimpleResourceTabs } from "@/pages/dashboard/SimpleResourceTabs";
import { FleetOverview } from "@/pages/dashboard/FleetOverview";
import { WorkloadView, restartTone, type WorkloadPod } from "@/pages/dashboard/WorkloadView";
import { ResourceTable } from "@/components/ResourceTable";
import { AppHeader } from "@/components/AppHeader";
import { CommandBar, buildListCommands } from "@/components/CommandBar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Box, Layers, Network, RefreshCw, Terminal, List, Share2, Trash2, Activity,
  Zap, Square, FileText, Lock, Globe, Database, Clock, Server, Pin, X, ListTree, Rows3,
  Gauge, HardDrive, RotateCw, Scaling, HeartPulse, AlertTriangle, ChevronDown, ChevronUp, Sparkles, Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTerminalStore } from "@/hooks/use-terminal-store";

/** Failing pods sort first, then pending, then healthy, then finished. */
const STATUS_RANK = (status: string): number =>
  /^(CrashLoopBackOff|Error|ImagePullBackOff|ErrImagePull|OOMKilled|CreateContainerConfigError|InvalidImageName|Failed|Evicted)$/.test(status) ? 0
    : /^(Pending|ContainerCreating|PodInitializing|Terminating|Init:.*)$/.test(status) ? 1
    : status === "Running" ? 2 : 3;

export default function Dashboard() {
  const { context: currentContext, namespace: currentNamespace, setContext: handleSetContext, setNamespace, setScope } = useTerminalStore();
  const [selectedPod, setSelectedPod] = useState<{ name: string; type: 'env' | 'forward' | null }>({ name: '', type: null });
  const [forwardPort, setForwardPort] = useState<string>("8080");
  const [remotePort, setRemotePort] = useState<string>("80");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { get: getParam, set: setParam, setMany } = useHashParams();

  const activeTab = getParam("tab") || "pods";
  const setActiveTab = useCallback((tab: string) => setParam("tab", tab === "pods" ? null : tab), [setParam]);
  const searchFilter = getParam("q") || "";
  const setSearchFilter = useCallback((q: string) => setParam("q", q || null), [setParam]);

  const goToLogs = (type: string, name: string, ns?: string) => {
    const namespace = ns || currentNamespace;
    if (currentContext) addRecent({ context: currentContext, namespace, type, name });
    navigate(`/resource/${type}/${encodeURIComponent(name)}?context=${encodeURIComponent(currentContext)}&namespace=${encodeURIComponent(namespace)}&tab=logs`);
  };

  const goToDetail = (type: string, name: string, ns?: string) => {
    const namespace = ns || currentNamespace;
    if (currentContext) addRecent({ context: currentContext, namespace, type, name });
    navigate(`/resource/${type}/${encodeURIComponent(name)}?context=${encodeURIComponent(currentContext)}&namespace=${encodeURIComponent(namespace)}`);
  };

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
      const active = contexts.find(c => c.isCurrent);
      const chosen = active || contexts[0];
      handleSetContext(chosen.name);
    }
  }, [contexts, currentContext, handleSetContext]);

  const { data: pods, isLoading: podsLoading, isFetching: podsFetching, isError: podsError, error: podsErrorObj, refetch: refetchPods } = useK8sPods(currentContext, currentNamespace);
  const { data: deployments, isLoading: deployLoading, isError: deployError, error: deployErrorObj, refetch: refetchDeploy } = useK8sDeployments(currentContext, currentNamespace);
  const { data: services, isLoading: servicesLoading, isError: servicesError, error: servicesErrorObj, refetch: refetchServices } = useK8sServices(currentContext, currentNamespace);
  const { data: configmaps, isLoading: cmLoading, isError: cmError, error: cmErrorObj, refetch: refetchCM } = useK8sConfigMaps(currentContext, currentNamespace);
  const { data: secrets, isLoading: secLoading, isError: secError, error: secErrorObj, refetch: refetchSec } = useK8sSecrets(currentContext, currentNamespace);
  const { data: ingresses, isLoading: ingLoading, isError: ingError, error: ingErrorObj, refetch: refetchIng } = useK8sIngresses(currentContext, currentNamespace);
  const { data: statefulsets, isLoading: stsLoading, isError: stsError, error: stsErrorObj, refetch: refetchSts } = useK8sStatefulSets(currentContext, currentNamespace);
  const { data: daemonsets, isLoading: dsLoading, isError: dsError, error: dsErrorObj, refetch: refetchDs } = useK8sDaemonSets(currentContext, currentNamespace);
  const { data: jobs, isLoading: jobsLoading, isError: jobsError, error: jobsErrorObj, refetch: refetchJobs } = useK8sJobs(currentContext, currentNamespace);
  const { data: cronjobs, isLoading: cjLoading, isError: cjError, error: cjErrorObj, refetch: refetchCj } = useK8sCronJobs(currentContext, currentNamespace);
  const { data: nodes, isLoading: nodesLoading, isError: nodesError, error: nodesErrorObj, refetch: refetchNodes } = useK8sNodes(currentContext);
  const { data: hpa, isLoading: hpaLoading, isError: hpaError, error: hpaErrorObj, refetch: refetchHpa } = useK8sHpa(currentContext, currentNamespace);
  const { data: pvcs, isLoading: pvcLoading, isError: pvcError, error: pvcErrorObj, refetch: refetchPvc } = useK8sPvcs(currentContext, currentNamespace);

  const deletePodMutation = useDeletePod();
  const portForwardMutation = usePortForward();
  const scaleMutation = useScaleDeployment();
  const restartMutation = useRestartDeployment();
  const { data: portForwards } = usePortForwards();
  const stopPfMutation = useStopPortForward();

  const [scaleDialog, setScaleDialog] = useState<{ name: string; current: number } | null>(null);
  const [scaleReplicas, setScaleReplicas] = useState("1");
  const { data: envData, isLoading: envLoading } = usePodEnv(
    selectedPod.name, currentContext, currentNamespace, selectedPod.type === 'env'
  );

  const handleRefresh = () => {
    refetchPods(); refetchDeploy(); refetchServices();
    refetchCM(); refetchSec(); refetchIng(); refetchSts(); refetchDs();
    refetchJobs(); refetchCj(); refetchNodes(); refetchHpa(); refetchPvc();
  };

  const handleDeletePod = async (name: string) => {
    if (confirm(`Delete pod ${name}?`)) {
      try {
        await deletePodMutation.mutateAsync({ name, context: currentContext, namespace: currentNamespace });
        toast({ title: "Pod Deleted", description: `Pod ${name} terminated.` });
      } catch {
        toast({ title: "Error", description: "Failed to delete pod", variant: "destructive" });
      }
    }
  };

  const handlePortForward = async () => {
    const local = parseInt(forwardPort);
    const remote = parseInt(remotePort) || local;
    if (!local || local < 1 || local > 65535) {
      toast({ title: "Invalid Port", description: "Local port must be between 1 and 65535", variant: "destructive" });
      return;
    }
    if (remote < 1 || remote > 65535) {
      toast({ title: "Invalid Port", description: "Remote port must be between 1 and 65535", variant: "destructive" });
      return;
    }
    try {
      const result = await portForwardMutation.mutateAsync({
        name: selectedPod.name, context: currentContext, namespace: currentNamespace,
        port: local, remotePort: remote,
      });
      toast({ title: "Port Forward Active", description: result.message || `localhost:${local} → ${selectedPod.name}:${remote}` });
      setSelectedPod({ name: '', type: null });
    } catch (err: any) {
      toast({ title: "Port Forward Failed", description: err?.message || "Failed to establish port forward", variant: "destructive" });
    }
  };

  const handleScale = async () => {
    if (!scaleDialog) return;
    try {
      await scaleMutation.mutateAsync({ name: scaleDialog.name, context: currentContext, namespace: currentNamespace, replicas: parseInt(scaleReplicas) });
      toast({ title: "Scaled", description: `${scaleDialog.name} scaled to ${scaleReplicas} replicas` });
      setScaleDialog(null);
    } catch { toast({ title: "Error", description: "Scale failed", variant: "destructive" }); }
  };

  const handleRestart = async (name: string) => {
    if (confirm(`Restart deployment ${name}?`)) {
      try {
        await restartMutation.mutateAsync({ name, context: currentContext, namespace: currentNamespace });
        toast({ title: "Restarted", description: `${name} rolling restart initiated` });
      } catch { toast({ title: "Error", description: "Restart failed", variant: "destructive" }); }
    }
  };

  // ── Scope, access and live data (hooks must stay above the early returns below) ──
  const access = useNamespaceAccess(currentContext);
  const podMetrics = usePodMetrics(currentContext, currentNamespace);
  const nodeMetrics = useNodeMetrics(currentContext);
  const eventsQ = useClusterEvents(currentContext, currentNamespace, { warningsOnly: false, maxAgeMinutes: 60 });
  const pinState = usePins(currentContext);
  const nsScoped = currentNamespace !== "all";
  const podsForbidden = podsError && podsErrorObj instanceof K8sError && podsErrorObj.isForbidden;
  const podsUnreachable = podsError && podsErrorObj instanceof K8sError && podsErrorObj.isUnreachable;

  // A link like `#/?context=e2dev&namespace=e2` sets the scope, then tidies the URL.
  const urlContext = getParam("context");
  const urlNamespace = getParam("namespace");
  useEffect(() => {
    if (!urlContext && !urlNamespace) return;
    setScope(urlContext || currentContext, urlNamespace || currentNamespace);
    setMany({ context: null, namespace: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlContext, urlNamespace]);

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
  const usageByPod = useMemo(() => new Map((usageItems ?? []).map((u) => [u.namespace ? `${u.namespace}/${u.name}` : u.name, u])), [usageItems]);

  // Quick filters set by the status tiles (`?f=bad` / `?f=restarts`) and the pod view (`?view=grouped`).
  const quickFilter = getParam("f");
  const podView = getParam("view") === "grouped" ? "grouped" : "list";
  const podIsOk = (p: { status: string; ready?: string }) => {
    if (p.status === "Completed" || p.status === "Succeeded") return true;
    if (p.status !== "Running") return false;
    const m = p.ready?.match(/^(\d+)\/(\d+)$/);
    return !m || Number(m[1]) >= Number(m[2]);
  };
  const shownPods = useMemo(() => {
    if (!pods) return pods;
    if (quickFilter === "bad") return pods.filter((p) => !podIsOk(p as any));
    if (quickFilter === "restarts") return pods.filter((p) => p.restarts >= 5).sort((a, b) => b.restarts - a.restarts);
    return pods;
  }, [pods, quickFilter]);
  const shownDeployments = useMemo(() => {
    if (!deployments || quickFilter !== "bad") return deployments;
    return deployments.filter((d) => { const [c, t] = d.ready.split("/"); return Number(c) < Number(t); });
  }, [deployments, quickFilter]);

  const askAi = useCallback((prompt: string) => {
    navigate(`/ai?context=${encodeURIComponent(currentContext)}&namespace=${encodeURIComponent(currentNamespace)}&prompt=${encodeURIComponent(prompt)}`);
  }, [navigate, currentContext, currentNamespace]);

  const jumpToList = useCallback((tab: string, filter: "bad" | "restarts" | null) => {
    setMany({ tab: tab === "pods" ? null : tab, f: filter, view: null });
    requestAnimationFrame(() => document.getElementById("resources")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [setMany]);

  const refFor = (type: string, name: string, namespace: string): ResourceRef => ({ context: currentContext, namespace, type, name });

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
        <AppHeader breadcrumbs={[{ label: "Dashboard" }]} />
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
      onClick: () => jumpToList("pods", notRunning > 0 ? "bad" : null), hint: "Open the pod list",
    },
    {
      key: "deploy", label: "Deployments", icon: Layers, state: tileState(deployLoading, deployError, deployErrorObj),
      value: `${health.deployments.ready}/${health.deployments.total}`,
      sub: degradedDeploys > 0 ? `${degradedDeploys} not ready` : "all ready", tone: degradedDeploys > 0 ? "bad" : "good",
      onClick: () => jumpToList("deployments", degradedDeploys > 0 ? "bad" : null), hint: "Open the deployment list",
    },
    {
      key: "svc", label: "Services", icon: Network, state: tileState(servicesLoading, servicesError, servicesErrorObj),
      value: String(services?.length ?? 0), sub: ingresses && ingresses.length > 0 ? `${ingresses.length} ingress${ingresses.length === 1 ? "" : "es"}` : undefined, tone: "neutral",
      onClick: () => jumpToList("services", null), hint: "Open the service list",
    },
    {
      key: "nodes", label: "Nodes", icon: Server, state: tileState(nodesLoading, nodesError, nodesErrorObj),
      value: `${health.nodes.ready}/${health.nodes.total}`,
      sub: health.nodes.ready < health.nodes.total ? `${health.nodes.total - health.nodes.ready} not ready` : nodeMetrics.data?.available && nodeMetrics.data.items?.length ? `CPU ${Math.round(nodeMetrics.data.items.reduce((t, n) => t + n.cpuPct, 0) / nodeMetrics.data.items.length)}% avg` : "all ready",
      tone: health.nodes.ready < health.nodes.total ? "bad" : "good", onClick: () => jumpToList("nodes", null), hint: "Open the node list",
    },
    {
      key: "restarts", label: "Restarts", icon: RotateCw, state: tileState(podsLoading, podsError, podsErrorObj),
      value: String(health.restarts),
      sub: health.flakyTotal > 0 ? `${health.flakyTotal} flaky pod${health.flakyTotal === 1 ? "" : "s"}` : "none flaky", tone: health.flakyTotal > 0 ? "warn" : "good",
      onClick: () => jumpToList("pods", health.flakyTotal > 0 ? "restarts" : null), hint: "Pods with 5 or more restarts",
    },
  ];

  const headerRight = (
    <div className="flex items-center gap-2">
      <motion.button
        onClick={handleRefresh}
        whileTap={{ rotate: 180 }}
        transition={{ duration: 0.3 }}
        className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-primary transition-colors"
        title="Refresh"
      >
        <RefreshCw size={15} />
      </motion.button>

      <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full" title="Auto-refreshing every 10s">
        <div className="relative">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]" />
          <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-green-500 animate-ping opacity-40" />
        </div>
        <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">Live</span>
        <span className="text-[10px] tabular-nums text-emerald-600/50 dark:text-emerald-400/50">10s</span>
      </div>
    </div>
  );

  const tabToResource: Record<string, string> = {
    pods: "pods", deployments: "deployments", services: "services",
    statefulsets: "statefulsets", daemonsets: "daemonsets", jobs: "jobs",
    cronjobs: "cronjobs", configmaps: "configmaps", secrets: "secrets",
    ingresses: "ingresses", nodes: "nodes", hpa: "hpa", pvcs: "pvc",
  };
  const currentCmds = buildListCommands(tabToResource[activeTab] || activeTab, currentContext, currentNamespace);

  return (
    <div className="flex flex-col h-full overflow-hidden text-foreground selection:bg-primary/20">
      <AppHeader breadcrumbs={[{ label: "Dashboard" }]} rightSlot={headerRight} />

      {/* ══════ MAIN CONTENT ══════ */}
      <main className="flex-1 overflow-y-auto relative">
        <div className="p-7 max-w-7xl mx-auto space-y-7">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Overview</h1>
            <p className="text-xs text-muted-foreground mt-1">Cluster resources and health for the selected context.</p>
          </div>

          <PinnedRecent context={currentContext} onOpen={(r) => goToDetail(r.type, r.name, r.namespace)} />

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
              onRetry={handleRefresh}
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
              onAsk={askAi}
            />
          ) : null}

          <StatTiles tiles={tiles} />

          <FleetOverview
            contexts={contexts ?? []}
            currentContext={currentContext}
            onOpen={(name) => { handleSetContext(name); window.scrollTo({ top: 0 }); }}
          />

          {/* ── RESOURCE TABS ── */}
          <div id="resources" className="space-y-3 scroll-mt-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Resources</p>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabStrip activeKey={activeTab}>
              <TabsList className="bg-secondary/50 border border-border/50 p-1 h-auto rounded-xl gap-1 flex-nowrap w-max min-w-full justify-start">
                {[
                  { val: "pods", label: "Pods", icon: Box },
                  { val: "deployments", label: "Deploy", icon: Layers },
                  { val: "services", label: "Services", icon: Network },
                  { val: "statefulsets", label: "StatefulSets", icon: Database },
                  { val: "daemonsets", label: "DaemonSets", icon: Layers },
                  { val: "jobs", label: "Jobs", icon: Clock },
                  { val: "cronjobs", label: "CronJobs", icon: Clock },
                  { val: "configmaps", label: "ConfigMaps", icon: FileText },
                  { val: "secrets", label: "Secrets", icon: Lock },
                  { val: "ingresses", label: "Ingresses", icon: Globe },
                  { val: "nodes", label: "Nodes", icon: Server },
                  { val: "hpa", label: "HPA", icon: Gauge },
                  { val: "pvcs", label: "PVC", icon: HardDrive },
                ].map(tab => (
                  <TabsTrigger
                    key={tab.val}
                    value={tab.val}
                    className="text-[11px] font-semibold rounded-lg px-3 py-1.5 transition-colors gap-1.5 shrink-0 data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:bg-background/60
                      data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
                  >
                    <tab.icon size={13} />
                    {tab.label}
                </TabsTrigger>
                ))}
              </TabsList>
            </TabStrip>

              <>
              {/* ── PODS ── */}
                <TabsContent value="pods" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {quickFilter && (
                        <button type="button" onClick={() => setParam("f", null)} className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15">
                          {quickFilter === "restarts" ? "Pods with 5+ restarts" : "Only unhealthy pods"}{shownPods ? ` · ${shownPods.length}` : ""}
                          <X className="h-3 w-3" aria-label="Clear filter" />
                        </button>
                      )}
                      <div className="ml-auto flex rounded-lg border border-border bg-card/60 p-0.5 text-xs font-medium" role="group" aria-label="Pod view">
                        <button type="button" onClick={() => setParam("view", null)} aria-pressed={podView === "list"} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${podView === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><Rows3 className="h-3.5 w-3.5" />List</button>
                        <button type="button" onClick={() => setParam("view", "grouped")} aria-pressed={podView === "grouped"} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${podView === "grouped" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><ListTree className="h-3.5 w-3.5" />By workload</button>
                      </div>
                    </div>
                    {podView === "grouped" ? (
                      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
                        <WorkloadView
                          pods={(shownPods ?? []) as unknown as WorkloadPod[]}
                          usage={usageItems}
                          showNamespace={!nsScoped}
                          isPinned={(t, n, ns) => pinState.isPinned(refFor(t, n, ns))}
                          onOpen={(t, n, ns) => goToDetail(t, n, ns)}
                          onLogs={(t, n, ns) => goToLogs(t, n, ns)}
                          onPin={(t, n, ns) => pinState.toggle(refFor(t, n, ns))}
                          onAsk={askAi}
                          onScale={(name, current) => { setScaleDialog({ name, current }); setScaleReplicas(String(current)); }}
                          onRestart={handleRestart}
                        />
                      </div>
                    ) : (
                    <ResourceTable
                      tableId="pods"

                      hideNamespace={nsScoped}

                      emptyLabel="pods"
                      search={searchFilter}
                      onSearchChange={setSearchFilter}
                      data={shownPods}
                      isLoading={podsLoading}
                    isError={podsError}
                    error={podsErrorObj}
                    accentColor="cyan"
                      columns={[
                      { header: "Pod", accessorKey: "name", required: true, cell: (item) => (
                        <button onClick={() => goToDetail("pod", item.name, item.namespace)} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">
                          {item.name}
                        </button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => (
                        <span className="text-muted-foreground text-[10px]">{item.namespace}</span>
                      )},
                      { header: "Ready", accessorKey: "ready" as any, cell: (item: any) => {
                        const ready = item.ready || "0/0";
                        const [cur, tot] = ready.split("/");
                        const ok = cur === tot && Number(cur) > 0;
                        return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm border ${ok ? 'bg-foreground/5 text-foreground/70 border-foreground/10' : 'bg-foreground/[0.03] text-muted-foreground border-border'}`}>{ready}</span>;
                      }},
                        { header: "Status", accessorKey: "status", sortValue: (item: any) => `${STATUS_RANK(item.status)}-${item.status}` },
                      { header: "Image", accessorKey: "images" as any, defaultHidden: true, cell: (item: any) => {
                        const imgs: string[] = item.images || [];
                        if (imgs.length === 0) return <span className="text-muted-foreground/60">-</span>;
                        return (
                          <div className="flex flex-col gap-0.5">
                            {imgs.map((img: string, idx: number) => (
                              <span key={idx} className="text-[10px] text-muted-foreground" title={img}>
                                {img.split("/").pop()?.split("@")[0] || img}
                              </span>
                            ))}
                          </div>
                        );
                      }},
                      { header: "IP", accessorKey: "ip" as any, defaultHidden: true, cell: (item: any) => (
                        <span className="text-muted-foreground tabular-nums text-[10px]">{item.ip || "-"}</span>
                      )},
                      { header: "Restarts", accessorKey: "restarts", cell: (item) => (
                        <span className={`tabular-nums ${restartTone(item.restarts)}`} title={item.restarts >= 5 ? "Restarting repeatedly" : undefined}>{item.restarts}</span>
                      )},
                      { header: usageItems ? "CPU" : "CPU req", id: "cpu", sortValue: (item: any) => (usageByPod.get(item.namespace ? `${item.namespace}/${item.name}` : item.name) ?? usageByPod.get(item.name))?.cpuMilli ?? parseCpuMilli(item.cpu), cell: (item: any) => {
                        const u = usageByPod.get(item.namespace ? `${item.namespace}/${item.name}` : item.name) ?? usageByPod.get(item.name);
                        if (u) return <span className="tabular-nums text-xs text-foreground/80" title={`${Math.round(u.memMi)}Mi memory in use`}>{Math.round(u.cpuMilli)}m</span>;
                        const req = parseCpuMilli(item.cpu);
                        return <span className="tabular-nums text-xs text-muted-foreground" title="Requested (live usage unavailable)">{req > 0 ? `${Math.round(req)}m` : "–"}</span>;
                      }},
                      { header: "Node", accessorKey: "node", defaultHidden: true, cell: (item) => (
                        <span className="text-muted-foreground text-[10px]">{item.node}</span>
                      )},
                        { header: "Age", accessorKey: "age" },
                      { header: "", id: "actions", required: true, cell: (item) => (
                        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <button className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors" onClick={() => askAi(`Diagnose pod ${item.name} in namespace ${item.namespace}: it is ${item.status} with ${item.restarts} restarts. Check its describe output, recent logs and events and tell me if anything is wrong.`)} title="Diagnose with AI" aria-label={`Diagnose ${item.name} with AI`}>
                            <Sparkles className="h-3 w-3" />
                          </button>
                          <button className={`p-1.5 rounded hover:bg-foreground/8 transition-colors ${pinState.isPinned(refFor("pod", item.name, item.namespace)) ? "text-primary" : "text-muted-foreground hover:text-foreground"}`} onClick={() => pinState.toggle(refFor("pod", item.name, item.namespace))} title="Pin" aria-label={`Pin ${item.name}`} aria-pressed={pinState.isPinned(refFor("pod", item.name, item.namespace))}>
                            <Pin className="h-3 w-3" />
                          </button>
                          <button className="p-1.5 rounded hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-colors" onClick={() => goToLogs("pod", item.name, item.namespace)} title="Open logs" aria-label={`Logs of ${item.name}`}>
                            <Terminal className="h-3 w-3" />
                          </button>
                          <button className="p-1.5 rounded hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-colors" onClick={() => setSelectedPod({ name: item.name, type: 'env' })} title="Env" aria-label={`Environment of ${item.name}`}>
                            <List className="h-3 w-3" />
                          </button>
                          <button className="p-1 rounded hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-colors" onClick={() => {
                            // Auto-populate remote port from container ports
                            const pod = pods?.find(p => p.name === item.name);
                            const cPorts = pod?.containerPorts;
                            if (cPorts && cPorts.length > 0) {
                              setRemotePort(String(cPorts[0].port));
                              setForwardPort(String(cPorts[0].port));
                            } else {
                              setRemotePort("80");
                              setForwardPort("8080");
                            }
                            setSelectedPod({ name: item.name, type: 'forward' });
                          }} title="Port Forward">
                            <Share2 className="h-3 w-3" />
                          </button>
                          <span className="mx-1 h-3 w-px bg-border" aria-hidden />
                          <button className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" onClick={() => handleDeletePod(item.name)} title="Delete pod" aria-label={`Delete pod ${item.name}`}>
                            <Trash2 className="h-3 w-3" />
                          </button>
                            </div>
                      )},
                      ]}
                    />
                    )}
                  </motion.div>
                </TabsContent>

              {/* ── DEPLOYMENTS ── */}
                <TabsContent value="deployments" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    tableId="deployments"

                    hideNamespace={nsScoped}

                    emptyLabel="deployments"
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={shownDeployments}
                    isLoading={deployLoading}
                    isError={deployError}
                    error={deployErrorObj}
                    accentColor="violet"
                    columns={[
                      { header: "Deployment", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("deployment", item.name, item.namespace)} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">
                          {item.name}
                        </button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => (
                        <span className="text-muted-foreground text-[10px]">{item.namespace}</span>
                      )},
                      { header: "Ready", accessorKey: "ready", cell: (item) => {
                        const [current, total] = item.ready.split('/');
                        const healthy = current === total && Number(current) > 0;
                        return <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold border ${healthy ? 'bg-foreground/5 text-foreground/70 border-foreground/10' : 'bg-foreground/[0.03] text-muted-foreground border-border'}`}>{item.ready}</span>;
                      }},
                      { header: "Image", accessorKey: "images" as any, cell: (item: any) => {
                        const imgs: string[] = item.images || [];
                        if (imgs.length === 0) return <span className="text-muted-foreground/60">-</span>;
                        return (
                          <div className="flex flex-col gap-0.5">
                            {imgs.map((img: string, idx: number) => (
                              <span key={idx} className="text-[10px] text-muted-foreground" title={img}>
                                {img.split("/").pop()?.split("@")[0] || img}
                              </span>
                            ))}
                          </div>
                        );
                      }},
                      { header: "Strategy", accessorKey: "strategy" as any, cell: (item: any) => (
                        <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground bg-foreground/[0.04] px-1.5 py-0.5 rounded-sm border border-border">{item.strategy || "Rolling"}</span>
                      )},
                      { header: "Age", accessorKey: "age" },
                      { header: "", cell: (item) => (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="p-1 rounded hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-colors" onClick={() => { const [,t] = item.ready.split('/'); setScaleDialog({ name: item.name, current: Number(t) }); setScaleReplicas(t); }} title="Scale">
                            <Scaling className="h-3 w-3" />
                          </button>
                          <button className="p-1 rounded hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-colors" onClick={() => handleRestart(item.name)} title="Restart">
                            <RotateCw className="h-3 w-3" />
                          </button>
                        </div>
                      )},
                    ]}
                  />
                </motion.div>
                </TabsContent>

              <SimpleResourceTabs
                q={{
                  services: { data: services, isLoading: servicesLoading, isError: servicesError, error: servicesErrorObj },
                  statefulsets: { data: statefulsets, isLoading: stsLoading, isError: stsError, error: stsErrorObj },
                  daemonsets: { data: daemonsets, isLoading: dsLoading, isError: dsError, error: dsErrorObj },
                  jobs: { data: jobs, isLoading: jobsLoading, isError: jobsError, error: jobsErrorObj },
                  cronjobs: { data: cronjobs, isLoading: cjLoading, isError: cjError, error: cjErrorObj },
                  configmaps: { data: configmaps, isLoading: cmLoading, isError: cmError, error: cmErrorObj },
                  secrets: { data: secrets, isLoading: secLoading, isError: secError, error: secErrorObj },
                  ingresses: { data: ingresses, isLoading: ingLoading, isError: ingError, error: ingErrorObj },
                  nodes: { data: nodes, isLoading: nodesLoading, isError: nodesError, error: nodesErrorObj },
                  hpa: { data: hpa, isLoading: hpaLoading, isError: hpaError, error: hpaErrorObj },
                  pvcs: { data: pvcs, isLoading: pvcLoading, isError: pvcError, error: pvcErrorObj },
                }}
                search={searchFilter}
                onSearchChange={setSearchFilter}
                nsScoped={nsScoped}
                goToDetail={goToDetail}
              />
              </>
            </Tabs>
          </div>
        </div>
      </main>

      {/* ══════ LOGS / ENV DIALOG ══════ */}
      <Dialog open={selectedPod.type === 'env'} onOpenChange={() => setSelectedPod({ name: '', type: null })}>
        <DialogContent className="max-w-5xl bg-card border-border p-0 overflow-hidden rounded-xl shadow-lg">
          <DialogHeader className="px-5 py-3 border-b border-border">
            <DialogTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Terminal className="w-3.5 h-3.5 text-primary" />
              </div>
              <span>Environment</span>
              <span className="text-muted-foreground font-normal text-xs">— {selectedPod.name}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 bg-surface-inset h-[500px] overflow-auto font-mono text-[12px] leading-relaxed">
            {envLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="inline-block w-2 h-4 bg-primary/30 animate-pulse rounded-sm" />
                <span className="animate-pulse">Loading...</span>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap text-foreground/70">{envData?.env}</pre>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════ PORT FORWARD DIALOG ══════ */}
      <Dialog open={selectedPod.type === 'forward'} onOpenChange={() => setSelectedPod({ name: '', type: null })}>
        <DialogContent className="max-w-sm bg-card border-border p-0 overflow-hidden rounded-xl shadow-lg">
          <DialogHeader className="px-5 py-3 border-b border-border">
            <DialogTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Share2 className="w-3.5 h-3.5 text-primary" />
              </div>
              <span>Port Forward</span>
              <span className="text-muted-foreground font-normal text-xs">— {selectedPod.name}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Local Port</label>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={forwardPort}
                  onChange={(e) => setForwardPort(e.target.value)}
                  className="bg-muted/50 border-border font-mono text-foreground text-sm h-9 rounded-lg focus-visible:ring-primary/30"
                  placeholder="8080"
                />
                <p className="text-[10px] text-muted-foreground">Your machine</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Remote Port</label>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={remotePort}
                  onChange={(e) => setRemotePort(e.target.value)}
                  className="bg-muted/50 border-border font-mono text-foreground text-sm h-9 rounded-lg focus-visible:ring-primary/30"
                  placeholder="80"
                />
                {(() => {
                  const pod = pods?.find(p => p.name === selectedPod.name);
                  const cPorts = pod?.containerPorts;
                  if (!cPorts || cPorts.length === 0) return <p className="text-[8px] text-muted-foreground">⚠ No ports declared in pod spec</p>;
                  return (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[8px] text-muted-foreground/60">Ports:</span>
                      {cPorts.map((cp) => (
                        <button
                          key={cp.port}
                          type="button"
                          onClick={() => setRemotePort(String(cp.port))}
                          className={`text-[10px] font-mono px-2 py-1 rounded-lg border transition-colors ${
                            remotePort === String(cp.port)
                              ? 'bg-primary/10 border-primary/30 text-primary'
                              : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground hover:border-primary/20'
                          }`}
                        >
                          {cp.port}{cp.name ? `/${cp.name}` : ''}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="text-xs text-muted-foreground font-mono bg-muted/50 px-3 py-2 rounded-lg border border-border">
              localhost:<span className="text-foreground font-semibold">{forwardPort || '?'}</span>
              <span className="text-muted-foreground/50 mx-1.5">→</span>
              {selectedPod.name}:<span className="text-foreground font-semibold">{remotePort || forwardPort || '?'}</span>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" className="text-xs h-9 px-4 text-muted-foreground hover:text-foreground rounded-lg" onClick={() => setSelectedPod({ name: '', type: null })}>
                Cancel
              </Button>
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium h-9 px-5 rounded-lg shadow-sm"
                onClick={handlePortForward}
                disabled={portForwardMutation.isPending}
              >
                {portForwardMutation.isPending ? "Connecting..." : "Connect"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════ SCALE DIALOG ══════ */}
      <Dialog open={!!scaleDialog} onOpenChange={() => setScaleDialog(null)}>
        <DialogContent className="max-w-sm bg-card border-border p-0 overflow-hidden rounded-xl shadow-lg">
          <DialogHeader className="px-5 py-3 border-b border-border">
            <DialogTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Scaling className="w-3.5 h-3.5 text-primary" />
              </div>
              <span>Scale</span>
              <span className="text-muted-foreground font-normal text-xs">— {scaleDialog?.name}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="p-5 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Replicas</label>
              <Input 
                type="number"
                min={0}
                value={scaleReplicas}
                onChange={(e) => setScaleReplicas(e.target.value)}
                className="bg-muted/50 border-border font-mono text-foreground text-sm h-9 rounded-lg focus-visible:ring-primary/30"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" className="text-xs h-9 px-4 text-muted-foreground hover:text-foreground rounded-lg" onClick={() => setScaleDialog(null)}>Cancel</Button>
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium h-9 px-5 rounded-lg shadow-sm" onClick={handleScale}>Scale</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════ PORT FORWARD STATUS BAR ══════ */}
      {portForwards && portForwards.length > 0 && (
        <div className="border-t border-border bg-card px-5 py-2 flex items-center gap-3 overflow-x-auto shrink-0">
          <Share2 className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-[10px] font-semibold text-muted-foreground shrink-0">Forwards</span>
          <div className="w-px h-4 bg-border" />
          {portForwards.map((fwd) => {
            const isDead = fwd.status === "dead" || fwd.status === "error";
            return (
              <div
                key={fwd.id}
                className={`flex items-center gap-2 px-2.5 py-1 rounded-lg shrink-0 border ${
                  isDead
                    ? 'bg-red-500/5 border-red-500/20'
                    : 'bg-emerald-500/5 border-emerald-500/20'
                }`}
                title={isDead ? `Error: ${fwd.error || "Process died"}` : `Active — ${fwd.connections || 0} connections handled`}
              >
                <div className="relative">
                  {isDead ? (
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  ) : (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping opacity-40" />
                    </>
                  )}
                </div>
                <a
                  href={`http://localhost:${fwd.localPort}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-[11px] font-mono hover:underline ${isDead ? 'text-red-500' : 'text-foreground/80'}`}
                >
                  :{fwd.localPort}
                </a>
                <span className="text-[10px] text-muted-foreground">{"\u2192"}</span>
                <span className="text-[11px] font-mono text-muted-foreground">{fwd.pod}:{fwd.remotePort}</span>
                {isDead && (
                  <span className="text-[9px] text-red-500 font-semibold">DEAD</span>
                )}
                <button
                  onClick={async () => {
                    try {
                      await stopPfMutation.mutateAsync(fwd.id);
                      toast({ title: "Stopped", description: `Port forward to ${fwd.pod} stopped.` });
                    } catch {
                      toast({ title: "Error", description: "Failed to stop", variant: "destructive" });
                    }
                  }}
                  className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  title="Stop"
                >
                  <Square className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <CommandBar commands={currentCmds} />
    </div>
  );
}
