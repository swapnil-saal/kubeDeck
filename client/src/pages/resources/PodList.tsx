import { useMemo } from "react";
import { Braces, Cable, FolderTree, ListTree, Pin, PinOff, Rows3, ScrollText, Sparkles, Trash2, X } from "lucide-react";
import { RowActions, type RowAction } from "@/components/RowActions";
import { ResourceTable } from "@/components/ResourceTable";
import { useK8sPods } from "@/hooks/use-k8s";
import { usePodMetrics } from "@/hooks/use-cluster-extras";
import { useHashParams } from "@/hooks/use-hash-params";
import { usePins } from "@/hooks/use-pins";
import { useResourceNav } from "@/hooks/use-resource-nav";
import { useAccess } from "@/hooks/use-access";
import { useServerMode } from "@/hooks/use-server-mode";
import { parseCpuMilli } from "@/lib/cluster-health";
import type { ResourceRef } from "@/lib/pins";
import { cn } from "@/lib/utils";
import { WorkloadView, restartTone, type WorkloadPod } from "@/pages/dashboard/WorkloadView";
import type { useResourceActions } from "./resource-actions";

/** Failing pods sort first, then pending, then healthy, then finished. */
const STATUS_RANK = (status: string): number =>
  /^(CrashLoopBackOff|Error|ImagePullBackOff|ErrImagePull|OOMKilled|CreateContainerConfigError|InvalidImageName|Failed|Evicted)$/.test(status) ? 0
    : /^(Pending|ContainerCreating|PodInitializing|Terminating|Init:.*)$/.test(status) ? 1
    : status === "Running" ? 2 : 3;

/** Running with every container ready, or finished successfully. */
export function podIsOk(p: { status: string; ready?: string }): boolean {
  if (p.status === "Completed" || p.status === "Succeeded") return true;
  if (p.status !== "Running") return false;
  const m = p.ready?.match(/^(\d+)\/(\d+)$/);
  return !m || Number(m[1]) >= Number(m[2]);
}

export function PodList({ context, namespace, actions: actions_ }: {
  context: string;
  namespace: string;
  actions: ReturnType<typeof useResourceActions>;
}) {
  const { get, set } = useHashParams();
  const search = get("q") || "";
  const quickFilter = get("f");
  const grouped = get("view") === "grouped";
  const nsScoped = namespace !== "all";

  const { data: pods, isLoading, isError, error } = useK8sPods(context, namespace);
  // RBAC per namespace in view: actions the account cannot do are shown disabled with the reason
  const { denied } = useAccess(context, namespace === "all" ? (pods ?? []).map((p) => p.namespace) : [namespace]);
  const metrics = usePodMetrics(context, namespace);
  const pins = usePins(context);
  const serverMode = useServerMode();
  const { openDetail, openLogs, askAi } = useResourceNav();

  const usage = metrics.data?.available ? metrics.data.items : undefined;
  const usageByPod = useMemo(() => new Map((usage ?? []).map((u) => [u.namespace ? `${u.namespace}/${u.name}` : u.name, u])), [usage]);
  const usageOf = (p: { name: string; namespace?: string }) => usageByPod.get(p.namespace ? `${p.namespace}/${p.name}` : p.name) ?? usageByPod.get(p.name);

  const shown = useMemo(() => {
    if (!pods) return pods;
    if (quickFilter === "bad") return pods.filter((p) => !podIsOk(p));
    if (quickFilter === "restarts") return pods.filter((p) => p.restarts >= 5).sort((a, b) => b.restarts - a.restarts);
    return pods;
  }, [pods, quickFilter]);

  const ref = (type: string, name: string, ns: string): ResourceRef => ({ context, namespace: ns, type, name });

  return (
    <>
      {quickFilter && <div className="mb-3 flex flex-wrap items-center gap-2">
        {(
          <button
            type="button"
            onClick={() => set("f", null)}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
          >
            {quickFilter === "restarts" ? "Pods with 5+ restarts" : "Only unhealthy pods"}{shown ? ` · ${shown.length}` : ""}
            <X className="h-3 w-3" aria-label="Clear filter" />
          </button>
        )}
      </div>}

      {grouped ? (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
          <WorkloadView
            pods={(shown ?? []) as unknown as WorkloadPod[]}
            usage={usage}
            showNamespace={!nsScoped}
            isPinned={(t, n, ns) => pins.isPinned(ref(t, n, ns))}
            onOpen={openDetail}
            onLogs={openLogs}
            onPin={(t, n, ns) => pins.toggle(ref(t, n, ns))}
            onAsk={serverMode.aiEnabled ? askAi : undefined}
            onScale={actions_.openScale}
            onRestart={actions_.restart}
            canWrite={serverMode.canWrite}
          />
        </div>
      ) : (
        <ResourceTable
          tableId="pods"
          hideNamespace={nsScoped}
          emptyLabel="pods"
          search={search}
          onSearchChange={(q) => set("q", q || null)}
          data={shown}
          isLoading={isLoading}
          isError={isError}
          error={error}
          accentColor="cyan"
          columns={[
            { header: "Pod", accessorKey: "name", required: true, cell: (item) => (
              <button onClick={() => openDetail("pod", item.name, item.namespace)} className="text-left font-medium text-foreground/80 underline-offset-2 transition-colors hover:text-foreground hover:underline">
                {item.name}
              </button>
            )},
            { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-[10px] text-muted-foreground">{item.namespace}</span> },
            { header: "Ready", accessorKey: "ready" as any, cell: (item: any) => {
              const ready = item.ready || "0/0";
              const [cur, tot] = ready.split("/");
              const ok = cur === tot && Number(cur) > 0;
              return <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-bold ${ok ? "border-foreground/10 bg-foreground/5 text-foreground/70" : "border-border bg-foreground/[0.03] text-muted-foreground"}`}>{ready}</span>;
            }},
            { header: "Status", accessorKey: "status", sortValue: (item: any) => `${STATUS_RANK(item.status)}-${item.status}` },
            { header: "Image", accessorKey: "images" as any, defaultHidden: true, cell: (item: any) => {
              const imgs: string[] = item.images || [];
              if (imgs.length === 0) return <span className="text-muted-foreground/60">-</span>;
              return (
                <div className="flex flex-col gap-0.5">
                  {imgs.map((img, i) => <span key={i} className="text-[10px] text-muted-foreground" title={img}>{img.split("/").pop()?.split("@")[0] || img}</span>)}
                </div>
              );
            }},
            { header: "IP", accessorKey: "ip" as any, defaultHidden: true, cell: (item: any) => <span className="text-[10px] tabular-nums text-muted-foreground">{item.ip || "-"}</span> },
            { header: "Restarts", accessorKey: "restarts", cell: (item) => (
              <span className={`tabular-nums ${restartTone(item.restarts)}`} title={item.restarts >= 5 ? "Restarting repeatedly" : undefined}>{item.restarts}</span>
            )},
            { header: usage ? "CPU" : "CPU req", id: "cpu", sortValue: (item: any) => usageOf(item)?.cpuMilli ?? parseCpuMilli(item.cpu), cell: (item: any) => {
              const u = usageOf(item);
              if (u) return <span className="text-xs tabular-nums text-foreground/80" title={`${Math.round(u.memMi)}Mi memory in use`}>{Math.round(u.cpuMilli)}m</span>;
              const req = parseCpuMilli(item.cpu);
              return <span className="text-xs tabular-nums text-muted-foreground" title="Requested (live usage unavailable)">{req > 0 ? `${Math.round(req)}m` : "–"}</span>;
            }},
            { header: "Node", accessorKey: "node", defaultHidden: true, cell: (item) => <span className="text-[10px] text-muted-foreground">{item.node}</span> },
            { header: "Age", accessorKey: "age" },
            { header: "", id: "actions", required: true, cell: (item) => {
              const pinned = pins.isPinned(ref("pod", item.name, item.namespace));
              const actions: RowAction[] = [];
              if (serverMode.aiEnabled) actions.push({
                id: "ai", label: "Diagnose with AI", icon: Sparkles, description: "The assistant checks status, events and logs",
                onSelect: () => askAi(`Diagnose pod ${item.name} in namespace ${item.namespace}: it is ${item.status} with ${item.restarts} restarts. Check its describe output, recent logs and events and tell me if anything is wrong.`),
              });
              if (serverMode.features.podFiles) actions.push({
                id: "files", label: "Browse files", icon: FolderTree, description: "Explore, open and search the container's files",
                onSelect: () => openDetail("pod", item.name, item.namespace, "files"),
                disabledReason: denied(item.namespace, "create", "pods/exec"),
              });
              actions.push({
                id: "env", label: "Environment variables", icon: Braces, description: "The values the container runs with",
                onSelect: () => actions_.showEnv(item.name), disabledReason: denied(item.namespace, "create", "pods/exec"),
              });
              if (serverMode.features.portForward) actions.push({
                id: "forward", label: "Port forward…", icon: Cable, description: "Reach a container port on localhost",
                onSelect: () => actions_.openPortForward(item.name, item.containerPorts ?? []),
                disabledReason: denied(item.namespace, "create", "pods/portforward"),
              });
              actions.push({
                id: "pin", label: pinned ? "Unpin" : "Pin", icon: pinned ? PinOff : Pin, description: pinned ? "Remove it from the Overview" : "Keep it at the top of the Overview",
                onSelect: () => pins.toggle(ref("pod", item.name, item.namespace)),
              });
              if (serverMode.canWrite) actions.push({
                id: "delete", label: "Delete pod…", icon: Trash2, danger: true, description: "Its controller will usually start a replacement",
                onSelect: () => actions_.deletePod(item.name),
                disabledReason: denied(item.namespace, "delete", "pods"),
              });
              return (
                <RowActions
                  subject={`pod ${item.name}`}
                  primary={{ label: "Logs", icon: ScrollText, onClick: () => openLogs("pod", item.name, item.namespace) }}
                  actions={actions}
                />
              );
            }},
          ]}
        />
      )}
    </>
  );
}

/** List or grouped-by-workload; lives in the page header and shares the `view` URL parameter. */
export function PodViewToggle() {
  const { get, set } = useHashParams();
  const grouped = get("view") === "grouped";
  return (
    <div className="flex rounded-lg border border-border bg-card/60 p-0.5 text-xs font-medium" role="group" aria-label="Pod view">
          {[
            { on: !grouped, value: null, icon: Rows3, label: "List" },
            { on: grouped, value: "grouped", icon: ListTree, label: "By workload" },
          ].map(({ on, value, icon: Icon, label }) => (
            <button
              key={label}
              type="button"
              onClick={() => set("view", value)}
              aria-pressed={on}
              className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors", on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
  );
}
