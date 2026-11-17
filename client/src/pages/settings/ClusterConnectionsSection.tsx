/**
 * Settings → Clusters on a shared KubeDeck (admins): the only clusters it knows, each with the
 * connection KubeDeck uses for it. Groups then give people a service account on them.
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MoreHorizontal, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { shortIdentity } from "@shared/groups";
import type { ClusterInfo } from "@shared/clusters";
import { KubeconfigInput } from "@/components/KubeconfigInput";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAddCluster, useClusters, useRemoveCluster, useReplaceConnection } from "@/hooks/use-clusters";
import { cn } from "@/lib/utils";
import { InlineConfirm } from "./InlineConfirm";
import { PageAction } from "./SettingsCard";
import { field, Labeled } from "./users/user-fields";

type Source = "kubeconfig" | "in-cluster";

/** Adding a cluster, or (with `replacing`) a new kubeconfig for one. */
function ClusterSheet({ open, replacing, inClusterAvailable, onClose }: { open: boolean; replacing: ClusterInfo | null; inClusterAvailable: boolean; onClose: () => void }) {
  const add = useAddCluster();
  const replace = useReplaceConnection();
  const [name, setName] = useState("");
  const [source, setSource] = useState<Source>("kubeconfig");
  const [kubeconfig, setKubeconfig] = useState("");
  const pending = add.isPending || replace.isPending;
  const error = add.error ?? replace.error;
  const reset = () => { setName(""); setSource("kubeconfig"); setKubeconfig(""); add.reset(); replace.reset(); };
  const close = () => { reset(); onClose(); };
  const ready = replacing ? !!kubeconfig.trim() : !!name.trim() && (source === "in-cluster" || !!kubeconfig.trim());
  const save = () => {
    if (replacing) replace.mutate({ name: replacing.name, kubeconfig }, { onSuccess: close });
    else add.mutate(source === "in-cluster" ? { name: name.trim(), source } : { name: name.trim(), source, kubeconfig }, { onSuccess: close });
  };
  const tab = (on: boolean) => cn("rounded-md px-2.5 py-1 text-xs font-medium", on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="text-base font-semibold">{replacing ? `Reconnect ${replacing.name}` : "Add a cluster"}</SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {replacing
              ? "A new kubeconfig for KubeDeck's connection, for example when its token expired."
              : "The connection KubeDeck uses for this cluster: to list its namespaces and service accounts, and to impersonate the service accounts groups pick."}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {!replacing && (
            <Labeled label="Name" hint="how people see it, e.g. prod">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus className={cn(field, "font-mono")} placeholder="prod" />
            </Labeled>
          )}
          {!replacing && inClusterAvailable && (
            <div role="tablist" aria-label="Connection" className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
              <button type="button" role="tab" aria-selected={source === "kubeconfig"} onClick={() => setSource("kubeconfig")} className={tab(source === "kubeconfig")}>Upload kubeconfig</button>
              <button type="button" role="tab" aria-selected={source === "in-cluster"} onClick={() => setSource("in-cluster")} className={tab(source === "in-cluster")}>This cluster</button>
            </div>
          )}
          {source === "in-cluster" && !replacing ? (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              KubeDeck uses the service account of its own pod for the cluster it runs in. Give that account <code className="font-mono">impersonate</code> on the
              service accounts your groups will use.
            </p>
          ) : (
            <div className="space-y-2">
              <KubeconfigInput value={kubeconfig} onChange={setKubeconfig} prompt="Drop a kubeconfig for KubeDeck here," checkedWith={replacing?.name ?? (name.trim() || "the cluster")} />
              <p className="text-[11px] text-muted-foreground">
                A token or an inline client certificate only; exec plugins and file paths are refused. With several contexts, the one named like the
                cluster is used, else the current one. Kept encrypted, never shown again.
              </p>
            </div>
          )}
        </SheetBody>
        <SheetFooter>
          {error && <p role="alert" className="w-full text-xs text-destructive">{error.message}</p>}
          <Button size="sm" disabled={!ready || pending} onClick={save}>{pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {replacing ? "Reconnect" : "Add cluster"}</Button>
          <Button size="sm" variant="ghost" onClick={close}>Cancel</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ClusterRow({ cluster, onReplace }: { cluster: ClusterInfo; onReplace: () => void }) {
  const remove = useRemoveCluster();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <Server className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate font-mono text-sm font-medium">{cluster.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{cluster.source === "in-cluster" ? "KubeDeck's own pod service account" : cluster.server}</span>
          </span>
        </span>
        {cluster.identity ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={cluster.identity}>
            <CheckCircle2 className="h-3 w-3 text-success" aria-hidden /> signs in as <code className="font-mono text-foreground">{shortIdentity(cluster.identity)}</code>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-warning" title="The cluster did not answer when this was saved, so KubeDeck could not check these credentials. Upload the kubeconfig again once it is reachable.">
            <AlertTriangle className="h-3 w-3" aria-hidden /> not checked yet
          </span>
        )}
        <span className="w-40 truncate text-[11px] text-muted-foreground">{cluster.usedBy.length ? `used by ${cluster.usedBy.join(", ")}` : "no group yet"}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${cluster.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {cluster.source === "kubeconfig" && <DropdownMenuItem onSelect={onReplace}><RefreshCw className="h-3.5 w-3.5" /> Upload a new kubeconfig</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => setConfirm(true)} className="text-destructive focus:text-destructive"><Trash2 className="h-3.5 w-3.5" /> Remove cluster</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {confirm && (
        <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <InlineConfirm action="Remove" pending={remove.isPending} error={remove.error} onConfirm={() => remove.mutate(cluster.name, { onSuccess: () => setConfirm(false) })} onCancel={() => setConfirm(false)}>
            Remove <strong>{cluster.name}</strong> from KubeDeck? Nothing in the cluster changes; groups must stop using it first.
          </InlineConfirm>
        </div>
      )}
    </li>
  );
}

export function ClusterConnectionsSection() {
  const clusters = useClusters();
  const [adding, setAdding] = useState(false);
  const [replacing, setReplacing] = useState<ClusterInfo | null>(null);
  const list = clusters.data?.clusters ?? [];

  return (
    <div className="space-y-4">
      <PageAction>
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add cluster</Button>
      </PageAction>
      {clusters.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading clusters…</p>
      ) : clusters.error ? (
        <p role="alert" className="text-sm text-destructive">{clusters.error.message}</p>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <Server className="mx-auto mb-3 h-8 w-8 text-primary" aria-hidden />
          <p className="text-sm font-medium">No clusters yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            A shared KubeDeck reads no kubeconfig from its server. Add each cluster here with a kubeconfig for KubeDeck, then give groups a service
            account on it under Settings → Groups.
          </p>
          <Button size="sm" className="mt-4" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add cluster</Button>
        </div>
      ) : (
        <ul aria-label="Clusters" className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
          {list.map((c) => <ClusterRow key={c.name} cluster={c} onReplace={() => setReplacing(c)} />)}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">
        Nobody reaches a cluster just because it is here: people get it through a group that has a service account on it (admins too).
      </p>
      <ClusterSheet open={adding || replacing !== null} replacing={replacing} inClusterAvailable={!!clusters.data?.inClusterAvailable} onClose={() => { setAdding(false); setReplacing(null); }} />
    </div>
  );
}
