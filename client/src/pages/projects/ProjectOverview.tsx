/** A project's overview: each place it runs with its health, then what needs attention, one row per workload. */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { healthOf, problemsByWorkload, scopeKey, type Scope, type ScopeLists, type WorkloadProblem } from "./project-health";

export type ScopeData = ScopeLists & { loading: boolean; error?: string };

export const detailHref = (type: string, name: string, s: Scope) =>
  `/resource/${type}/${encodeURIComponent(name)}?context=${encodeURIComponent(s.context)}&namespace=${encodeURIComponent(s.namespace)}`;

/** "dev" over "shop": where a scope is, in two lines. */
export function ScopeLabel({ scope, className }: { scope: Scope; className?: string }) {
  return (
    <span className={cn("min-w-0", className)}>
      <span className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground">{scope.context}</span>
      <span className="block truncate font-mono text-sm font-medium">{scope.namespace}</span>
    </span>
  );
}

function ScopeCard({ d, on, onToggle }: { d: ScopeData; on: boolean; onToggle: () => void }) {
  const h = healthOf(d.pods, d.deployments);
  const ready = h.deployments - h.degraded;
  const pct = h.deployments ? (ready / h.deployments) * 100 : 100;
  const state = d.loading ? "loading" : d.error ? "error" : h.degraded || h.failing ? "bad" : "ok";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      title={on ? "Show every place" : "Show only this place's problems"}
      className={cn(
        "flex min-w-0 flex-col gap-2.5 rounded-xl border bg-card p-3.5 text-left hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-primary ring-1 ring-primary/30" : "border-border",
      )}
    >
      <div className="flex w-full items-start gap-2">
        <ScopeLabel scope={d.scope} className="flex-1" />
        <span aria-hidden className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", state === "ok" ? "bg-success" : state === "bad" ? "bg-destructive" : state === "error" ? "bg-warning" : "bg-muted-foreground/40")} />
      </div>
      {state === "loading" ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking…</p>
      ) : state === "error" ? (
        <p className="line-clamp-2 text-xs text-warning">{d.error}</p>
      ) : (
        <>
          <div aria-hidden className="flex h-1.5 w-full overflow-hidden rounded-full bg-destructive/25">
            <span className="bg-success" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{ready}/{h.deployments}</span> ready · {h.pods} pods
            {h.failing > 0 && <span className="text-destructive"> · {h.failing} failing</span>}
          </p>
        </>
      )}
    </button>
  );
}

function ProblemRow({ w, only }: { w: WorkloadProblem; only: string | null }) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const places = only ? w.places.filter((p) => scopeKey(p.scope) === only) : w.places;
  const reasons = [...new Set(places.map((p) => p.reason))];
  const pods = places.reduce((n, p) => n + p.pods.length, 0);
  return (
    <li>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5 px-4 py-2.5 text-left hover:bg-muted/40 md:grid-cols-[1rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)] md:items-center">
        <ChevronRight aria-hidden className={cn("mt-0.5 h-4 w-4 text-muted-foreground md:mt-0", open && "rotate-90")} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{w.name}</span>
          <span className="block text-[11px] text-muted-foreground">{w.kind}{pods ? ` · ${pods} failing ${pods === 1 ? "pod" : "pods"}` : ""}</span>
        </span>
        <span className="col-start-2 flex min-w-0 flex-wrap gap-1 md:col-start-auto">
          {reasons.map((r) => <span key={r} className="truncate rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">{r}</span>)}
        </span>
        <span className="col-start-2 flex min-w-0 flex-wrap gap-1 md:col-start-auto">
          {places.map((p) => <span key={scopeKey(p.scope)} className="truncate rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 font-mono text-[11px]">{scopeKey(p.scope)}</span>)}
        </span>
      </button>
      {open && (
        <ul className="space-y-1 border-t border-border/50 bg-muted/20 py-2 pl-10 pr-4">
          {places.map((p) => (
            <li key={scopeKey(p.scope)} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="w-40 shrink-0 truncate font-mono text-muted-foreground">{scopeKey(p.scope)}</span>
              {w.kind === "Deployment" && (
                <button type="button" onClick={() => navigate(detailHref("deployment", w.name, p.scope))} className="font-medium text-primary hover:underline">
                  deployment{p.ready ? ` (${p.ready} ready)` : ""}
                </button>
              )}
              {p.pods.map((name) => (
                <button key={name} type="button" onClick={() => navigate(detailHref("pod", name, p.scope))} className="font-mono text-foreground/80 hover:text-primary hover:underline">{name}</button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ProjectOverview({ data }: { data: ScopeData[] }) {
  const [only, setOnly] = useState<string | null>(null);
  const problems = useMemo(() => problemsByWorkload(data), [data]);
  const shown = only ? problems.filter((w) => w.places.some((p) => scopeKey(p.scope) === only)) : problems;
  const loading = data.some((d) => d.loading);

  return (
    <div className="space-y-5">
      <section aria-label="Where it runs" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {data.map((d) => <ScopeCard key={scopeKey(d.scope)} d={d} on={only === scopeKey(d.scope)} onToggle={() => setOnly((o) => (o === scopeKey(d.scope) ? null : scopeKey(d.scope)))} />)}
      </section>

      <section aria-label="Needs attention" className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <AlertTriangle className={cn("h-4 w-4", shown.length ? "text-destructive" : "text-muted-foreground")} aria-hidden />
          <h2 className="text-sm font-semibold">Needs attention</h2>
          <span className="text-xs tabular-nums text-muted-foreground">{shown.length} {shown.length === 1 ? "workload" : "workloads"}</span>
          {only && (
            <button type="button" onClick={() => setOnly(null)} className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary">
              {only} <X className="h-3 w-3" aria-label="Show every place" />
            </button>
          )}
        </header>
        {shown.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</> : <><CheckCircle2 className="h-4 w-4 text-success" /> Everything {only ? `in ${only}` : "in this project"} is healthy.</>}
          </p>
        ) : (
          <>
            <div aria-hidden className="hidden grid-cols-[1rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)] gap-x-2 border-b border-border/60 bg-muted/30 px-4 py-1.5 text-[11px] font-medium text-muted-foreground md:grid">
              <span /><span>Workload</span><span>Problem</span><span>Where</span>
            </div>
            <ul className="divide-y divide-border/50">{shown.map((w) => <ProblemRow key={w.name} w={w} only={only} />)}</ul>
          </>
        )}
      </section>
    </div>
  );
}
