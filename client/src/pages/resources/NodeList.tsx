import { useState } from "react";
import { Ban, CircleCheck, Loader2, PackageMinus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ResourceTable } from "@/components/ResourceTable";
import { RowActions, type RowAction } from "@/components/RowActions";
import { useK8sNodes, useNodeAction } from "@/hooks/use-k8s";
import { useAccess } from "@/hooks/use-access";
import { useHashParams } from "@/hooks/use-hash-params";
import { useResourceNav } from "@/hooks/use-resource-nav";
import { useServerMode } from "@/hooks/use-server-mode";
import { useToast } from "@/hooks/use-toast";

const UNIT: Record<string, number> = { Ki: 1 / 1024 ** 2, Mi: 1 / 1024, Gi: 1, Ti: 1024 };

/** A node's memory capacity ("7786824Ki") in GiB; null when it is not a quantity. */
export function memoryGi(q: string): number | null {
  const m = q.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti)?$/);
  if (!m) return null;
  return m[2] ? Number(m[1]) * UNIT[m[2]] : Number(m[1]) / 1024 ** 3;
}

/** Nodes, with cordon / uncordon / drain for the people allowed to do them. */
export function NodeList({ context }: { context: string }) {
  const { get, set } = useHashParams();
  const { openDetail } = useResourceNav();
  const { canWrite } = useServerMode();
  const { toast } = useToast();
  const query = useK8sNodes(context);
  const nodeAction = useNodeAction();
  // nodes are cluster-scoped: cluster-wide grants show up in any namespace's review
  const { denied } = useAccess(context, ["default"]);
  const [draining, setDraining] = useState<string | null>(null);

  const run = async (name: string, action: "cordon" | "uncordon") => {
    try {
      const r = await nodeAction.mutateAsync({ name, action, context });
      toast({ title: action === "cordon" ? "Cordoned" : "Uncordoned", description: r.message });
    } catch (e) {
      toast({ title: `Could not ${action} ${name}`, description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <>
      <ResourceTable
        tableId="nodes"
        emptyLabel="nodes"
        search={get("q") || ""}
        onSearchChange={(q) => set("q", q || null)}
        data={query.data}
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        columns={[
          { header: "Node", accessorKey: "name", cell: (item) => (
            <button onClick={() => openDetail("node", item.name)} className="text-left font-medium text-foreground/80 underline-offset-2 transition-colors hover:text-foreground hover:underline">{item.name}</button>
          )},
          { header: "Status", accessorKey: "status" },
          { header: "Scheduling", id: "scheduling", sortValue: (item) => (item.schedulable ? 1 : 0), cell: (item) => item.schedulable
            ? <span className="text-[11px] text-muted-foreground">schedulable</span>
            : <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning"><Ban className="h-3 w-3" />cordoned</span> },
          { header: "Roles", accessorKey: "roles", cell: (item) => <span className="text-[10px] text-muted-foreground">{item.roles}</span> },
          { header: "Version", accessorKey: "version", cell: (item) => <span className="text-[10px] text-muted-foreground">{item.version}</span> },
          { header: "CPU", accessorKey: "cpu", cell: (item) => <span className="text-[10px] tabular-nums text-muted-foreground">{item.cpu}</span> },
          { header: "Memory", accessorKey: "memory", sortValue: (item) => memoryGi(item.memory), cell: (item) => (
            <span className="text-[10px] tabular-nums text-muted-foreground" title={item.memory}>{memoryGi(item.memory)?.toFixed(1) ?? item.memory}{memoryGi(item.memory) != null ? " GiB" : ""}</span>
          )},
          { header: "OS", accessorKey: "os", defaultHidden: true, cell: (item) => <span className="text-[10px] text-muted-foreground">{item.os}</span> },
          { header: "Age", accessorKey: "age" },
          { header: "", id: "actions", required: true, cell: (item) => {
            if (!canWrite) return null;
            const patchDenied = denied("default", "patch", "nodes");
            const actions: RowAction[] = [
              item.schedulable
                ? { id: "cordon", label: "Cordon", icon: Ban, description: "Stop scheduling new pods here; running pods stay", onSelect: () => void run(item.name, "cordon"), disabledReason: patchDenied }
                : { id: "uncordon", label: "Uncordon", icon: CircleCheck, description: "Allow new pods to be scheduled here again", onSelect: () => void run(item.name, "uncordon"), disabledReason: patchDenied },
              {
                id: "drain", label: "Drain…", icon: PackageMinus, danger: true, description: "Cordon it and evict its pods so they move elsewhere",
                onSelect: () => setDraining(item.name), disabledReason: patchDenied ?? denied("default", "create", "pods/eviction"),
              },
            ];
            return <RowActions subject={`node ${item.name}`} actions={actions} />;
          }},
        ]}
      />
      <DrainDialog node={draining} context={context} onClose={() => setDraining(null)} />
    </>
  );
}

function DrainDialog({ node, context, onClose }: { node: string | null; context: string; onClose: () => void }) {
  const { toast } = useToast();
  const drain = useNodeAction();
  const [deleteEmptyDirData, setDeleteEmptyDirData] = useState(false);
  const [force, setForce] = useState(false);

  const go = async () => {
    if (!node) return;
    try {
      const r = await drain.mutateAsync({ name: node, action: "drain", context, deleteEmptyDirData, force });
      toast({ title: "Drained", description: r.message });
      onClose();
    } catch {
      /* shown in the dialog */
    }
  };

  return (
    <Dialog open={node !== null} onOpenChange={(o) => { if (!o && !drain.isPending) { drain.reset(); onClose(); } }}>
      <DialogContent className="max-w-lg rounded-xl border-border bg-card p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <span className="rounded-lg bg-destructive/10 p-1.5 text-destructive"><PackageMinus className="h-3.5 w-3.5" /></span>
            Drain node
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">{node}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4 text-sm">
          <p className="text-muted-foreground">
            The node is cordoned, then every pod on it is evicted so its controller starts it on another node.
            DaemonSet pods stay. Pod disruption budgets are respected: the drain waits up to five minutes for them.
          </p>
          <label className="flex items-start gap-2.5 text-[13px]">
            <input type="checkbox" checked={deleteEmptyDirData} onChange={(e) => setDeleteEmptyDirData(e.target.checked)} className="mt-0.5 accent-[hsl(var(--primary))]" />
            <span>Also evict pods using <span className="font-mono text-xs">emptyDir</span> volumes <span className="block text-xs text-muted-foreground">Their scratch data is lost.</span></span>
          </label>
          <label className="flex items-start gap-2.5 text-[13px]">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="mt-0.5 accent-[hsl(var(--primary))]" />
            <span>Also evict pods no controller manages <span className="block text-xs text-muted-foreground">They are deleted and not recreated anywhere.</span></span>
          </label>
          {drain.error && <p className="whitespace-pre-wrap rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{drain.error.message}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={drain.isPending}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={go} disabled={drain.isPending} className="gap-1.5">
            {drain.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageMinus className="h-3.5 w-3.5" />}
            {drain.isPending ? "Draining…" : "Drain"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
