import { useState, useEffect } from "react";
import { useLocation } from "wouter";
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
import { CommandBar, buildKubectlCommand } from "@/components/CommandBar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Box, Layers, Network, RefreshCw, Terminal, List, Share2, Trash2, Activity,
  Zap, Square, FileText, Lock, Globe, Database, Clock, Server,
  Gauge, HardDrive, RotateCw, Scaling,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTerminalStore } from "@/hooks/use-terminal-store";

export default function Dashboard() {
  const { context: currentContext, namespace: currentNamespace, setContext: handleSetContext } = useTerminalStore();
  const [selectedPod, setSelectedPod] = useState<{ name: string; type: 'logs' | 'env' | 'forward' | null }>({ name: '', type: null });
  const [forwardPort, setForwardPort] = useState<string>("8080");
  const [remotePort, setRemotePort] = useState<string>("80");
  const [activeTab, setActiveTab] = useState("pods");
  const [, navigate] = useLocation();
  const { toast } = useToast();

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

  if (!currentContext && !contexts) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
            <div className="absolute inset-0 w-12 h-12 border-2 border-transparent border-b-emerald-400/50 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
          </div>
          <p className="text-primary font-mono text-sm tracking-wider">INITIALIZING CLUSTER CONNECTION...</p>
        </div>
      </div>
    );
  }

  const stats = [
    { label: "PODS", value: getStatValue(pods, podsLoading, podsError, podsErrorObj), icon: Box, color: "cyan", isError: podsError, isForbidden: podsErrorObj instanceof K8sError && podsErrorObj.isForbidden },
    { label: "DEPLOY", value: getStatValue(deployments, deployLoading, deployError, deployErrorObj), icon: Layers, color: "violet", isError: deployError, isForbidden: deployErrorObj instanceof K8sError && deployErrorObj.isForbidden },
    { label: "SVC", value: getStatValue(services, servicesLoading, servicesError, servicesErrorObj), icon: Network, color: "emerald", isError: servicesError, isForbidden: servicesErrorObj instanceof K8sError && servicesErrorObj.isForbidden },
    { label: "NODES", value: getStatValue(nodes, nodesLoading, nodesError, nodesErrorObj), icon: Server, color: "amber", isError: nodesError, isForbidden: nodesErrorObj instanceof K8sError && nodesErrorObj.isForbidden },
    { label: "ING", value: getStatValue(ingresses, ingLoading, ingError, ingErrorObj), icon: Globe, color: "pink", isError: ingError, isForbidden: ingErrorObj instanceof K8sError && ingErrorObj.isForbidden },
  ];

  const headerRight = (
    <div className="flex items-center gap-2">
      <motion.button
        onClick={handleRefresh}
        whileTap={{ rotate: 180 }}
        transition={{ duration: 0.3 }}
        className="p-1.5 hover:bg-foreground/5 rounded text-muted-foreground hover:text-primary transition-all"
        title="Refresh"
      >
        <RefreshCw className="w-3.5 h-3.5" />
      </motion.button>

      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/8 border border-emerald-500/20 rounded-sm" title="Auto-refreshing every 10s">
        <div className="relative">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping opacity-60" />
        </div>
        <span className="text-[9px] uppercase tracking-[0.15em] font-bold text-emerald-700 dark:text-emerald-400">LIVE</span>
        <span className="text-[8px] tabular-nums text-emerald-600/60 dark:text-emerald-400/50">10s</span>
      </div>
    </div>
  );

  const tabToResource: Record<string, string> = {
    pods: "pods", deployments: "deployments", services: "services",
    statefulsets: "statefulsets", daemonsets: "daemonsets", jobs: "jobs",
    cronjobs: "cronjobs", configmaps: "configmaps", secrets: "secrets",
    ingresses: "ingresses", nodes: "nodes", hpa: "hpa", pvcs: "pvc",
  };
  const currentCmd = buildKubectlCommand(tabToResource[activeTab] || activeTab, currentContext, currentNamespace);

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden font-mono text-foreground selection:bg-primary/30">
      <AppHeader breadcrumbs={[{ label: "Dashboard" }]} rightSlot={headerRight} />

      {/* ══════ MAIN CONTENT ══════ */}
      <main className="flex-1 overflow-auto relative">
        <div className="p-5 max-w-[1600px] mx-auto space-y-5">
          {/* ── STAT CARDS ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`group relative overflow-hidden rounded-lg transition-all duration-300 cursor-default
                  ${stat.isForbidden
                    ? 'border border-amber-500/20 bg-amber-500/[0.04] hover:border-amber-500/30'
                    : stat.isError 
                      ? 'border border-red-500/20 bg-red-500/[0.04] hover:border-red-500/30' 
                      : `border border-border/60 bg-card hover:border-${stat.color}-500/30 hover:shadow-lg hover:shadow-${stat.color}-500/5`
                  }`}
              >
                <div className="px-4 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3.5">
                    <div className={`p-2 rounded-lg ${stat.isError ? 'bg-red-500/10 text-red-400' : `bg-${stat.color}-500/10 text-${stat.color}-400`}`}>
                      <stat.icon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">{stat.label}</p>
                      <p className={`text-2xl font-bold tabular-nums leading-tight ${stat.isError ? 'text-red-400 text-lg' : 'text-foreground'}`}>
                        {stat.value}
                      </p>
                    </div>
                  </div>
                  <Zap className={`w-3 h-3 ${stat.isError ? 'text-red-500/20' : 'text-foreground/[0.04] group-hover:text-' + stat.color + '-500/20'} transition-colors`} />
                </div>
              </motion.div>
              ))}
            </div>

          {/* ── RESOURCE TABS ── */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex items-center gap-4 mb-4">
              <TabsList className="bg-card/50 border border-border/60 p-0.5 h-8 rounded-lg gap-0.5 flex-wrap">
                {[
                  { val: "pods", label: "Pods", icon: Box },
                  { val: "deployments", label: "Deploy", icon: Layers },
                  { val: "services", label: "Svc", icon: Network },
                  { val: "statefulsets", label: "STS", icon: Database },
                  { val: "daemonsets", label: "DS", icon: Layers },
                  { val: "jobs", label: "Jobs", icon: Clock },
                  { val: "cronjobs", label: "CronJ", icon: Clock },
                  { val: "configmaps", label: "CM", icon: FileText },
                  { val: "secrets", label: "Sec", icon: Lock },
                  { val: "ingresses", label: "Ing", icon: Globe },
                  { val: "nodes", label: "Nodes", icon: Server },
                  { val: "hpa", label: "HPA", icon: Gauge },
                  { val: "pvcs", label: "PVC", icon: HardDrive },
                ].map(tab => (
                  <TabsTrigger
                    key={tab.val}
                    value={tab.val}
                    className="text-[10px] font-bold uppercase tracking-[0.1em] rounded-md px-3 h-7 transition-all gap-1 data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground
                      data-[state=active]:bg-primary/12 data-[state=active]:text-primary data-[state=active]:shadow-none"
                  >
                    <tab.icon className="w-3 h-3" />
                    {tab.label}
                </TabsTrigger>
                ))}
              </TabsList>
              
              <div className="ml-auto text-[10px] text-muted-foreground font-mono flex items-center gap-1.5">
                <Activity className="w-3 h-3" />
                <span>{currentContext}</span>
                <span className="text-muted-foreground/20">/</span>
                <span className="text-muted-foreground">{currentNamespace === 'all' ? '*' : currentNamespace}</span>
              </div>
            </div>

              <AnimatePresence mode="wait">
              {/* ── PODS ── */}
                <TabsContent value="pods" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                    <ResourceTable
                      data={pods}
                      isLoading={podsLoading}
                    isError={podsError}
                    error={podsErrorObj}
                    accentColor="cyan"
                      columns={[
                      { header: "Pod", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("pod", item.name, item.namespace)} className="text-cyan-700 dark:text-cyan-400 font-medium hover:text-cyan-500 dark:hover:text-cyan-300 hover:underline underline-offset-2 transition-colors text-left">
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
                        return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm border ${ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>{ready}</span>;
                      }},
                        { header: "Status", accessorKey: "status" },
                      { header: "Image", accessorKey: "images" as any, cell: (item: any) => {
                        const imgs: string[] = item.images || [];
                        if (imgs.length === 0) return <span className="text-muted-foreground/60">-</span>;
                        return (
                          <div className="flex flex-col gap-0.5">
                            {imgs.map((img: string, idx: number) => (
                              <span key={idx} className="text-[10px] text-violet-700 dark:text-violet-400" title={img}>
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
                        <span className={item.restarts > 0 ? 'text-amber-400 font-bold' : 'text-muted-foreground'}>{item.restarts}</span>
                      )},
                      { header: "Node", accessorKey: "node", cell: (item) => (
                        <span className="text-muted-foreground text-[10px]">{item.node}</span>
                      )},
                        { header: "Age", accessorKey: "age" },
                      { header: "", cell: (item) => (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="p-1 rounded hover:bg-cyan-500/10 text-muted-foreground hover:text-cyan-400 transition-colors" onClick={() => setSelectedPod({ name: item.name, type: 'logs' })} title="Logs">
                            <Terminal className="h-3 w-3" />
                          </button>
                          <button className="p-1 rounded hover:bg-violet-500/10 text-muted-foreground hover:text-violet-400 transition-colors" onClick={() => setSelectedPod({ name: item.name, type: 'env' })} title="Env">
                            <List className="h-3 w-3" />
                          </button>
                          <button className="p-1 rounded hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-400 transition-colors" onClick={() => {
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
                          <button className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors" onClick={() => handleDeletePod(item.name)} title="Delete">
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
                    data={deployments}
                    isLoading={deployLoading}
                    isError={deployError}
                    error={deployErrorObj}
                    accentColor="violet"
                    columns={[
                      { header: "Deployment", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("deployment", item.name, item.namespace)} className="text-violet-700 dark:text-violet-400 font-medium hover:text-violet-500 dark:hover:text-violet-300 hover:underline underline-offset-2 transition-colors text-left">
                          {item.name}
                        </button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => (
                        <span className="text-muted-foreground text-[10px]">{item.namespace}</span>
                      )},
                      { header: "Ready", accessorKey: "ready", cell: (item) => {
                        const [current, total] = item.ready.split('/');
                        const healthy = current === total && Number(current) > 0;
                        return <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold border ${healthy ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>{item.ready}</span>;
                      }},
                      { header: "Image", accessorKey: "images" as any, cell: (item: any) => {
                        const imgs: string[] = item.images || [];
                        if (imgs.length === 0) return <span className="text-muted-foreground/60">-</span>;
                        return (
                          <div className="flex flex-col gap-0.5">
                            {imgs.map((img: string, idx: number) => (
                              <span key={idx} className="text-[10px] text-violet-700 dark:text-violet-400" title={img}>
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
                          <button className="p-1 rounded hover:bg-cyan-500/10 text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors" onClick={() => { const [,t] = item.ready.split('/'); setScaleDialog({ name: item.name, current: Number(t) }); setScaleReplicas(t); }} title="Scale">
                            <Scaling className="h-3 w-3" />
                          </button>
                          <button className="p-1 rounded hover:bg-amber-500/10 text-muted-foreground hover:text-amber-400 transition-colors" onClick={() => handleRestart(item.name)} title="Restart">
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
                    data={services}
                    isLoading={servicesLoading}
                    isError={servicesError}
                    error={servicesErrorObj}
                    accentColor="emerald"
                    columns={[
                      { header: "Service", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("service", item.name, item.namespace)} className="text-emerald-700 dark:text-emerald-400 font-medium hover:text-emerald-500 dark:hover:text-emerald-300 hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Type", accessorKey: "type", cell: (item) => <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground bg-foreground/[0.04] px-1.5 py-0.5 rounded-sm border border-border">{item.type}</span> },
                      { header: "Cluster IP", accessorKey: "clusterIP", cell: (item) => <span className="text-muted-foreground tabular-nums text-[10px]">{item.clusterIP}</span> },
                      { header: "Ports", accessorKey: "ports", cell: (item) => <span className="text-cyan-600 dark:text-cyan-500 text-[10px]">{item.ports}</span> },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── STATEFULSETS ── */}
              <TabsContent value="statefulsets" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    data={statefulsets}
                    isLoading={stsLoading}
                    isError={stsError}
                    error={stsErrorObj}
                    accentColor="cyan"
                    columns={[
                      { header: "StatefulSet", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("statefulset", item.name, item.namespace)} className="text-cyan-700 dark:text-cyan-400 font-medium hover:text-cyan-500 dark:hover:text-cyan-300 hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Ready", accessorKey: "ready", cell: (item) => {
                        const [c, t] = item.ready.split("/");
                        const ok = c === t && Number(c) > 0;
                        return <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold border ${ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>{item.ready}</span>;
                      }},
                      { header: "Replicas", accessorKey: "replicas" },
                      { header: "Image", accessorKey: "images" as any, cell: (item: any) => {
                        const imgs: string[] = item.images || [];
                        if (imgs.length === 0) return <span className="text-muted-foreground/60">-</span>;
                        return (
                          <div className="flex flex-col gap-0.5">
                            {imgs.map((img: string, idx: number) => (
                              <span key={idx} className="text-[10px] text-violet-700 dark:text-violet-400" title={img}>
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
                    data={daemonsets}
                    isLoading={dsLoading}
                    isError={dsError}
                    error={dsErrorObj}
                    accentColor="violet"
                    columns={[
                      { header: "DaemonSet", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("daemonset", item.name, item.namespace)} className="text-violet-700 dark:text-violet-400 font-medium hover:text-violet-500 dark:hover:text-violet-300 hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
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
                    data={jobs}
                    isLoading={jobsLoading}
                    isError={jobsError}
                    error={jobsErrorObj}
                    accentColor="amber"
                    columns={[
                      { header: "Job", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("job", item.name, item.namespace)} className="text-amber-700 dark:text-amber-400 font-medium hover:text-amber-500 dark:hover:text-amber-300 hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
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
                    data={cronjobs}
                    isLoading={cjLoading}
                    isError={cjError}
                    error={cjErrorObj}
                    accentColor="violet"
                    columns={[
                      { header: "CronJob", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("cronjob", item.name, item.namespace)} className="text-violet-700 dark:text-violet-400 font-medium hover:text-violet-500 dark:hover:text-violet-300 hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Schedule", accessorKey: "schedule", cell: (item) => <span className="text-cyan-500/80 font-mono text-[10px]">{item.schedule}</span> },
                      { header: "Suspend", accessorKey: "suspend" as any, cell: (item: any) => (
                        <span className={`text-[10px] font-bold ${item.suspend ? 'text-amber-400' : 'text-emerald-400'}`}>{item.suspend ? "Yes" : "No"}</span>
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
                    data={configmaps}
                    isLoading={cmLoading}
                    isError={cmError}
                    error={cmErrorObj}
                    accentColor="cyan"
                    columns={[
                      { header: "ConfigMap", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("configmap", item.name, item.namespace)} className="text-cyan-700 dark:text-cyan-400 font-medium hover:text-cyan-500 dark:hover:text-cyan-300 hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Data Keys", accessorKey: "dataKeys", cell: (item) => <span className="text-amber-400/80 tabular-nums">{item.dataKeys}</span> },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── SECRETS ── */}
              <TabsContent value="secrets" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    data={secrets}
                    isLoading={secLoading}
                    isError={secError}
                    error={secErrorObj}
                    accentColor="violet"
                    columns={[
                      { header: "Secret", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("secret", item.name, item.namespace)} className="text-violet-700 dark:text-violet-400 font-medium hover:text-violet-500 dark:hover:text-violet-300 hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Type", accessorKey: "type", cell: (item) => <span className="text-[10px] text-muted-foreground bg-foreground/[0.04] px-1.5 py-0.5 rounded-sm border border-border">{item.type}</span> },
                      { header: "Data", accessorKey: "dataKeys", cell: (item) => <span className="text-amber-400/80 tabular-nums">{item.dataKeys}</span> },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

              {/* ── INGRESSES ── */}
              <TabsContent value="ingresses" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    data={ingresses}
                    isLoading={ingLoading}
                    isError={ingError}
                    error={ingErrorObj}
                    accentColor="pink"
                    columns={[
                      { header: "Ingress", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("ingress", item.name, item.namespace)} className="text-pink-700 dark:text-pink-400 font-medium hover:text-pink-500 dark:hover:text-pink-300 hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Hosts", accessorKey: "hosts", cell: (item) => <span className="text-cyan-400/80 text-[10px]">{item.hosts}</span> },
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
                    data={nodes}
                    isLoading={nodesLoading}
                    isError={nodesError}
                    error={nodesErrorObj}
                    accentColor="amber"
                    columns={[
                      { header: "Node", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("node", item.name, "")} className="text-amber-700 dark:text-amber-400 font-medium hover:text-amber-500 dark:hover:text-amber-300 hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "Status", accessorKey: "status" },
                      { header: "Roles", accessorKey: "roles", cell: (item) => <span className="text-[10px] text-cyan-400/70">{item.roles}</span> },
                      { header: "Version", accessorKey: "version", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.version}</span> },
                      { header: "CPU", accessorKey: "cpu", cell: (item) => <span className="text-emerald-400/80 tabular-nums text-[10px]">{item.cpu}</span> },
                      { header: "Memory", accessorKey: "memory", cell: (item) => <span className="text-violet-400/80 tabular-nums text-[10px]">{item.memory}</span> },
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
                    data={hpa}
                    isLoading={hpaLoading}
                    isError={hpaError}
                    error={hpaErrorObj}
                    accentColor="emerald"
                    columns={[
                      { header: "HPA", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("hpa", item.name, item.namespace)} className="text-emerald-700 dark:text-emerald-400 font-medium hover:text-emerald-500 dark:hover:text-emerald-300 hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Reference", accessorKey: "reference", cell: (item) => <span className="text-cyan-400/70 text-[10px]">{item.reference}</span> },
                      { header: "Min", accessorKey: "minReplicas" },
                      { header: "Max", accessorKey: "maxReplicas" },
                      { header: "Current", accessorKey: "currentReplicas", cell: (item) => <span className="text-amber-400/80 font-bold tabular-nums">{item.currentReplicas}</span> },
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
                    data={pvcs}
                    isLoading={pvcLoading}
                    isError={pvcError}
                    error={pvcErrorObj}
                    accentColor="violet"
                    columns={[
                      { header: "PVC", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("pvc", item.name, item.namespace)} className="text-violet-700 dark:text-violet-400 font-medium hover:text-violet-500 dark:hover:text-violet-300 hover:underline underline-offset-2 transition-colors text-left">{item.name}</button>
                      )},
                      { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.namespace}</span> },
                      { header: "Status", accessorKey: "status" },
                      { header: "Volume", accessorKey: "volume", cell: (item) => <span className="text-muted-foreground text-[10px]">{item.volume}</span> },
                      { header: "Capacity", accessorKey: "capacity", cell: (item) => <span className="text-emerald-400/80 tabular-nums">{item.capacity}</span> },
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
      <Dialog open={selectedPod.type === 'logs' || selectedPod.type === 'env'} onOpenChange={() => setSelectedPod({ name: '', type: null })}>
        <DialogContent className="max-w-5xl bg-background border-border p-0 overflow-hidden rounded-lg shadow-2xl dark:shadow-cyan-500/5">
          <DialogHeader className="px-4 py-2.5 border-b border-border flex flex-row items-center justify-between space-y-0 bg-surface">
            <DialogTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2 font-mono">
              <Terminal className="w-3.5 h-3.5 text-cyan-500" />
              <span className="text-cyan-500">{selectedPod.type === 'logs' ? 'stdout' : 'env'}</span>
              <span className="text-muted-foreground/20">|</span>
              <span className="text-muted-foreground">{selectedPod.name}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 bg-surface-inset h-[500px] overflow-auto font-mono text-[12px] leading-relaxed">
            {(logsLoading || envLoading) ? (
              <div className="flex items-center gap-2 text-cyan-500/50">
                <span className="inline-block w-2 h-4 bg-cyan-500/50 animate-pulse" />
                <span className="animate-pulse">executing...</span>
              </div>
            ) : (
              <pre className={`whitespace-pre-wrap ${selectedPod.type === 'logs' ? 'text-cyan-500/80' : 'text-amber-500/80'}`}>
                {selectedPod.type === 'logs' ? logsData?.logs : envData?.env}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════ PORT FORWARD DIALOG ══════ */}
      <Dialog open={selectedPod.type === 'forward'} onOpenChange={() => setSelectedPod({ name: '', type: null })}>
        <DialogContent className="max-w-sm bg-background border-border p-0 overflow-hidden rounded-lg shadow-2xl">
          <DialogHeader className="px-4 py-2.5 border-b border-border bg-surface">
            <DialogTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground font-mono flex items-center gap-2">
              <Share2 className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-emerald-500">port-forward</span>
              <span className="text-muted-foreground/20">|</span>
              <span className="text-muted-foreground">{selectedPod.name}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-[9px] uppercase tracking-[0.2em] font-bold text-muted-foreground">Local Port</label>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={forwardPort}
                  onChange={(e) => setForwardPort(e.target.value)}
                  className="bg-foreground/[0.03] border-border font-mono text-cyan-400 text-sm h-8 rounded-sm focus-visible:ring-cyan-500/20"
                  placeholder="8080"
                />
                <p className="text-[8px] text-muted-foreground/60">Your machine</p>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] uppercase tracking-[0.2em] font-bold text-muted-foreground">Remote Port</label>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={remotePort}
                  onChange={(e) => setRemotePort(e.target.value)}
                  className="bg-foreground/[0.03] border-border font-mono text-emerald-400 text-sm h-8 rounded-sm focus-visible:ring-emerald-500/20"
                  placeholder="80"
                />
                {(() => {
                  const pod = pods?.find(p => p.name === selectedPod.name);
                  const cPorts = pod?.containerPorts;
                  if (!cPorts || cPorts.length === 0) return <p className="text-[8px] text-amber-500/80">⚠ No ports declared in pod spec</p>;
                  return (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[8px] text-muted-foreground/60">Ports:</span>
                      {cPorts.map((cp) => (
                        <button
                          key={cp.port}
                          type="button"
                          onClick={() => setRemotePort(String(cp.port))}
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border transition-colors ${
                            remotePort === String(cp.port)
                              ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                              : 'bg-foreground/[0.03] border-border text-muted-foreground hover:text-emerald-400 hover:border-emerald-500/20'
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
            <div className="text-[10px] text-muted-foreground font-mono bg-foreground/[0.03] px-2.5 py-1.5 rounded-sm border border-border">
              localhost:<span className="text-cyan-400">{forwardPort || '?'}</span>
              <span className="text-muted-foreground/60 mx-1">→</span>
              {selectedPod.name}:<span className="text-emerald-400">{remotePort || forwardPort || '?'}</span>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" className="text-[10px] uppercase font-bold tracking-wider h-7 px-3 text-muted-foreground hover:text-foreground" onClick={() => setSelectedPod({ name: '', type: null })}>
                Cancel
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] uppercase font-bold tracking-wider h-7 px-4 rounded-sm"
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
        <DialogContent className="max-w-sm bg-background border-border p-0 overflow-hidden rounded-lg shadow-2xl">
          <DialogHeader className="px-4 py-2.5 border-b border-border bg-surface">
            <DialogTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground font-mono flex items-center gap-2">
              <Scaling className="w-3.5 h-3.5 text-cyan-500" />
              <span className="text-cyan-500">scale</span>
              <span className="text-muted-foreground/20">|</span>
              <span className="text-muted-foreground">{scaleDialog?.name}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-[9px] uppercase tracking-[0.2em] font-bold text-muted-foreground">Replicas</label>
              <Input 
                type="number"
                min={0}
                value={scaleReplicas}
                onChange={(e) => setScaleReplicas(e.target.value)}
                className="bg-foreground/[0.03] border-border font-mono text-cyan-400 text-sm h-8 rounded-sm focus-visible:ring-cyan-500/20"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" className="text-[10px] uppercase font-bold tracking-wider h-7 px-3 text-muted-foreground hover:text-foreground" onClick={() => setScaleDialog(null)}>Cancel</Button>
              <Button className="bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] uppercase font-bold tracking-wider h-7 px-4 rounded-sm" onClick={handleScale}>Scale</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══════ PORT FORWARD STATUS BAR ══════ */}
      {portForwards && portForwards.length > 0 && (
        <div className="border-t border-border bg-surface/90 px-4 py-1.5 flex items-center gap-3 overflow-x-auto shrink-0">
          <Share2 className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="text-[9px] uppercase tracking-wider font-bold text-emerald-400/80 shrink-0">FORWARDS</span>
          <div className="w-px h-4 bg-foreground/5" />
          {portForwards.map((fwd) => {
            const isDead = fwd.status === "dead" || fwd.status === "error";
            return (
              <div
                key={fwd.id}
                className={`flex items-center gap-2 px-2 py-0.5 rounded-sm shrink-0 border ${
                  isDead
                    ? 'bg-red-500/5 border-red-500/15'
                    : 'bg-emerald-500/5 border-emerald-500/15'
                }`}
                title={isDead ? `Error: ${fwd.error || "Process died"}` : `Active — ${fwd.connections || 0} connections handled`}
              >
                <div className="relative">
                  {isDead ? (
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  ) : (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping opacity-50" />
                    </>
                  )}
                </div>
                <a
                  href={`http://localhost:${fwd.localPort}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-[10px] font-mono hover:underline ${isDead ? 'text-red-400/90' : 'text-emerald-400/90'}`}
                >
                  :{fwd.localPort}
                </a>
                <span className="text-[9px] text-muted-foreground">{"\u2192"}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{fwd.pod}:{fwd.remotePort}</span>
                {isDead && (
                  <span className="text-[8px] text-red-400/70 uppercase font-bold">DEAD</span>
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
                  className="p-0.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                  title="Stop"
                >
                  <Square className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <CommandBar command={currentCmd} />
    </div>
  );
}
