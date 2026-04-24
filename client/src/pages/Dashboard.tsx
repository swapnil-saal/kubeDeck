import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useHashParams } from "@/hooks/use-hash-params";
import {
  useK8sContexts, useK8sPods, useK8sDeployments, useK8sServices,
  useK8sConfigMaps, useK8sSecrets, useK8sIngresses, useK8sStatefulSets, useK8sDaemonSets,
  useK8sJobs, useK8sCronJobs, useK8sNodes, useK8sHpa, useK8sPvcs,
  useDeletePod, usePodLogs, usePodEnv, usePortForward, usePortForwards, useStopPortForward,
  useScaleDeployment, useRestartDeployment,
  K8sError,
} from "@/hooks/use-k8s";
import { ResourceTable } from "@/components/ResourceTable";
import { AppHeader } from "@/components/AppHeader";
import { CommandBar, buildListCommands } from "@/components/CommandBar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Box, Layers, Network, RefreshCw, Terminal, List, Share2, Trash2, Activity,
  Zap, Square, FileText, Lock, Globe, Database, Clock, Server,
  Gauge, HardDrive, RotateCw, Scaling, HeartPulse, AlertTriangle, ChevronDown, ChevronUp, Sparkles, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useAiConfig, fetchAiSuggestion } from "@/hooks/use-ai-config";

export default function Dashboard() {
  const { context: currentContext, namespace: currentNamespace, setContext: handleSetContext } = useTerminalStore();
  const [selectedPod, setSelectedPod] = useState<{ name: string; type: 'logs' | 'env' | 'forward' | null }>({ name: '', type: null });
  const [forwardPort, setForwardPort] = useState<string>("8080");
  const [remotePort, setRemotePort] = useState<string>("80");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { get: getParam, set: setParam } = useHashParams();

  const activeTab = getParam("tab") || "pods";
  const setActiveTab = useCallback((tab: string) => setParam("tab", tab === "pods" ? null : tab), [setParam]);
  const searchFilter = getParam("q") || "";
  const setSearchFilter = useCallback((q: string) => setParam("q", q || null), [setParam]);

  const goToDetail = (type: string, name: string, ns?: string) => {
    const namespace = ns || currentNamespace;
    navigate(`/resource/${type}/${encodeURIComponent(name)}?context=${encodeURIComponent(currentContext)}&namespace=${encodeURIComponent(namespace)}`);
  };

  const { data: contexts } = useK8sContexts();
  
  useEffect(() => {
    if (contexts && contexts.length > 0 && !currentContext) {
      const active = contexts.find(c => c.isCurrent);
      const chosen = active || contexts[0];
      handleSetContext(chosen.name);
    }
  }, [contexts, currentContext, handleSetContext]);

  const { data: pods, isLoading: podsLoading, isError: podsError, error: podsErrorObj, refetch: refetchPods } = useK8sPods(currentContext, currentNamespace);
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
  const [logAiSummary, setLogAiSummary] = useState<string | null>(null);
  const [logAiSummaryLoading, setLogAiSummaryLoading] = useState(false);

  const { data: logsData, isLoading: logsLoading } = usePodLogs(
    selectedPod.name, currentContext, currentNamespace, selectedPod.type === 'logs'
  );
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

  const getStatValue = (data: any[] | undefined, isLoading: boolean, isError: boolean, error: Error | null) => {
    if (isLoading) return "···";
    if (isError) {
      if (error instanceof K8sError && error.isForbidden) return "🔒";
      return "ERR";
    }
    return data?.length ?? 0;
  };

  // ── Health Summary (hook must be before any early return) ──
  const healthIssues = useMemo(() => {
    const issues: { severity: "critical" | "warning" | "info"; message: string; tab: string }[] = [];

    if (pods) {
      const crashing = pods.filter(p => ["CrashLoopBackOff", "Error", "ImagePullBackOff", "ErrImagePull", "OOMKilled"].includes(p.status));
      if (crashing.length > 0) issues.push({ severity: "critical", message: `${crashing.length} pod${crashing.length > 1 ? "s" : ""} in error state (${crashing.slice(0, 3).map(p => p.name.slice(0, 25)).join(", ")}${crashing.length > 3 ? "…" : ""})`, tab: "pods" });

      const pending = pods.filter(p => ["Pending", "ContainerCreating"].includes(p.status));
      if (pending.length > 0) issues.push({ severity: "warning", message: `${pending.length} pod${pending.length > 1 ? "s" : ""} pending`, tab: "pods" });

      const highRestarts = pods.filter(p => p.restarts > 5);
      if (highRestarts.length > 0) issues.push({ severity: "warning", message: `${highRestarts.length} pod${highRestarts.length > 1 ? "s" : ""} with >5 restarts (${highRestarts.slice(0, 2).map(p => `${p.name.slice(0, 20)}:${p.restarts}`).join(", ")})`, tab: "pods" });
    }

    if (deployments) {
      const unhealthy = deployments.filter(d => {
        const [cur, tot] = d.ready.split("/");
        return Number(cur) < Number(tot) || Number(tot) === 0;
      });
      if (unhealthy.length > 0) issues.push({ severity: "critical", message: `${unhealthy.length} deployment${unhealthy.length > 1 ? "s" : ""} not fully ready (${unhealthy.slice(0, 3).map(d => `${d.name.slice(0, 20)} ${d.ready}`).join(", ")})`, tab: "deployments" });
    }

    if (nodes) {
      const notReady = nodes.filter(n => n.status !== "Ready");
      if (notReady.length > 0) issues.push({ severity: "critical", message: `${notReady.length} node${notReady.length > 1 ? "s" : ""} not ready (${notReady.map(n => n.name.slice(0, 20)).join(", ")})`, tab: "nodes" });
    }

    if (jobs) {
      const failed = jobs.filter(j => j.status === "Failed");
      if (failed.length > 0) issues.push({ severity: "warning", message: `${failed.length} failed job${failed.length > 1 ? "s" : ""}`, tab: "jobs" });
    }

    if (pvcs) {
      const pending = pvcs.filter(p => p.status !== "Bound");
      if (pending.length > 0) issues.push({ severity: "warning", message: `${pending.length} PVC${pending.length > 1 ? "s" : ""} not bound`, tab: "pvcs" });
    }

    return issues;
  }, [pods, deployments, nodes, jobs, pvcs]);

  const [healthExpanded, setHealthExpanded] = useState(true);

  const { isFastModel } = useAiConfig();
  const aiSuggestionsCache = useRef<Map<string, string>>(new Map());
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isFastModel || healthIssues.length === 0) return;
    const controller = new AbortController();
    const fetchSuggestions = async () => {
      for (const issue of healthIssues) {
        const key = issue.message;
        if (aiSuggestionsCache.current.has(key)) {
          setAiSuggestions(prev => ({ ...prev, [key]: aiSuggestionsCache.current.get(key)! }));
          continue;
        }
        try {
          const suggestion = await fetchAiSuggestion(
            `In one sentence, explain the likely cause and fix for this Kubernetes issue: ${key}`,
            200,
            controller.signal,
          );
          aiSuggestionsCache.current.set(key, suggestion);
          setAiSuggestions(prev => ({ ...prev, [key]: suggestion }));
        } catch {
          // ignore abort / failure
        }
      }
    };
    fetchSuggestions();
    return () => controller.abort();
  }, [isFastModel, healthIssues]);

  if (!currentContext && !contexts) {
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

  const stats = [
    { label: "PODS", value: getStatValue(pods, podsLoading, podsError, podsErrorObj), icon: Box, isError: podsError, isForbidden: podsErrorObj instanceof K8sError && podsErrorObj.isForbidden },
    { label: "DEPLOY", value: getStatValue(deployments, deployLoading, deployError, deployErrorObj), icon: Layers, isError: deployError, isForbidden: deployErrorObj instanceof K8sError && deployErrorObj.isForbidden },
    { label: "SVC", value: getStatValue(services, servicesLoading, servicesError, servicesErrorObj), icon: Network, isError: servicesError, isForbidden: servicesErrorObj instanceof K8sError && servicesErrorObj.isForbidden },
    { label: "NODES", value: getStatValue(nodes, nodesLoading, nodesError, nodesErrorObj), icon: Server, isError: nodesError, isForbidden: nodesErrorObj instanceof K8sError && nodesErrorObj.isForbidden },
    { label: "ING", value: getStatValue(ingresses, ingLoading, ingError, ingErrorObj), icon: Globe, isError: ingError, isForbidden: ingErrorObj instanceof K8sError && ingErrorObj.isForbidden },
  ];

  const headerRight = (
    <div className="flex items-center gap-2">
      <motion.button
        onClick={handleRefresh}
        whileTap={{ rotate: 180 }}
        transition={{ duration: 0.3 }}
        className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary transition-all"
        title="Refresh"
      >
        <RefreshCw className="w-4 h-4" />
      </motion.button>

      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg" title="Auto-refreshing every 10s">
        <div className="relative">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping opacity-40" />
        </div>
        <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">Live</span>
        <span className="text-[9px] tabular-nums text-emerald-600/50 dark:text-emerald-400/50">10s</span>
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
    <div className="flex flex-col h-full bg-background overflow-hidden text-foreground selection:bg-primary/20">
      <AppHeader breadcrumbs={[{ label: "Dashboard" }]} rightSlot={headerRight} />

      {/* ══════ MAIN CONTENT ══════ */}
      <main className="flex-1 overflow-auto relative">
        <div className="p-6 max-w-[1600px] mx-auto space-y-6">
          {/* ── STAT CARDS ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`group relative overflow-hidden rounded-xl shadow-sm transition-all duration-200 cursor-default hover:shadow-md
                  ${stat.isForbidden
                    ? 'border border-muted bg-muted/30'
                    : stat.isError 
                      ? 'border border-red-500/20 bg-red-500/5' 
                      : 'border border-border bg-card hover:border-primary/20'
                  }`}
              >
                <div className="px-5 py-4 flex items-center gap-4">
                  <div className={`p-2.5 rounded-xl ${stat.isError ? 'bg-red-500/10 text-red-500' : 'bg-primary/10 text-primary'}`}>
                    <stat.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground font-medium">{stat.label}</p>
                    <p className={`text-3xl font-bold tabular-nums leading-tight ${stat.isError ? 'text-red-500 text-xl' : 'text-foreground'}`}>
                      {stat.value}
                    </p>
                  </div>
                </div>
              </motion.div>
              ))}
            </div>

          {/* ── HEALTH SUMMARY ── */}
          {!podsLoading && !deployLoading && !nodesLoading && (
            <div className={`rounded-xl shadow-sm border overflow-hidden transition-all ${
              healthIssues.length === 0
                ? "border-emerald-500/20 bg-card"
                : healthIssues.some(i => i.severity === "critical")
                  ? "border-red-500/20 bg-card"
                  : "border-amber-500/20 bg-card"
            }`}>
              <button
                onClick={() => setHealthExpanded(!healthExpanded)}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-left"
              >
                <HeartPulse className={`w-4 h-4 shrink-0 ${
                  healthIssues.length === 0 ? "text-emerald-500" : healthIssues.some(i => i.severity === "critical") ? "text-red-500" : "text-amber-500"
                }`} />
                <span className="text-sm font-semibold text-foreground">
                  Cluster Health
                </span>
                {healthIssues.length === 0 ? (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium ml-1">All systems healthy</span>
                ) : (
                  <span className="text-xs text-muted-foreground ml-1 flex gap-2">
                    {healthIssues.filter(i => i.severity === "critical").length > 0 && (
                      <span className="text-red-600 dark:text-red-400 font-semibold">{healthIssues.filter(i => i.severity === "critical").length} critical</span>
                    )}
                    {healthIssues.filter(i => i.severity === "warning").length > 0 && (
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">{healthIssues.filter(i => i.severity === "warning").length} warning{healthIssues.filter(i => i.severity === "warning").length > 1 ? "s" : ""}</span>
                    )}
                  </span>
                )}
                <div className="ml-auto">
                  {healthExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>

              {healthExpanded && healthIssues.length > 0 && (
                <div className="px-5 pb-4 space-y-1.5 border-t border-border pt-3">
                  {healthIssues.map((issue, i) => (
                    <div key={i} className={`flex flex-col gap-1 px-3 py-2 rounded-lg border-l-2 ${
                      issue.severity === "critical" ? "border-l-red-500 bg-red-500/5" : "border-l-amber-500 bg-amber-500/5"
                    }`}>
                      <div className="flex items-start gap-3">
                        <AlertTriangle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${issue.severity === "critical" ? "text-red-500" : "text-amber-500"}`} />
                        <button
                          onClick={() => setActiveTab(issue.tab)}
                          className="text-[12px] text-foreground/80 hover:text-foreground text-left transition-colors flex-1"
                        >
                          {issue.message}
                        </button>
                        {isFastModel && (
                          <button
                            onClick={() => navigate(`/ai?q=${encodeURIComponent(`Fix this Kubernetes issue: ${issue.message}`)}`)}
                            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md transition-colors shrink-0"
                          >
                            <Sparkles className="w-3 h-3" />
                            AI Fix
                          </button>
                        )}
                      </div>
                      {isFastModel && aiSuggestions[issue.message] && (
                        <p className="text-[11px] text-muted-foreground ml-6 pl-0.5 italic">
                          {aiSuggestions[issue.message]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── RESOURCE TABS ── */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex items-center gap-4 mb-5">
              <TabsList className="bg-muted/50 border border-border p-1 h-auto rounded-xl gap-1 flex-wrap">
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
                    className="text-[11px] font-medium rounded-lg px-3 py-1.5 transition-all gap-1.5 data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:bg-background/60
                      data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
                  >
                    <tab.icon className="w-3.5 h-3.5" />
                    {tab.label}
                </TabsTrigger>
                ))}
              </TabsList>
              
              <div className="ml-auto text-xs text-muted-foreground flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                <span>{currentContext}</span>
                <span className="text-muted-foreground/30">/</span>
                <span>{currentNamespace === 'all' ? '*' : currentNamespace}</span>
              </div>
            </div>

              <AnimatePresence mode="wait">
              {/* ── PODS ── */}
                <TabsContent value="pods" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                    <ResourceTable
                      search={searchFilter}
                      onSearchChange={setSearchFilter}
                      data={pods}
                      isLoading={podsLoading}
                    isError={podsError}
                    error={podsErrorObj}
                    accentColor="cyan"
                      columns={[
                      { header: "Pod", accessorKey: "name", cell: (item) => (
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
                        { header: "Status", accessorKey: "status" },
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
                      { header: "IP", accessorKey: "ip" as any, cell: (item: any) => (
                        <span className="text-muted-foreground tabular-nums text-[10px]">{item.ip || "-"}</span>
                      )},
                      { header: "Restarts", accessorKey: "restarts", cell: (item) => (
                        <span className={item.restarts > 0 ? 'text-foreground font-bold' : 'text-muted-foreground'}>{item.restarts}</span>
                      )},
                      { header: "Node", accessorKey: "node", cell: (item) => (
                        <span className="text-muted-foreground text-[10px]">{item.node}</span>
                      )},
                        { header: "Age", accessorKey: "age" },
                      { header: "", cell: (item) => (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="p-1 rounded hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-colors" onClick={() => setSelectedPod({ name: item.name, type: 'logs' })} title="Logs">
                            <Terminal className="h-3 w-3" />
                          </button>
                          <button className="p-1 rounded hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-colors" onClick={() => setSelectedPod({ name: item.name, type: 'env' })} title="Env">
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
                          <button className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" onClick={() => handleDeletePod(item.name)} title="Delete">
                            <Trash2 className="h-3 w-3" />
                          </button>
                            </div>
                      )},
                      ]}
                    />
                  </motion.div>
                </TabsContent>

              {/* ── DEPLOYMENTS ── */}
                <TabsContent value="deployments" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={deployments}
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

              {/* ── SERVICES ── */}
                <TabsContent value="services" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={services}
                    isLoading={servicesLoading}
                    isError={servicesError}
                    error={servicesErrorObj}
                    accentColor="emerald"
                    columns={[
                      { header: "Service", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("service", item.name, item.namespace)} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Type", accessorKey: "type", cell: (item) => <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground bg-foreground/[0.04] px-1.5 py-0.5 rounded-sm border border-border">{item.type}</span> },
                      { header: "Cluster IP", accessorKey: "clusterIP", cell: (item) => <span className="text-muted-foreground tabular-nums text-[10px]">{item.clusterIP}</span> },
                      { header: "Ports", accessorKey: "ports", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.ports}</span> },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── STATEFULSETS ── */}
              <TabsContent value="statefulsets" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={statefulsets}
                    isLoading={stsLoading}
                    isError={stsError}
                    error={stsErrorObj}
                    accentColor="cyan"
                    columns={[
                      { header: "StatefulSet", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("statefulset", item.name, item.namespace)} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Ready", accessorKey: "ready", cell: (item) => {
                        const [c, t] = item.ready.split("/");
                        const ok = c === t && Number(c) > 0;
                        return <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold border ${ok ? 'bg-foreground/5 text-foreground/70 border-foreground/10' : 'bg-foreground/[0.03] text-muted-foreground border-border'}`}>{item.ready}</span>;
                      }},
                      { header: "Replicas", accessorKey: "replicas" },
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
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── DAEMONSETS ── */}
              <TabsContent value="daemonsets" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={daemonsets}
                    isLoading={dsLoading}
                    isError={dsError}
                    error={dsErrorObj}
                    accentColor="violet"
                    columns={[
                      { header: "DaemonSet", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("daemonset", item.name, item.namespace)} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Desired", accessorKey: "desired" },
                      { header: "Current", accessorKey: "current" },
                      { header: "Ready", accessorKey: "ready" },
                      { header: "Available", accessorKey: "available" },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── JOBS ── */}
              <TabsContent value="jobs" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={jobs}
                    isLoading={jobsLoading}
                    isError={jobsError}
                    error={jobsErrorObj}
                    accentColor="amber"
                    columns={[
                      { header: "Job", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("job", item.name, item.namespace)} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Completions", accessorKey: "completions" },
                      { header: "Duration", accessorKey: "duration" },
                      { header: "Status", accessorKey: "status" },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── CRONJOBS ── */}
              <TabsContent value="cronjobs" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={cronjobs}
                    isLoading={cjLoading}
                    isError={cjError}
                    error={cjErrorObj}
                    accentColor="violet"
                    columns={[
                      { header: "CronJob", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("cronjob", item.name, item.namespace)} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Schedule", accessorKey: "schedule", cell: (item) => <span className="text-foreground/60 font-mono text-[10px]">{item.schedule}</span> },
                      { header: "Suspend", accessorKey: "suspend" as any, cell: (item: any) => (
                        <span className={`text-[10px] font-bold ${item.suspend ? 'text-foreground/70' : 'text-muted-foreground'}`}>{item.suspend ? "Yes" : "No"}</span>
                      )},
                      { header: "Active", accessorKey: "active" },
                      { header: "Last Run", accessorKey: "lastSchedule" as any, cell: (item: any) => <span className="text-muted-foreground text-[10px]">{item.lastSchedule || "-"}</span> },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── CONFIGMAPS ── */}
              <TabsContent value="configmaps" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={configmaps}
                    isLoading={cmLoading}
                    isError={cmError}
                    error={cmErrorObj}
                    accentColor="cyan"
                    columns={[
                      { header: "ConfigMap", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("configmap", item.name, item.namespace)} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Data Keys", accessorKey: "dataKeys", cell: (item) => <span className="text-muted-foreground tabular-nums">{item.dataKeys}</span> },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── SECRETS ── */}
              <TabsContent value="secrets" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={secrets}
                    isLoading={secLoading}
                    isError={secError}
                    error={secErrorObj}
                    accentColor="violet"
                    columns={[
                      { header: "Secret", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("secret", item.name, item.namespace)} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Type", accessorKey: "type", cell: (item) => <span className="text-[10px] text-muted-foreground bg-foreground/[0.04] px-1.5 py-0.5 rounded-sm border border-border">{item.type}</span> },
                      { header: "Data", accessorKey: "dataKeys", cell: (item) => <span className="text-muted-foreground tabular-nums">{item.dataKeys}</span> },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── INGRESSES ── */}
              <TabsContent value="ingresses" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={ingresses}
                    isLoading={ingLoading}
                    isError={ingError}
                    error={ingErrorObj}
                    accentColor="pink"
                    columns={[
                      { header: "Ingress", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("ingress", item.name, item.namespace)} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Hosts", accessorKey: "hosts", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.hosts}</span> },
                      { header: "Class", accessorKey: "className" as any, cell: (item: any) => <span className="text-muted-foreground text-[10px]">{item.className || "-"}</span> },
                      { header: "Ports", accessorKey: "ports" },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── NODES ── */}
              <TabsContent value="nodes" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={nodes}
                    isLoading={nodesLoading}
                    isError={nodesError}
                    error={nodesErrorObj}
                    accentColor="amber"
                    columns={[
                      { header: "Node", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("node", item.name, "")} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "Status", accessorKey: "status" },
                      { header: "Roles", accessorKey: "roles", cell: (item) => <span className="text-[10px] text-muted-foreground">{item.roles}</span> },
                      { header: "Version", accessorKey: "version", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.version}</span> },
                      { header: "CPU", accessorKey: "cpu", cell: (item) => <span className="text-muted-foreground tabular-nums text-[10px]">{item.cpu}</span> },
                      { header: "Memory", accessorKey: "memory", cell: (item) => <span className="text-muted-foreground tabular-nums text-[10px]">{item.memory}</span> },
                      { header: "OS", accessorKey: "os", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.os}</span> },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── HPA ── */}
              <TabsContent value="hpa" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={hpa}
                    isLoading={hpaLoading}
                    isError={hpaError}
                    error={hpaErrorObj}
                    accentColor="emerald"
                    columns={[
                      { header: "HPA", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("hpa", item.name, item.namespace)} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Reference", accessorKey: "reference", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.reference}</span> },
                      { header: "Min", accessorKey: "minReplicas" },
                      { header: "Max", accessorKey: "maxReplicas" },
                      { header: "Current", accessorKey: "currentReplicas", cell: (item) => <span className="text-foreground/70 font-bold tabular-nums">{item.currentReplicas}</span> },
                      { header: "Metrics", accessorKey: "metrics", cell: (item) => <span className="text-[10px] text-muted-foreground">{item.metrics}</span> },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── PVCs ── */}
              <TabsContent value="pvcs" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    search={searchFilter}
                    onSearchChange={setSearchFilter}
                    data={pvcs}
                    isLoading={pvcLoading}
                    isError={pvcError}
                    error={pvcErrorObj}
                    accentColor="violet"
                    columns={[
                      { header: "PVC", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("pvc", item.name, item.namespace)} className="text-foreground/80 font-medium hover:text-foreground hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Status", accessorKey: "status" },
                      { header: "Volume", accessorKey: "volume", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.volume}</span> },
                      { header: "Capacity", accessorKey: "capacity", cell: (item) => <span className="text-muted-foreground tabular-nums">{item.capacity}</span> },
                      { header: "Access", accessorKey: "accessModes", cell: (item) => <span className="text-[10px] text-muted-foreground">{item.accessModes}</span> },
                      { header: "Class", accessorKey: "storageClass", cell: (item) => <span className="text-[10px] text-muted-foreground">{item.storageClass}</span> },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
                </TabsContent>
              </AnimatePresence>
            </Tabs>
        </div>
      </main>

      {/* ══════ LOGS / ENV DIALOG ══════ */}
      <Dialog open={selectedPod.type === 'logs' || selectedPod.type === 'env'} onOpenChange={() => { setSelectedPod({ name: '', type: null }); setLogAiSummary(null); }}>
        <DialogContent className="max-w-5xl bg-card border-border p-0 overflow-hidden rounded-xl shadow-lg">
          <DialogHeader className="px-5 py-3 border-b border-border flex flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Terminal className="w-3.5 h-3.5 text-primary" />
              </div>
              <span>{selectedPod.type === 'logs' ? 'Logs' : 'Environment'}</span>
              <span className="text-muted-foreground font-normal text-xs">— {selectedPod.name}</span>
            </DialogTitle>
            {selectedPod.type === 'logs' && isFastModel && logsData?.logs && (
              <button
                onClick={async () => {
                  if (logAiSummaryLoading) return;
                  setLogAiSummaryLoading(true);
                  try {
                    const logLines = logsData.logs.split("\n").slice(-100).join("\n");
                    const result = await fetchAiSuggestion(
                      `Summarize these Kubernetes pod logs in 2-3 sentences, highlighting errors:\n${logLines}`,
                      300,
                    );
                    setLogAiSummary(result);
                  } catch { /* ignore */ }
                  setLogAiSummaryLoading(false);
                }}
                disabled={logAiSummaryLoading}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded-md transition-colors"
              >
                {logAiSummaryLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Summarize
              </button>
            )}
          </DialogHeader>
          {logAiSummary && (
            <div className="border-b border-primary/20 bg-primary/5 px-5 py-2.5">
              <div className="flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-[10px] font-semibold text-primary mb-0.5">AI Summary</p>
                  <p className="text-[11px] text-foreground/80 leading-relaxed">{logAiSummary}</p>
                </div>
                <button onClick={() => setLogAiSummary(null)} className="text-muted-foreground hover:text-foreground text-xs p-0.5">×</button>
              </div>
            </div>
          )}
          <div className="p-4 bg-surface-inset h-[500px] overflow-auto font-mono text-[12px] leading-relaxed">
            {(logsLoading || envLoading) ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="inline-block w-2 h-4 bg-primary/30 animate-pulse rounded-sm" />
                <span className="animate-pulse">Loading...</span>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap text-foreground/70">
                {selectedPod.type === 'logs' ? logsData?.logs : envData?.env}
              </pre>
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
