import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { AlertTriangle, CheckCircle2, FolderKanban, LayoutList, Loader2, Pencil, Trash2, Workflow } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ResourceTable } from "@/components/ResourceTable";
import { useAcrossScopes } from "@/hooks/use-k8s";
import { useHashParams } from "@/hooks/use-hash-params";
import { deleteProject, useProjects, type ProjectScope } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { MapView } from "@/pages/MapPage";
import { deploymentDegraded, healthOf, podFailing } from "./project-health";
import { ProjectDialog } from "./ProjectDialog";

const scopeKey = (s: ProjectScope) => `${s.context}/${s.namespace}`;
const detailHref = (type: string, name: string, s: ProjectScope) =>
  `/resource/${type}/${encodeURIComponent(name)}?context=${encodeURIComponent(s.context)}&namespace=${encodeURIComponent(s.namespace)}`;

type Tab = "overview" | "workloads" | "map";

/** `/projects/:id` — one application across its namespaces and clusters. */
export default function ProjectPage() {
  const [, params] = useRoute("/projects/:id");
  const [, navigate] = useLocation();
  const project = useProjects().find((p) => p.id === params?.id);
  const { get, set } = useHashParams();
  const tab = (get("tab") as Tab) || "overview";
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const data = useAcrossScopes(project?.scopes ?? []);

  if (!project) {
    return (
      <div className="flex h-full flex-col">
        <AppHeader breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Projects", href: "/projects" }, { label: "Not found" }]} />
        <p className="px-7 py-10 text-sm text-muted-foreground">This project does not exist in this browser.</p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: typeof LayoutList }[] = [
    { id: "overview", label: "Overview", icon: CheckCircle2 },
    { id: "workloads", label: "Workloads", icon: LayoutList },
    { id: "map", label: "Map", icon: Workflow },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <AppHeader breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Projects", href: "/projects" }, { label: project.name }]} rightSlot={<LiveRefresh />} />
      <div className="space-y-3 border-b border-border/60 px-5 py-3 sm:px-7">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><FolderKanban className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-tight">{project.name}</h1>
            {project.description && <p className="truncate text-xs text-muted-foreground">{project.description}</p>}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => setEditing(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" />Edit</button>
            {confirmDelete ? (
              <span className="inline-flex items-center gap-1.5 text-xs">
                Delete from this browser?
                <button type="button" onClick={() => { deleteProject(project.id); navigate("/projects"); }} className="rounded-md bg-destructive px-2 py-1 font-semibold text-destructive-foreground">Delete</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted">Cancel</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} aria-label="Delete project" className="inline-flex h-8 items-center rounded-lg border border-border px-2 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            )}
          </div>
        </div>
        <div role="tablist" aria-label="Project views" className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => set("tab", t.id === "overview" ? null : t.id)}
              className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
            >
              <t.icon className="h-3.5 w-3.5" />{t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "map" ? (
        <ProjectMap scopes={project.scopes} />
      ) : (
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-5 py-4 sm:px-7">
            {tab === "overview" ? <Overview data={data} /> : <Workloads data={data} />}
          </div>
        </main>
      )}
      <ProjectDialog open={editing} onClose={() => setEditing(false)} project={project} />
    </div>
  );
}

type ScopeData = ReturnType<typeof useAcrossScopes>[number];

function Overview({ data }: { data: ScopeData[] }) {
  const [, navigate] = useLocation();
  const problems = data.flatMap((d) => [
    ...(d.pods ?? []).filter((p) => podFailing(p.status)).map((p) => ({ key: `${scopeKey(d.scope)}/pod/${p.name}`, text: `Pod ${p.name}`, why: p.status, href: detailHref("pod", p.name, d.scope), scope: d.scope })),
    ...(d.deployments ?? []).filter((x) => deploymentDegraded(x.ready)).map((x) => ({ key: `${scopeKey(d.scope)}/deploy/${x.name}`, text: `Deployment ${x.name}`, why: `${x.ready} ready`, href: detailHref("deployment", x.name, d.scope), scope: d.scope })),
  ]);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((d) => {
          const h = healthOf(d.pods, d.deployments);
          const bad = h.failing + h.degraded;
          return (
            <div key={scopeKey(d.scope)} className="card-elevated p-3.5">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", d.loading ? "bg-muted-foreground/40" : d.error ? "bg-warning" : bad ? "bg-destructive" : "bg-success")} />
                <span className="truncate font-mono text-xs"><span className="text-muted-foreground">{d.scope.context}/</span>{d.scope.namespace}</span>
              </div>
              {d.loading ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Checking…</p>
              ) : d.error ? (
                <p className="mt-2 text-xs text-warning">{d.error}</p>
              ) : (
                <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                  {h.deployments} deployments{h.degraded ? <span className="text-destructive"> ({h.degraded} degraded)</span> : ""} · {h.pods} pods{h.failing ? <span className="text-destructive"> ({h.failing} failing)</span> : ""}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <section className="card-elevated">
        <h2 className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5 text-sm font-semibold">
          <AlertTriangle className={cn("h-4 w-4", problems.length ? "text-destructive" : "text-muted-foreground")} />
          Needs attention <span className="text-xs font-normal tabular-nums text-muted-foreground">{problems.length}</span>
        </h2>
        {problems.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-success" />Everything in this project is healthy.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {problems.map((p) => (
              <li key={p.key}>
                <button type="button" onClick={() => navigate(p.href)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-primary/[0.04]">
                  <span className="min-w-0 flex-1 truncate">{p.text}</span>
                  <span className="text-xs text-destructive">{p.why}</span>
                  <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">{p.scope.context}/{p.scope.namespace}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
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
            <button
              key={scopeKey(s)}
              type="button"
              onClick={() => set("scope", scopeKey(s))}
              className={cn("rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition-colors", s === current ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {scopeKey(s)}
            </button>
          ))}
        </div>
      )}
      <MapView key={scopeKey(current)} context={current.context} namespace={current.namespace} />
    </div>
  );
}
