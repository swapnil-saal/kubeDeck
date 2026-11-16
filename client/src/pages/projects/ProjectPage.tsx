import { useMemo, useState, type ReactNode } from "react";
import { useLocation, useRoute } from "wouter";
import { CheckCircle2, Columns3, FolderKanban, LayoutList, Loader2, Pencil, Trash2, Workflow } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ResourceTable } from "@/components/ResourceTable";
import { useAcrossScopes } from "@/hooks/use-k8s";
import { useHashParams } from "@/hooks/use-hash-params";
import { useDeleteProject, useProjects, type Project, type ProjectScope } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { MapView } from "@/pages/MapPage";
import { deploymentDegraded, healthOf, problemsByWorkload, scopeKey } from "./project-health";
import { ProjectCompare } from "./ProjectCompare";
import { ProjectDialog } from "./ProjectDialog";
import { detailHref, ProjectOverview, type ScopeData } from "./ProjectOverview";

type Tab = "overview" | "compare" | "workloads" | "map";
const TABS: { id: Tab; label: string; icon: typeof LayoutList }[] = [
  { id: "overview", label: "Overview", icon: CheckCircle2 },
  { id: "compare", label: "Compare", icon: Columns3 },
  { id: "workloads", label: "Workloads", icon: LayoutList },
  { id: "map", label: "Map", icon: Workflow },
];

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "bad" }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "bad" && "text-destructive", tone === "ok" && "text-success")}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** The project's health in four numbers: ready deployments, running pods, workloads with problems, where it runs. */
function Stats({ project, data }: { project: Project; data: ScopeData[] }) {
  const loading = data.some((d) => d.loading);
  const h = healthOf(data.flatMap((d) => d.pods ?? []), data.flatMap((d) => d.deployments ?? []));
  const problems = problemsByWorkload(data).length;
  const clusters = new Set(project.scopes.map((s) => s.context)).size;
  const pct = h.deployments ? Math.round(((h.deployments - h.degraded) / h.deployments) * 100) : 100;
  const dash = loading && h.deployments === 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Deployments ready" value={dash ? "…" : `${pct}%`} sub={dash ? undefined : `${h.deployments - h.degraded} of ${h.deployments}`} tone={dash ? undefined : h.degraded ? "bad" : "ok"} />
      <Stat label="Pods running" value={dash ? "…" : h.running} sub={dash ? undefined : `of ${h.pods}${h.failing ? `, ${h.failing} failing` : ""}`} />
      <Stat label="Needs attention" value={dash ? "…" : problems} sub={problems ? (problems === 1 ? "workload" : "workloads") : "all healthy"} tone={dash ? undefined : problems ? "bad" : "ok"} />
      <Stat label="Runs in" value={project.scopes.length} sub={`${project.scopes.length === 1 ? "namespace" : "namespaces"} on ${clusters} ${clusters === 1 ? "cluster" : "clusters"}`} />
    </div>
  );
}

function Actions({ project, onEdit }: { project: Project; onEdit: () => void }) {
  const [, navigate] = useLocation();
  const remove = useDeleteProject();
  const [confirm, setConfirm] = useState(false);
  if (!project.canEdit) return <span className="text-[11px] text-muted-foreground">Created by {project.createdBy || "someone else"}</span>;
  if (confirm) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
        {remove.error ? <span className="text-destructive">{remove.error.message}</span> : "Delete this project for everyone?"}
        <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(project.id, { onSuccess: () => navigate("/projects") })} className="rounded-md bg-destructive px-2 py-1 font-semibold text-destructive-foreground">Delete</button>
        <button type="button" onClick={() => setConfirm(false)} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted">Cancel</button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <button type="button" onClick={onEdit} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" />Edit</button>
      <button type="button" onClick={() => setConfirm(true)} aria-label="Delete project" className="inline-flex h-8 items-center rounded-lg border border-border px-2 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
    </span>
  );
}

/** `/projects/:id` — one application across its namespaces and clusters. */
export default function ProjectPage() {
  const [, params] = useRoute("/projects/:id");
  const projects = useProjects();
  const project = projects.data?.find((p) => p.id === params?.id);
  const { get, set } = useHashParams();
  const tab = (TABS.find((t) => t.id === get("tab"))?.id ?? "overview") as Tab;
  const [editing, setEditing] = useState(false);
  const data = useAcrossScopes(project?.scopes ?? []) as ScopeData[];

  if (!project) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Projects", href: "/projects" }, { label: "Not found" }]} />
        <p className="flex items-center gap-2 px-7 py-10 text-sm text-muted-foreground">
          {projects.isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</> : projects.error ? projects.error.message : "There is no such project. It may have been deleted."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <AppHeader breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Projects", href: "/projects" }, { label: project.name }]} rightSlot={<LiveRefresh />} />
      <div className="shrink-0 border-b border-border bg-background">
        <div className="mx-auto max-w-7xl px-5 pt-4 sm:px-7">
          <div className="flex flex-wrap items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><FolderKanban className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold tracking-tight">{project.name}</h1>
              {project.description && <p className="text-xs text-muted-foreground">{project.description}</p>}
            </div>
            <Actions project={project} onEdit={() => setEditing(true)} />
          </div>
          <nav role="tablist" aria-label="Project views" className="-mb-px mt-3 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => set("tab", t.id === "overview" ? null : t.id)}
                className={cn("inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px]", tab === t.id ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
                <t.icon className="h-3.5 w-3.5" />{t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {tab === "map" ? (
        <ProjectMap scopes={project.scopes} />
      ) : (
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl space-y-5 px-5 py-5 sm:px-7">
            {tab === "overview" && <Stats project={project} data={data} />}
            {tab === "overview" ? <ProjectOverview data={data} /> : tab === "compare" ? <ProjectCompare data={data} /> : <Workloads data={data} />}
          </div>
        </main>
      )}
      <ProjectDialog open={editing} onClose={() => setEditing(false)} project={project} />
    </div>
  );
}

interface WorkloadRow {
  name: string;
  status?: string;
  ready: string;
  images: string;
  age: string;
  scope: ProjectScope;
  scopeLabel: string;
}

function Workloads({ data }: { data: ScopeData[] }) {
  const [, navigate] = useLocation();
  const { get, set } = useHashParams();
  const rows = useMemo<WorkloadRow[]>(() => data.flatMap((d) => (d.deployments ?? []).map((x) => ({
    name: x.name, ready: x.ready, images: (x.images ?? []).join(", "), age: x.age, scope: d.scope, scopeLabel: scopeKey(d.scope),
    status: deploymentDegraded(x.ready) ? "Degraded" : "Ready",
  }))), [data]);
  return (
    <ResourceTable<WorkloadRow>
      tableId="project-workloads"
      emptyLabel="deployments"
      search={get("q") || ""}
      onSearchChange={(q) => set("q", q || null)}
      data={data.some((d) => d.deployments) ? rows : undefined}
      isLoading={data.some((d) => d.loading) && rows.length === 0}
      columns={[
        { header: "Deployment", accessorKey: "name", cell: (r) => (
          <button type="button" onClick={() => navigate(detailHref("deployment", r.name, r.scope))} className="text-left font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline">{r.name}</button>
        )},
        { header: "Where", accessorKey: "scopeLabel", cell: (r) => <span className="font-mono text-[11px] text-muted-foreground">{r.scopeLabel}</span> },
        { header: "Status", accessorKey: "status" },
        { header: "Ready", accessorKey: "ready", cell: (r) => <span className="tabular-nums text-xs">{r.ready}</span> },
        { header: "Image", accessorKey: "images", cell: (r) => <span className="truncate text-[11px] text-muted-foreground" title={r.images}>{r.images}</span> },
        { header: "Age", accessorKey: "age" },
      ]}
    />
  );
}

function ProjectMap({ scopes }: { scopes: ProjectScope[] }) {
  const { get, set } = useHashParams();
  const current = scopes.find((s) => scopeKey(s) === get("scope")) ?? scopes[0];
  if (!current) return <p className="px-7 py-10 text-sm text-muted-foreground">Add a namespace to this project to see its map.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {scopes.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-5 pt-3 sm:px-7">
          {scopes.map((s) => (
            <button key={scopeKey(s)} type="button" onClick={() => set("scope", scopeKey(s))}
              className={cn("rounded-full border px-2.5 py-0.5 font-mono text-[11px]", s === current ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
              {scopeKey(s)}
            </button>
          ))}
        </div>
      )}
      <MapView key={scopeKey(current)} context={current.context} namespace={current.namespace} />
    </div>
  );
}
