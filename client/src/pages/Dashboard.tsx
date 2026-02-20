import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { useK8sContexts, useK8sNamespaces, useK8sPods, useK8sDeployments, useK8sServices, useDeletePod, usePodLogs, usePodEnv, usePortForward } from "@/hooks/use-k8s";
import { ResourceTable } from "@/components/ResourceTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Box, Layers, Network, RefreshCw, Terminal, List, Share2, Trash2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { K8sPod, K8sDeployment, K8sService } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const [currentContext, setCurrentContext] = useState<string>("");
  const [currentNamespace, setCurrentNamespace] = useState<string>("default");
  const [selectedPod, setSelectedPod] = useState<{ name: string; type: 'logs' | 'env' | 'forward' | null }>({ name: '', type: null });
  const [forwardPort, setForwardPort] = useState<string>("8080");
  const { toast } = useToast();

  const { data: contexts } = useK8sContexts();
  
  useEffect(() => {
    if (contexts && contexts.length > 0 && !currentContext) {
      const active = contexts.find(c => c.isCurrent);
      setCurrentContext(active ? active.name : contexts[0].name);
    }
  }, [contexts, currentContext]);

  const { data: namespaces } = useK8sNamespaces(currentContext);
  const { data: pods, isLoading: podsLoading, refetch: refetchPods } = useK8sPods(currentContext, currentNamespace);
  const { data: deployments, isLoading: deployLoading, refetch: refetchDeploy } = useK8sDeployments(currentContext, currentNamespace);
  const { data: services, isLoading: servicesLoading, refetch: refetchServices } = useK8sServices(currentContext, currentNamespace);

  const deletePodMutation = useDeletePod();
  const portForwardMutation = usePortForward();

  const { data: logsData, isLoading: logsLoading } = usePodLogs(
    selectedPod.name, 
    currentContext, 
    currentNamespace, 
    selectedPod.type === 'logs'
  );

  const { data: envData, isLoading: envLoading } = usePodEnv(
    selectedPod.name, 
    currentContext, 
    currentNamespace, 
    selectedPod.type === 'env'
  );

  const handleRefresh = () => {
    refetchPods();
    refetchDeploy();
    refetchServices();
  };

  const handleDeletePod = async (name: string) => {
    if (confirm(`Are you sure you want to delete pod ${name}?`)) {
      try {
        await deletePodMutation.mutateAsync({ name, context: currentContext, namespace: currentNamespace });
        toast({ title: "Pod Deleted", description: `Pod ${name} has been deleted.` });
      } catch (err) {
        toast({ title: "Error", description: "Failed to delete pod", variant: "destructive" });
      }
    }
  };

  const handlePortForward = async () => {
    try {
      await portForwardMutation.mutateAsync({ 
        name: selectedPod.name, 
        context: currentContext, 
        namespace: currentNamespace, 
        port: parseInt(forwardPort) 
      });
      toast({ title: "Port Forwarding Started", description: `Forwarding local port ${forwardPort} to ${selectedPod.name}` });
      setSelectedPod({ name: '', type: null });
    } catch (err) {
      toast({ title: "Error", description: "Failed to start port forward", variant: "destructive" });
    }
  };

  if (!currentContext && !contexts) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground font-mono">Connecting to cluster...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0a0a0c] overflow-hidden font-sans text-slate-200">
      <Sidebar 
        currentContext={currentContext} 
        onContextChange={setCurrentContext} 
      />
      
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 bg-black/40 backdrop-blur-md">
          <div className="flex items-center gap-6">
            <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <Terminal className="w-5 h-5 text-cyan-500" />
              KUBE-TERM
            </h2>
            <div className="h-4 w-px bg-white/10" />
            
            <div className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-widest text-slate-500 font-bold">Namespace</span>
              <Select value={currentNamespace} onValueChange={setCurrentNamespace}>
                <SelectTrigger className="w-48 h-8 bg-white/5 border-white/10 focus:ring-cyan-500/20 text-xs font-mono">
                  <SelectValue placeholder="Select namespace" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
                  <SelectItem value="all">All Namespaces</SelectItem>
                  {namespaces?.map((ns) => (
                    <SelectItem key={ns.name} value={ns.name} className="font-mono text-xs">
                      {ns.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-4">
             <button 
              onClick={handleRefresh}
              className="p-2 hover:bg-white/5 rounded-md text-slate-400 hover:text-cyan-400 transition-all active:scale-95"
              title="Refresh resources"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 px-3 py-1 bg-cyan-500/10 border border-cyan-500/20 rounded-md">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
              <span className="text-[10px] uppercase tracking-tighter font-bold text-cyan-500">System Ready</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyan-950/20 via-transparent to-transparent">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: "Active Pods", value: pods?.length, icon: Box, color: "text-cyan-400", bg: "bg-cyan-500/5" },
                { label: "Deployments", value: deployments?.length, icon: Layers, color: "text-violet-400", bg: "bg-violet-500/5" },
                { label: "Services", value: services?.length, icon: Network, color: "text-emerald-400", bg: "bg-emerald-500/5" }
              ].map((kpi, i) => (
                <Card key={i} className="p-4 bg-white/[0.02] border-white/5 shadow-2xl backdrop-blur-sm group hover:border-white/10 transition-all">
                  <div className="flex items-center gap-4">
                    <div className={`p-2.5 rounded-lg ${kpi.bg} ${kpi.color} border border-current/10`}>
                      <kpi.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{kpi.label}</p>
                      <h3 className="text-xl font-bold font-mono text-slate-100">
                        {(podsLoading && i === 0) || (deployLoading && i === 1) || (servicesLoading && i === 2) ? "---" : kpi.value}
                      </h3>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <Tabs defaultValue="pods" className="w-full">
              <TabsList className="bg-white/5 border border-white/5 p-1 h-10 rounded-lg mb-4">
                <TabsTrigger value="pods" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 text-xs font-bold uppercase tracking-wider rounded-md px-4 h-8 transition-all">
                  Pods
                </TabsTrigger>
                <TabsTrigger value="deployments" className="data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-400 text-xs font-bold uppercase tracking-wider rounded-md px-4 h-8 transition-all">
                  Deployments
                </TabsTrigger>
                <TabsTrigger value="services" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400 text-xs font-bold uppercase tracking-wider rounded-md px-4 h-8 transition-all">
                  Services
                </TabsTrigger>
              </TabsList>

              <AnimatePresence mode="wait">
                <TabsContent value="pods" className="mt-0 outline-none">
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <ResourceTable
                      data={pods}
                      isLoading={podsLoading}
                      columns={[
                        { header: "Name", accessorKey: "name", cell: (item) => <span className="font-mono text-cyan-400/90">{item.name}</span> },
                        { header: "Status", accessorKey: "status" },
                        { header: "Restarts", accessorKey: "restarts" },
                        { header: "Age", accessorKey: "age" },
                        { 
                          header: "Actions", 
                          cell: (item) => (
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-cyan-400" onClick={() => setSelectedPod({ name: item.name, type: 'logs' })} title="Logs">
                                <Terminal className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-violet-400" onClick={() => setSelectedPod({ name: item.name, type: 'env' })} title="Env">
                                <List className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-emerald-400" onClick={() => setSelectedPod({ name: item.name, type: 'forward' })} title="Forward">
                                <Share2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-red-400" onClick={() => handleDeletePod(item.name)} title="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )
                        },
                      ]}
                    />
                  </motion.div>
                </TabsContent>

                <TabsContent value="deployments" className="mt-0 outline-none">
                  <ResourceTable
                    data={deployments}
                    isLoading={deployLoading}
                    columns={[
                      { header: "Name", accessorKey: "name", cell: (item) => <span className="font-mono text-violet-400/90">{item.name}</span> },
                      { header: "Ready", accessorKey: "ready", cell: (item) => <span className="px-2 py-0.5 bg-violet-500/10 border border-violet-500/20 rounded text-[10px] font-bold text-violet-400">{item.ready}</span> },
                      { header: "Up-to-date", accessorKey: "upToDate" },
                      { header: "Available", accessorKey: "available" },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </TabsContent>

                <TabsContent value="services" className="mt-0 outline-none">
                  <ResourceTable
                    data={services}
                    isLoading={servicesLoading}
                    columns={[
                      { header: "Name", accessorKey: "name", cell: (item) => <span className="font-mono text-emerald-400/90">{item.name}</span> },
                      { header: "Type", accessorKey: "type", cell: (item) => <span className="text-[10px] font-bold uppercase text-slate-500">{item.type}</span> },
                      { header: "Cluster IP", accessorKey: "clusterIP" },
                      { header: "Ports", accessorKey: "ports" },
                      { header: "Age", accessorKey: "age" },
                    ]}
                  />
                </TabsContent>
              </AnimatePresence>
            </Tabs>
          </div>
        </div>
      </main>

      {/* Terminal View Dialog */}
      <Dialog open={selectedPod.type === 'logs' || selectedPod.type === 'env'} onOpenChange={() => setSelectedPod({ name: '', type: null })}>
        <DialogContent className="max-w-4xl bg-[#0a0a0c] border-white/10 p-0 overflow-hidden rounded-xl shadow-2xl">
          <DialogHeader className="px-6 py-4 border-b border-white/5 flex flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              {selectedPod.type === 'logs' ? 'POD_LOGS' : 'POD_ENVIRONMENT'} :: {selectedPod.name}
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 bg-black h-[500px] overflow-auto font-mono text-sm">
            {(logsLoading || envLoading) ? (
              <div className="flex items-center gap-2 text-slate-500 animate-pulse">
                <span className="w-2 h-2 bg-slate-500 rounded-full" />
                Executing command...
              </div>
            ) : (
              <pre className={`whitespace-pre-wrap ${selectedPod.type === 'logs' ? 'text-cyan-500/90' : 'text-amber-500/90'}`}>
                {selectedPod.type === 'logs' ? logsData?.logs : envData?.env}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Port Forward Dialog */}
      <Dialog open={selectedPod.type === 'forward'} onOpenChange={() => setSelectedPod({ name: '', type: null })}>
        <DialogContent className="max-w-md bg-[#0a0a0c] border-white/10 p-6 rounded-xl shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xs font-bold uppercase tracking-widest text-slate-400">
              PORT_FORWARD :: {selectedPod.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Local Port</label>
              <Input 
                value={forwardPort} 
                onChange={(e) => setForwardPort(e.target.value)}
                className="bg-white/5 border-white/10 font-mono text-cyan-400"
                placeholder="e.g. 8080"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" className="text-xs uppercase font-bold" onClick={() => setSelectedPod({ name: '', type: null })}>Cancel</Button>
              <Button className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs uppercase font-bold px-6" onClick={handlePortForward}>Initiate</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
