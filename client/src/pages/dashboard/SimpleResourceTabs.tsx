import { motion } from "framer-motion";
import { TabsContent } from "@/components/ui/tabs";
import { ResourceTable } from "@/components/ResourceTable";

/** What each simple resource tab needs from its query. */
export interface TabQuery {
  data?: any[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export type SimpleTabKey =
  | "services" | "statefulsets" | "daemonsets" | "jobs" | "cronjobs"
  | "configmaps" | "secrets" | "ingresses" | "nodes" | "hpa" | "pvcs";

export interface SimpleResourceTabsProps {
  q: Record<SimpleTabKey, TabQuery>;
  search: string;
  onSearchChange: (value: string) => void;
  /** one namespace selected — the Namespace column is redundant */
  nsScoped: boolean;
  goToDetail: (type: string, name: string, ns?: string) => void;
}

/** The read-only resource tabs: a table per kind, each fed by one query. */
export function SimpleResourceTabs({ q, search, onSearchChange, nsScoped, goToDetail }: SimpleResourceTabsProps) {
  return (
    <>
        {/* ── SERVICES ── */}
          <TabsContent value="services" className="mt-0 outline-none">
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <ResourceTable
              tableId="services"

              hideNamespace={nsScoped}

              emptyLabel="services"
              search={search}
              onSearchChange={onSearchChange}
              data={q.services.data}
              isLoading={q.services.isLoading}
              isError={q.services.isError}
              error={q.services.error}
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
              tableId="statefulsets"

              hideNamespace={nsScoped}

              emptyLabel="StatefulSets"
              search={search}
              onSearchChange={onSearchChange}
              data={q.statefulsets.data}
              isLoading={q.statefulsets.isLoading}
              isError={q.statefulsets.isError}
              error={q.statefulsets.error}
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
              tableId="daemonsets"

              hideNamespace={nsScoped}

              emptyLabel="DaemonSets"
              search={search}
              onSearchChange={onSearchChange}
              data={q.daemonsets.data}
              isLoading={q.daemonsets.isLoading}
              isError={q.daemonsets.isError}
              error={q.daemonsets.error}
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
              tableId="jobs"

              hideNamespace={nsScoped}

              emptyLabel="jobs"
              search={search}
              onSearchChange={onSearchChange}
              data={q.jobs.data}
              isLoading={q.jobs.isLoading}
              isError={q.jobs.isError}
              error={q.jobs.error}
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
              tableId="cronjobs"

              hideNamespace={nsScoped}

              emptyLabel="CronJobs"
              search={search}
              onSearchChange={onSearchChange}
              data={q.cronjobs.data}
              isLoading={q.cronjobs.isLoading}
              isError={q.cronjobs.isError}
              error={q.cronjobs.error}
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
              tableId="configmaps"

              hideNamespace={nsScoped}

              emptyLabel="ConfigMaps"
              search={search}
              onSearchChange={onSearchChange}
              data={q.configmaps.data}
              isLoading={q.configmaps.isLoading}
              isError={q.configmaps.isError}
              error={q.configmaps.error}
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
              tableId="secrets"

              hideNamespace={nsScoped}

              emptyLabel="secrets"
              search={search}
              onSearchChange={onSearchChange}
              data={q.secrets.data}
              isLoading={q.secrets.isLoading}
              isError={q.secrets.isError}
              error={q.secrets.error}
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
              tableId="ingresses"

              hideNamespace={nsScoped}

              emptyLabel="ingresses"
              search={search}
              onSearchChange={onSearchChange}
              data={q.ingresses.data}
              isLoading={q.ingresses.isLoading}
              isError={q.ingresses.isError}
              error={q.ingresses.error}
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
              tableId="nodes"

              hideNamespace={nsScoped}

              emptyLabel="nodes"
              search={search}
              onSearchChange={onSearchChange}
              data={q.nodes.data}
              isLoading={q.nodes.isLoading}
              isError={q.nodes.isError}
              error={q.nodes.error}
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
              tableId="hpa"

              hideNamespace={nsScoped}

              emptyLabel="HPAs"
              search={search}
              onSearchChange={onSearchChange}
              data={q.hpa.data}
              isLoading={q.hpa.isLoading}
              isError={q.hpa.isError}
              error={q.hpa.error}
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
              tableId="pvcs"

              hideNamespace={nsScoped}

              emptyLabel="PVCs"
              search={search}
              onSearchChange={onSearchChange}
              data={q.pvcs.data}
              isLoading={q.pvcs.isLoading}
              isError={q.pvcs.isError}
              error={q.pvcs.error}
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
    </>
  );
}
