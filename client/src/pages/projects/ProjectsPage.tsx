import { useState } from "react";
import { useLocation } from "wouter";
import { FolderKanban, Plus } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { useAcrossScopes } from "@/hooks/use-k8s";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useProjects, type Project } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { healthOf } from "./project-health";
import { ProjectDialog } from "./ProjectDialog";

/** `/projects` — applications grouped across namespaces and clusters. */
export default function ProjectsPage() {
  const projects = useProjects();
  const { context, namespace } = useTerminalStore();
  const [creating, setCreating] = useState(false);
  const [, navigate] = useLocation();

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <AppHeader breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Projects" }]} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-4 px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><FolderKanban className="h-4 w-4" /></span>
            <h1 className="flex items-baseline gap-2 text-lg font-bold tracking-tight">
              Projects {projects.length > 0 && <span className="text-sm font-medium tabular-nums text-muted-foreground">{projects.length}</span>}
            </h1>
            <span className="text-xs text-muted-foreground">applications across namespaces and clusters · saved in this browser</span>
            <button type="button" onClick={() => setCreating(true)} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary/15">
              <Plus className="h-3.5 w-3.5" />New project
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="card-elevated mx-auto max-w-xl px-6 py-10 text-center">
              <FolderKanban className="mx-auto mb-3 h-8 w-8 text-primary" />
              <p className="text-sm font-medium">Group an application's namespaces into one view</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                A project brings together namespaces from any of your clusters, say <span className="font-mono">payments</span> in dev, uat and prod,
                with its health, workloads and map in one place.
              </p>
              <button type="button" onClick={() => setCreating(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
                <Plus className="h-3.5 w-3.5" />Create your first project
              </button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {projects.map((p) => <ProjectCard key={p.id} project={p} onOpen={() => navigate(`/projects/${p.id}`)} />)}
            </div>
          )}
        </div>
      </main>
      <ProjectDialog open={creating} onClose={() => setCreating(false)} defaultScope={{ context, namespace }} onSaved={(p) => navigate(`/projects/${p.id}`)} />
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const data = useAcrossScopes(project.scopes);
  const h = healthOf(data.flatMap((d) => d.pods ?? []), data.flatMap((d) => d.deployments ?? []));
  const loading = data.some((d) => d.loading);
  const problems = h.failing + h.degraded;
  const clusters = new Set(project.scopes.map((s) => s.context)).size;
  return (
    <button type="button" onClick={onOpen} className="card-elevated group flex flex-col gap-2 p-4 text-left transition-colors hover:border-primary/40">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", loading ? "bg-muted-foreground/40" : problems ? "bg-destructive" : "bg-success")} />
        <span className="truncate font-semibold text-foreground group-hover:text-primary">{project.name}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{project.scopes.length} ns · {clusters} cluster{clusters === 1 ? "" : "s"}</span>
      </div>
      {project.description && <p className="line-clamp-2 text-xs text-muted-foreground">{project.description}</p>}
      <p className="text-xs tabular-nums text-muted-foreground">
        {loading ? "Checking…" : <>{h.deployments} deployments · {h.pods} pods{problems ? <span className="text-destructive"> · {problems} need attention</span> : " · all healthy"}</>}
      </p>
      <div className="flex flex-wrap gap-1">
        {project.scopes.slice(0, 6).map((s) => (
          <span key={`${s.context}/${s.namespace}`} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{s.context}/{s.namespace}</span>
        ))}
        {project.scopes.length > 6 && <span className="text-[10px] text-muted-foreground">+{project.scopes.length - 6}</span>}
      </div>
    </button>
  );
}
