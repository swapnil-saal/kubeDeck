import { useEffect, useState } from "react";
import { FolderKanban, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useK8sContexts, useK8sNamespaces } from "@/hooks/use-k8s";
import { normalizeScopes, saveProject, type Project, type ProjectScope } from "@/lib/projects";

const field = "h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary/50";

/** Create or edit a project: a name and the (cluster, namespace) pairs it spans. */
export function ProjectDialog({ open, onClose, project, defaultScope, onSaved }: {
  open: boolean;
  onClose: () => void;
  project?: Project;
  /** pre-filled for a new project: the scope you are looking at */
  defaultScope?: ProjectScope;
  onSaved?: (p: Project) => void;
}) {
  const contexts = useK8sContexts();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopes, setScopes] = useState<ProjectScope[]>([]);
  const [ctx, setCtx] = useState("");
  const [ns, setNs] = useState("");
  const namespaces = useK8sNamespaces(ctx || undefined);

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setScopes(project?.scopes ?? (defaultScope && defaultScope.namespace !== "all" ? [defaultScope] : []));
    setCtx(defaultScope?.context ?? "");
    setNs("");
  }, [open, project, defaultScope]);

  const add = () => {
    if (!ctx || !ns) return;
    setScopes((s) => normalizeScopes([...s, { context: ctx, namespace: ns }]));
    setNs("");
  };
  const save = () => {
    const saved = saveProject({ id: project?.id, name, description, scopes });
    onSaved?.(saved);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg rounded-xl border-border bg-card p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <span className="rounded-lg bg-primary/10 p-1.5 text-primary"><FolderKanban className="h-3.5 w-3.5" /></span>
            {project ? "Edit project" : "New project"}
          </DialogTitle>
          <DialogDescription className="text-xs">An application across namespaces and clusters. Saved in this browser only.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Payments" autoFocus className={field} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Description <span className="font-normal">(optional)</span></span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Checkout, billing and their workers" className={field} />
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Namespaces</span>
            <div className="flex gap-2">
              <select value={ctx} onChange={(e) => { setCtx(e.target.value); setNs(""); }} aria-label="Cluster" className={field}>
                <option value="">Cluster…</option>
                {(contexts.data ?? []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              <select value={ns} onChange={(e) => setNs(e.target.value)} aria-label="Namespace" disabled={!ctx} className={field}>
                <option value="">{ctx ? (namespaces.isLoading ? "Loading…" : "Namespace…") : "Namespace…"}</option>
                {(namespaces.data ?? []).map((n) => <option key={n.name} value={n.name}>{n.name}</option>)}
              </select>
              <Button type="button" size="sm" variant="outline" onClick={add} disabled={!ctx || !ns} className="h-9 shrink-0 gap-1"><Plus className="h-3.5 w-3.5" />Add</Button>
            </div>
            {namespaces.isError && ctx && <p className="text-[11px] text-destructive">{namespaces.error?.message}</p>}
            <ul className="flex flex-wrap gap-1.5 pt-1">
              {scopes.length === 0 && <li className="text-xs text-muted-foreground">No namespaces yet.</li>}
              {scopes.map((s) => (
                <li key={`${s.context}/${s.namespace}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 py-0.5 pl-2.5 pr-1 font-mono text-[11px]">
                  <span className="text-muted-foreground">{s.context}</span>/<span>{s.namespace}</span>
                  <button type="button" onClick={() => setScopes((x) => x.filter((y) => y !== s))} aria-label={`Remove ${s.context}/${s.namespace}`} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={!name.trim() || scopes.length === 0}>{project ? "Save" : "Create project"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
