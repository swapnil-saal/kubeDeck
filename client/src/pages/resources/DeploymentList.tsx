import { useMemo } from "react";
import { Pin, PinOff, RotateCw, Scaling, ScrollText, Sparkles, X } from "lucide-react";
import { RowActions, type RowAction } from "@/components/RowActions";
import { usePins } from "@/hooks/use-pins";
import { ResourceTable } from "@/components/ResourceTable";
import { useK8sDeployments } from "@/hooks/use-k8s";
import { useHashParams } from "@/hooks/use-hash-params";
import { useResourceNav } from "@/hooks/use-resource-nav";
import { useServerMode } from "@/hooks/use-server-mode";
import type { useResourceActions } from "./resource-actions";

const readyOf = (ready: string) => {
  const [current, want] = ready.split("/").map(Number);
  return { current, want, ok: current === want && current > 0 };
};

export function DeploymentList({ context, namespace, actions: actions_ }: {
  context: string;
  namespace: string;
  actions: ReturnType<typeof useResourceActions>;
}) {
  const { get, set } = useHashParams();
  const search = get("q") || "";
  const onlyBad = get("f") === "bad";
  const { data, isLoading, isError, error } = useK8sDeployments(context, namespace);
  const { openDetail, openLogs, askAi } = useResourceNav();
  const pins = usePins(context);
  const serverMode = useServerMode();

  const shown = useMemo(() => (data && onlyBad ? data.filter((d) => readyOf(d.ready).current < readyOf(d.ready).want) : data), [data, onlyBad]);

  return (
    <>
      {onlyBad && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => set("f", null)}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
          >
            Only deployments that are not ready{shown ? ` · ${shown.length}` : ""}
            <X className="h-3 w-3" aria-label="Clear filter" />
          </button>
        </div>
      )}
      <ResourceTable
        tableId="deployments"
        hideNamespace={namespace !== "all"}
        emptyLabel="deployments"
        search={search}
        onSearchChange={(q) => set("q", q || null)}
        data={shown}
        isLoading={isLoading}
        isError={isError}
        error={error}
        accentColor="violet"
        columns={[
          { header: "Deployment", accessorKey: "name", cell: (item) => (
            <button onClick={() => openDetail("deployment", item.name, item.namespace)} className="text-left font-medium text-foreground/80 underline-offset-2 transition-colors hover:text-foreground hover:underline">
              {item.name}
            </button>
          )},
          { header: "NS", accessorKey: "namespace", cell: (item) => <span className="text-[10px] text-muted-foreground">{item.namespace}</span> },
          { header: "Ready", accessorKey: "ready", cell: (item) => (
            <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-bold ${readyOf(item.ready).ok ? "border-foreground/10 bg-foreground/5 text-foreground/70" : "border-border bg-foreground/[0.03] text-muted-foreground"}`}>
              {item.ready}
            </span>
          )},
          { header: "Image", accessorKey: "images" as any, cell: (item: any) => {
            const imgs: string[] = item.images || [];
            if (imgs.length === 0) return <span className="text-muted-foreground/60">-</span>;
            return (
              <div className="flex flex-col gap-0.5">
                {imgs.map((img, i) => <span key={i} className="text-[10px] text-muted-foreground" title={img}>{img.split("/").pop()?.split("@")[0] || img}</span>)}
              </div>
            );
          }},
          { header: "Strategy", accessorKey: "strategy" as any, cell: (item: any) => (
            <span className="rounded-sm border border-border bg-foreground/[0.04] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{item.strategy || "Rolling"}</span>
          )},
          { header: "Age", accessorKey: "age" },
          { header: "", id: "actions", required: true, cell: (item: { name: string; namespace: string; ready: string }) => {
            const ref = { context, namespace: item.namespace, type: "deployment", name: item.name };
            const pinned = pins.isPinned(ref);
            const { current, want } = readyOf(item.ready);
            const actions: RowAction[] = [];
            if (serverMode.aiEnabled) actions.push({
              id: "ai", label: "Diagnose with AI", icon: Sparkles, description: "The assistant checks rollout, pods, events and logs",
              onSelect: () => askAi(`Diagnose deployment ${item.name} in namespace ${item.namespace}: ${current}/${want} replicas ready. Check its rollout, pods, recent events and logs and tell me if anything is wrong.`),
            });
            if (serverMode.canWrite) {
              actions.push({ id: "scale", label: "Scale…", icon: Scaling, description: `Change the replica count (now ${want})`, onSelect: () => actions_.openScale(item.name, want) });
              actions.push({ id: "restart", label: "Rolling restart…", icon: RotateCw, description: "Replace its pods one by one", onSelect: () => actions_.restart(item.name) });
            }
            actions.push({
              id: "pin", label: pinned ? "Unpin" : "Pin", icon: pinned ? PinOff : Pin, description: pinned ? "Remove it from the Overview" : "Keep it at the top of the Overview",
              onSelect: () => pins.toggle(ref),
            });
            return (
              <RowActions
                subject={`deployment ${item.name}`}
                primary={{ label: "Logs", icon: ScrollText, onClick: () => openLogs("deployment", item.name, item.namespace) }}
                actions={actions}
              />
            );
          }},
        ]}
      />
    </>
  );
}
