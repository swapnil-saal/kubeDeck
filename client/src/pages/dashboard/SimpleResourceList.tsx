import { ResourceTable } from "@/components/ResourceTable";

/** What a resource list needs from its query. */
export interface ListQuery {
  data?: any[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export type SimpleKindKey =
  | "services" | "statefulsets" | "daemonsets" | "jobs" | "cronjobs"
  | "configmaps" | "secrets" | "ingresses" | "hpa" | "pvcs";

export interface SimpleResourceListProps {
  kind: SimpleKindKey;
  query: ListQuery;
  search: string;
  onSearchChange: (value: string) => void;
  /** one namespace selected — the Namespace column is redundant */
  nsScoped: boolean;
  goToDetail: (type: string, name: string, ns?: string) => void;
}

/** The table for one read-only resource kind (pods and deployments have richer lists of their own). */
export function SimpleResourceList({ kind, query, search, onSearchChange, nsScoped, goToDetail }: SimpleResourceListProps) {
  switch (kind) {
    case "services":
      return (
        <ResourceTable
              tableId="services"

              hideNamespace={nsScoped}

              emptyLabel="services"
              search={search}
              onSearchChange={onSearchChange}
              data={query.data}
              isLoading={query.isLoading}
              isError={query.isError}
              error={query.error}
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
      );
    case "statefulsets":
      return (
        <ResourceTable
              tableId="statefulsets"

              hideNamespace={nsScoped}

              emptyLabel="StatefulSets"
              search={search}
              onSearchChange={onSearchChange}
              data={query.data}
              isLoading={query.isLoading}
              isError={query.isError}
              error={query.error}
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
      );
    case "daemonsets":
      return (
        <ResourceTable
              tableId="daemonsets"

              hideNamespace={nsScoped}

              emptyLabel="DaemonSets"
              search={search}
              onSearchChange={onSearchChange}
              data={query.data}
              isLoading={query.isLoading}
              isError={query.isError}
              error={query.error}
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
      );
    case "jobs":
      return (
        <ResourceTable
              tableId="jobs"

              hideNamespace={nsScoped}

              emptyLabel="jobs"
              search={search}
              onSearchChange={onSearchChange}
              data={query.data}
              isLoading={query.isLoading}
              isError={query.isError}
              error={query.error}
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
      );
    case "cronjobs":
      return (
        <ResourceTable
              tableId="cronjobs"

              hideNamespace={nsScoped}

              emptyLabel="CronJobs"
              search={search}
              onSearchChange={onSearchChange}
              data={query.data}
              isLoading={query.isLoading}
              isError={query.isError}
              error={query.error}
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
      );
    case "configmaps":
      return (
        <ResourceTable
              tableId="configmaps"

              hideNamespace={nsScoped}

              emptyLabel="ConfigMaps"
              search={search}
              onSearchChange={onSearchChange}
              data={query.data}
              isLoading={query.isLoading}
              isError={query.isError}
              error={query.error}
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
      );
    case "secrets":
      return (
        <ResourceTable
              tableId="secrets"

              hideNamespace={nsScoped}

              emptyLabel="secrets"
              search={search}
              onSearchChange={onSearchChange}
              data={query.data}
              isLoading={query.isLoading}
              isError={query.isError}
              error={query.error}
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
      );
    case "ingresses":
      return (
        <ResourceTable
              tableId="ingresses"

              hideNamespace={nsScoped}

              emptyLabel="ingresses"
              search={search}
              onSearchChange={onSearchChange}
              data={query.data}
              isLoading={query.isLoading}
              isError={query.isError}
              error={query.error}
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
      );
    case "hpa":
      return (
        <ResourceTable
              tableId="hpa"

              hideNamespace={nsScoped}

              emptyLabel="HPAs"
              search={search}
              onSearchChange={onSearchChange}
              data={query.data}
              isLoading={query.isLoading}
              isError={query.isError}
              error={query.error}
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
      );
    case "pvcs":
      return (
        <ResourceTable
              tableId="pvcs"

              hideNamespace={nsScoped}

              emptyLabel="PVCs"
              search={search}
              onSearchChange={onSearchChange}
              data={query.data}
              isLoading={query.isLoading}
              isError={query.isError}
              error={query.error}
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
      );
  }
}
