import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useK8sContexts, useK8sNamespaces, useK8sPods, useK8sDeployments, useK8sServices, useDeletePod, usePodLogs, usePodEnv, usePortForward, K8sError } from "@/hooks/use-k8s";
import { ResourceTable } from "@/components/ResourceTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Box, Layers, Network, RefreshCw, Terminal, List, Share2, Trash2, Monitor, Cpu, Activity, ChevronRight, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const [currentContext, setCurrentContext] = useState<string>("");
  const [currentNamespace, setCurrentNamespace] = useState<string>("e2");
  const [selectedPod, setSelectedPod] = useState<{ name: string; type: 'logs' | 'env' | 'forward' | null }>({ name: '', type: null });
  const [forwardPort, setForwardPort] = useState<string>("8080");
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
      setCurrentContext(active ? active.name : contexts[0].name);
    }
  }, [contexts, currentContext]);

  const { data: namespaces } = useK8sNamespaces(currentContext);
  const { data: pods, isLoading: podsLoading, isError: podsError, error: podsErrorObj, refetch: refetchPods } = useK8sPods(currentContext, currentNamespace);
  const { data: deployments, isLoading: deployLoading, isError: deployError, error: deployErrorObj, refetch: refetchDeploy } = useK8sDeployments(currentContext, currentNamespace);
  const { data: services, isLoading: servicesLoading, isError: servicesError, error: servicesErrorObj, refetch: refetchServices } = useK8sServices(currentContext, currentNamespace);

  const deletePodMutation = useDeletePod();
  const portForwardMutation = usePortForward();

  const { data: logsData, isLoading: logsLoading } = usePodLogs(
    selectedPod.name, currentContext, currentNamespace, selectedPod.type === 'logs'
  );
  const { data: envData, isLoading: envLoading } = usePodEnv(
    selectedPod.name, currentContext, currentNamespace, selectedPod.type === 'env'
  );

  const handleRefresh = () => {
    refetchPods();
    refetchDeploy();
    refetchServices();
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
    try {
      await portForwardMutation.mutateAsync({ name: selectedPod.name, context: currentContext, namespace: currentNamespace, port: parseInt(forwardPort) });
      toast({ title: "Port Forward Active", description: `localhost:${forwardPort} → ${selectedPod.name}` });
      setSelectedPod({ name: '', type: null });
    } catch {
      toast({ title: "Error", description: "Port forward failed", variant: "destructive" });
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
      <div className="h-screen w-full flex items-center justify-center bg-[#06080c]">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
            <div className="absolute inset-0 w-12 h-12 border-2 border-transparent border-b-emerald-400/50 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
          </div>
          <p className="text-cyan-500/70 font-mono text-sm tracking-wider">INITIALIZING CLUSTER CONNECTION...</p>
        </div>
      </div>
    );
  }

  const stats = [
    { label: "PODS", value: getStatValue(pods, podsLoading, podsError, podsErrorObj), icon: Box, color: "cyan", isError: podsError, isForbidden: podsErrorObj instanceof K8sError && podsErrorObj.isForbidden },
    { label: "DEPLOYMENTS", value: getStatValue(deployments, deployLoading, deployError, deployErrorObj), icon: Layers, color: "violet", isError: deployError, isForbidden: deployErrorObj instanceof K8sError && deployErrorObj.isForbidden },
    { label: "SERVICES", value: getStatValue(services, servicesLoading, servicesError, servicesErrorObj), icon: Network, color: "emerald", isError: servicesError, isForbidden: servicesErrorObj instanceof K8sError && servicesErrorObj.isForbidden },
  ];

  return (
    <div className="flex flex-col h-screen bg-[#06080c] overflow-hidden font-mono text-slate-300 selection:bg-cyan-500/30">
      {/* ══════ HEADER BAR ══════ */}
      <header className="relative z-10 border-b border-cyan-500/10 bg-[#080a10]/90 backdrop-blur-xl">
        {/* Top accent line */}
        <div className="h-[1px] bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
        
        <div className="flex items-center h-12 px-4 gap-0">
          {/* Logo */}
          <div className="flex items-center gap-2.5 pr-5 border-r border-white/5">
            <div className="relative flex items-center justify-center w-7 h-7">
              <Monitor className="w-4.5 h-4.5 text-cyan-400" />
              <div className="absolute inset-0 bg-cyan-500/10 rounded blur-sm" />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold tracking-[0.2em] text-cyan-400">KUBEDECK</span>
            </div>
          </div>

          {/* Separator */}
          <ChevronRight className="w-3 h-3 text-white/10 mx-3" />

          {/* Context Select */}
          <div className="flex items-center gap-2 pr-4 border-r border-white/5">
            <span className="text-[9px] uppercase tracking-[0.2em] text-slate-600 font-bold">CTX</span>
            <Select value={currentContext} onValueChange={(v) => { setCurrentContext(v); setCurrentNamespace("default"); }}>
              <SelectTrigger className="w-44 h-7 bg-transparent border-white/[0.06] hover:border-cyan-500/20 focus:ring-0 focus:ring-offset-0 text-[11px] font-mono text-cyan-400 rounded-sm px-2">
                <SelectValue placeholder="select context" />
              </SelectTrigger>
              <SelectContent className="bg-[#0c0e14] border-cyan-500/10 text-slate-300 font-mono">
                {contexts?.map((ctx) => (
                  <SelectItem key={ctx.name} value={ctx.name} className="text-[11px] font-mono focus:bg-cyan-500/10 focus:text-cyan-300">
                    <div className="flex items-center gap-2">
                      {ctx.isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />}
                      {ctx.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Separator */}
          <ChevronRight className="w-3 h-3 text-white/10 mx-3" />

          {/* Namespace Select */}
          <div className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-[0.2em] text-slate-600 font-bold">NS</span>
            <Select value={currentNamespace} onValueChange={setCurrentNamespace}>
              <SelectTrigger className="w-44 h-7 bg-transparent border-white/[0.06] hover:border-cyan-500/20 focus:ring-0 focus:ring-offset-0 text-[11px] font-mono text-emerald-400 rounded-sm px-2">
                <SelectValue placeholder="select namespace" />
              </SelectTrigger>
              <SelectContent className="bg-[#0c0e14] border-cyan-500/10 text-slate-300 font-mono max-h-64">
                <SelectItem value="all" className="text-[11px] font-mono focus:bg-cyan-500/10 focus:text-cyan-300">
                  * all namespaces
                </SelectItem>
                {namespaces?.map((ns) => (
                  <SelectItem key={ns.name} value={ns.name} className="text-[11px] font-mono focus:bg-cyan-500/10 focus:text-cyan-300">
                    {ns.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-2">
            <motion.button
              onClick={handleRefresh}
              whileTap={{ rotate: 180 }}
              transition={{ duration: 0.3 }}
              className="p-1.5 hover:bg-white/5 rounded text-slate-500 hover:text-cyan-400 transition-all"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </motion.button>

            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/5 border border-emerald-500/15 rounded-sm">
              <div className="relative">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping opacity-75" />
              </div>
              <span className="text-[9px] uppercase tracking-[0.15em] font-bold text-emerald-400/80">LIVE</span>
            </div>
          </div>
        </div>

        {/* Bottom accent line */}
        <div className="h-[1px] bg-gradient-to-r from-cyan-500/20 via-transparent to-emerald-500/20" />
      </header>

      {/* ══════ MAIN CONTENT ══════ */}
      <main className="flex-1 overflow-auto relative">
        {/* Subtle grid background */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(6,182,212,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.015)_1px,transparent_1px)] bg-[size:48px_48px]" />
        {/* Gradient overlays */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/[0.02] rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-violet-500/[0.02] rounded-full blur-3xl" />
        
        <div className="relative p-5 max-w-[1600px] mx-auto space-y-5">
          {/* ── STAT CARDS ── */}
          <div className="grid grid-cols-3 gap-3">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`group relative overflow-hidden rounded border transition-all duration-300 cursor-default
                  ${stat.isForbidden
                    ? 'border-amber-500/20 bg-amber-500/[0.02] hover:border-amber-500/30'
                    : stat.isError 
                      ? 'border-red-500/20 bg-red-500/[0.03] hover:border-red-500/30' 
                      : `border-white/[0.04] bg-white/[0.01] hover:border-${stat.color}-500/20 hover:bg-${stat.color}-500/[0.02]`
                  }`}
              >
                {/* Top accent */}
                <div className={`h-[1px] ${stat.isError ? 'bg-red-500/30' : `bg-gradient-to-r from-${stat.color}-500/30 via-transparent to-transparent`}`} />
                
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded ${stat.isError ? 'bg-red-500/10 text-red-400' : `bg-${stat.color}-500/10 text-${stat.color}-400`}`}>
                      <stat.icon className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.2em] text-slate-600 font-bold">{stat.label}</p>
                      <p className={`text-2xl font-bold tabular-nums ${stat.isError ? 'text-red-400 text-lg' : 'text-slate-100'}`}>
                        {stat.value}
                      </p>
                    </div>
                  </div>
                  <Zap className={`w-3 h-3 ${stat.isError ? 'text-red-500/20' : 'text-white/[0.04] group-hover:text-' + stat.color + '-500/20'} transition-colors`} />
                </div>
              </motion.div>
            ))}
          </div>

          {/* ── RESOURCE TABS ── */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex items-center gap-4 mb-4">
              <TabsList className="bg-transparent border border-white/[0.04] p-0.5 h-8 rounded gap-0.5">
                {[
                  { val: "pods", label: "PODS", color: "cyan" },
                  { val: "deployments", label: "DEPLOY", color: "violet" },
                  { val: "services", label: "SVC", color: "emerald" },
                ].map(tab => (
                  <TabsTrigger
                    key={tab.val}
                    value={tab.val}
                    className={`text-[10px] font-bold uppercase tracking-[0.15em] rounded-sm px-4 h-7 transition-all data-[state=inactive]:text-slate-600 data-[state=inactive]:hover:text-slate-400
                      data-[state=active]:bg-${tab.color}-500/15 data-[state=active]:text-${tab.color}-400 data-[state=active]:shadow-none`}
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              
              <div className="ml-auto text-[10px] text-slate-600 font-mono flex items-center gap-1.5">
                <Activity className="w-3 h-3" />
                <span>{currentContext}</span>
                <span className="text-white/10">/</span>
                <span className="text-slate-500">{currentNamespace === 'all' ? '*' : currentNamespace}</span>
              </div>
            </div>

            <AnimatePresence mode="wait">
              <TabsContent value="pods" className="mt-0 outline-none">
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  <ResourceTable
                    data={pods}
                    isLoading={podsLoading}
                    isError={podsError}
                    error={podsErrorObj}
                    accentColor="cyan"
                    columns={[
                      { header: "Pod Name", accessorKey: "name", cell: (item) => (
                        <button onClick={() => goToDetail("pod", item.name, item.namespace)} className="text-cyan-400/90 font-medium hover:text-cyan-300 hover:underline underline-offset-2 transition-colors text-left">
                          {item.name}
                        </button>
                      )},
                      { header: "Namespace", accessorKey: "namespace", cell: (item) => (
                        <span className="text-slate-500">{item.namespace}</span>
                      )},
                      { header: "Status", accessorKey: "status" },
                      { header: "Restarts", accessorKey: "restarts", cell: (item) => (
                        <span className={item.restarts > 0 ? 'text-amber-400' : 'text-slate-500'}>
                          {item.restarts}
                        </span>
                      )},
                      { header: "Node", accessorKey: "node", cell: (item) => (
                        <span className="text-slate-600 text-[11px]">{item.node}</span>
                      )},
                      { header: "Age", accessorKey: "age" },
                      { header: "", cell: (item) => (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="p-1 rounded hover:bg-cyan-500/10 text-slate-600 hover:text-cyan-400 transition-colors" onClick={() => setSelectedPod({ name: item.name, type: 'logs' })} title="Logs">
                            <Terminal className="h-3 w-3" />
                          </button>
                          <button className="p-1 rounded hover:bg-violet-500/10 text-slate-600 hover:text-violet-400 transition-colors" onClick={() => setSelectedPod({ name: item.name, type: 'env' })} title="Env">
                            <List className="h-3 w-3" />
                          </button>
                          <button className="p-1 rounded hover:bg-emerald-500/10 text-slate-600 hover:text-emerald-400 transition-colors" onClick={() => setSelectedPod({ name: item.name, type: 'forward' })} title="Forward">
                            <Share2 className="h-3 w-3" />
                          </button>
                          <button className="p-1 rounded hover:bg-red-500/10 text-slate-600 hover:text-red-400 transition-colors" onClick={() => handleDeletePod(item.name)} title="Delete">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )},
                    ]}
                  />
                </motion.div>
              </TabsContent>

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
                        <button onClick={() => goToDetail("deployment", item.name, item.namespace)} className="text-violet-400/90 font-medium hover:text-violet-300 hover:underline underline-offset-2 transition-colors text-left">
                          {item.name}
                        </button>
                      )},
                      { header: "Namespace", accessorKey: "namespace", cell: (item) => (
                        <span className="text-slate-500">{item.namespace}</span>
                      )},
                      { header: "Ready", accessorKey: "ready", cell: (item) => {
                        const [current, total] = item.ready.split('/');
                        const healthy = current === total;
                        return (
                          <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold border ${healthy ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                            {item.ready}
                          </span>
                        );
                      }},
                      { header: "Up-to-date", accessorKey: "upToDate" },
                      { header: "Available", accessorKey: "available" },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </motion.div>
              </TabsContent>

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
                        <button onClick={() => goToDetail("service", item.name, item.namespace)} className="text-emerald-400/90 font-medium hover:text-emerald-300 hover:underline underline-offset-2 transition-colors text-left">
                          {item.name}
                        </button>
                      )},
                      { header: "Namespace", accessorKey: "namespace", cell: (item) => (
                        <span className="text-slate-500">{item.namespace}</span>
                      )},
                      { header: "Type", accessorKey: "type", cell: (item) => (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-white/[0.03] px-1.5 py-0.5 rounded-sm border border-white/[0.04]">{item.type}</span>
                      )},
                      { header: "Cluster IP", accessorKey: "clusterIP", cell: (item) => (
                        <span className="text-slate-400 tabular-nums">{item.clusterIP}</span>
                      )},
                      { header: "Ports", accessorKey: "ports", cell: (item) => (
                        <span className="text-cyan-500/70 text-[11px]">{item.ports}</span>
                      )},
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
        <DialogContent className="max-w-5xl bg-[#06080c] border-cyan-500/10 p-0 overflow-hidden rounded-lg shadow-2xl shadow-cyan-500/5">
          <DialogHeader className="px-4 py-2.5 border-b border-white/5 flex flex-row items-center justify-between space-y-0 bg-[#080a10]">
            <DialogTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2 font-mono">
              <Terminal className="w-3.5 h-3.5 text-cyan-500" />
              <span className="text-cyan-500">{selectedPod.type === 'logs' ? 'stdout' : 'env'}</span>
              <span className="text-white/10">|</span>
              <span className="text-slate-400">{selectedPod.name}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 bg-[#04060a] h-[500px] overflow-auto font-mono text-[12px] leading-relaxed">
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
        <DialogContent className="max-w-sm bg-[#06080c] border-cyan-500/10 p-0 overflow-hidden rounded-lg shadow-2xl">
          <DialogHeader className="px-4 py-2.5 border-b border-white/5 bg-[#080a10]">
            <DialogTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 font-mono flex items-center gap-2">
              <Share2 className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-emerald-500">port-forward</span>
              <span className="text-white/10">|</span>
              <span className="text-slate-400">{selectedPod.name}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-[9px] uppercase tracking-[0.2em] font-bold text-slate-600">Local Port</label>
              <Input 
                value={forwardPort} 
                onChange={(e) => setForwardPort(e.target.value)}
                className="bg-white/[0.02] border-white/[0.06] font-mono text-cyan-400 text-sm h-8 rounded-sm focus-visible:ring-cyan-500/20"
                placeholder="8080"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" className="text-[10px] uppercase font-bold tracking-wider h-7 px-3 text-slate-500 hover:text-slate-300" onClick={() => setSelectedPod({ name: '', type: null })}>
                Cancel
              </Button>
              <Button className="bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] uppercase font-bold tracking-wider h-7 px-4 rounded-sm" onClick={handlePortForward}>
                Connect
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
