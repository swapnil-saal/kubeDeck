import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { useK8sContexts, useK8sNamespaces, useK8sPods, useK8sDeployments, useK8sServices } from "@/hooks/use-k8s";
import { ResourceTable } from "@/components/ResourceTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Box, Layers, Network, RefreshCw, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { K8sPod, K8sDeployment, K8sService } from "@shared/schema";

export default function Dashboard() {
  const [currentContext, setCurrentContext] = useState<string>("");
  const [currentNamespace, setCurrentNamespace] = useState<string>("default");
  
  // Fetch contexts to set initial default
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

  const handleRefresh = () => {
    refetchPods();
    refetchDeploy();
    refetchServices();
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
    <div className="flex h-screen bg-background overflow-hidden font-sans">
      <Sidebar 
        currentContext={currentContext} 
        onContextChange={setCurrentContext} 
      />
      
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Navbar */}
        <header className="h-16 border-b border-border/50 flex items-center justify-between px-8 bg-card/30 backdrop-blur-sm">
          <div className="flex items-center gap-6">
            <h2 className="text-xl font-semibold tracking-tight">Cluster Overview</h2>
            <div className="h-6 w-px bg-border/50" />
            
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Namespace:</span>
              <Select value={currentNamespace} onValueChange={setCurrentNamespace}>
                <SelectTrigger className="w-48 h-8 bg-secondary/30 border-primary/10 focus:ring-primary/20">
                  <SelectValue placeholder="Select namespace" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Namespaces</SelectItem>
                  {namespaces?.map((ns) => (
                    <SelectItem key={ns.name} value={ns.name}>
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
              className="p-2 hover:bg-secondary/50 rounded-full text-muted-foreground hover:text-primary transition-colors"
              title="Refresh resources"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-emerald-500">Connected</span>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-7xl mx-auto space-y-8">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="p-6 bg-gradient-to-br from-card to-card/50 border-border/50 shadow-lg">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400">
                    <Box className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">Active Pods</p>
                    <h3 className="text-2xl font-bold font-mono mt-1">
                      {podsLoading ? "..." : pods?.length}
                    </h3>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-br from-card to-card/50 border-border/50 shadow-lg">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400">
                    <Layers className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">Deployments</p>
                    <h3 className="text-2xl font-bold font-mono mt-1">
                      {deployLoading ? "..." : deployments?.length}
                    </h3>
                  </div>
                </div>
              </Card>
              
              <Card className="p-6 bg-gradient-to-br from-card to-card/50 border-border/50 shadow-lg">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400">
                    <Network className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">Services</p>
                    <h3 className="text-2xl font-bold font-mono mt-1">
                      {servicesLoading ? "..." : services?.length}
                    </h3>
                  </div>
                </div>
              </Card>
            </div>

            {/* Resources Tabs */}
            <Tabs defaultValue="pods" className="w-full">
              <TabsList className="bg-secondary/30 border border-border/50 p-1 h-12 rounded-xl mb-6 w-full md:w-auto inline-flex">
                <TabsTrigger value="pods" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg px-6 h-9 transition-all">
                  Pods
                </TabsTrigger>
                <TabsTrigger value="deployments" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg px-6 h-9 transition-all">
                  Deployments
                </TabsTrigger>
                <TabsTrigger value="services" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg px-6 h-9 transition-all">
                  Services
                </TabsTrigger>
              </TabsList>

              <AnimatePresence mode="wait">
                <TabsContent value="pods" className="mt-0 focus-visible:outline-none">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ResourceTable
                      data={pods}
                      isLoading={podsLoading}
                      columns={[
                        { header: "Name", accessorKey: "name", cell: (item) => <span className="font-semibold">{item.name}</span> },
                        { header: "Namespace", accessorKey: "namespace" },
                        { header: "Status", accessorKey: "status" },
                        { header: "Restarts", accessorKey: "restarts" },
                        { header: "Age", accessorKey: "age" },
                        { header: "Node", accessorKey: "node" },
                      ]}
                    />
                  </motion.div>
                </TabsContent>

                <TabsContent value="deployments" className="mt-0 focus-visible:outline-none">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ResourceTable
                      data={deployments}
                      isLoading={deployLoading}
                      columns={[
                        { header: "Name", accessorKey: "name", cell: (item) => <span className="font-semibold">{item.name}</span> },
                        { header: "Namespace", accessorKey: "namespace" },
                        { header: "Ready", accessorKey: "ready", cell: (item) => <span className="px-2 py-1 bg-primary/20 rounded-md text-xs">{item.ready}</span> }, // Using ready as status-like
                        { header: "Up-to-date", accessorKey: "upToDate" },
                        { header: "Available", accessorKey: "available" },
                        { header: "Age", accessorKey: "age" },
                      ]}
                    />
                  </motion.div>
                </TabsContent>

                <TabsContent value="services" className="mt-0 focus-visible:outline-none">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ResourceTable
                      data={services}
                      isLoading={servicesLoading}
                      columns={[
                        { header: "Name", accessorKey: "name", cell: (item) => <span className="font-semibold">{item.name}</span> },
                        { header: "Namespace", accessorKey: "namespace" },
                        { header: "Type", accessorKey: "type", cell: (item) => <span className="text-xs font-mono bg-secondary px-2 py-1 rounded">{item.type}</span> },
                        { header: "Cluster IP", accessorKey: "clusterIP" },
                        { header: "Ports", accessorKey: "ports" },
                        { header: "Age", accessorKey: "age" },
                      ]}
                    />
                  </motion.div>
                </TabsContent>
              </AnimatePresence>
            </Tabs>
          </div>
        </div>
      </main>
    </div>
  );
}
