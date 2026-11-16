/** Every deployment of a project against every place it runs: readiness and image tag, with what differs marked. */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { compareDeployments, scopeKey, type CompareRow } from "./project-health";
import { detailHref, type ScopeData } from "./ProjectOverview";

type Filter = "all" | "differs" | "unhealthy";

export function ProjectCompare({ data }: { data: ScopeData[] }) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo(() => compareDeployments(data), [data]);
  const counts = { all: rows.length, differs: rows.filter((r) => r.drift || r.missing).length, unhealthy: rows.filter((r) => r.degraded).length };
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (filter === "all" || (filter === "differs" ? r.drift || r.missing : r.degraded)) && (!q || r.name.includes(q)));
  const filters: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, { id: "differs", label: "Differ" }, { id: "unhealthy", label: "Unhealthy" }];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a deployment" aria-label="Find a deployment" className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2.5 text-sm outline-none focus:border-primary/50" />
        </label>
        <div role="tablist" aria-label="Show" className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
          {filters.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium", filter === f.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {f.label}<span className="tabular-nums text-muted-foreground">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        <span className="font-medium text-amber-700 dark:text-amber-300">Amber tag</span>: a different image version than elsewhere ·
        <span className="font-medium"> —</span>: not deployed there · <span className="font-medium text-destructive">red</span>: not ready
      </p>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-left text-[11px] text-muted-foreground">
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-[14rem] bg-muted/30 px-4 py-2 font-medium">Deployment</th>
              {data.map((d) => (
                <th key={scopeKey(d.scope)} scope="col" className="min-w-[8rem] px-3 py-2 font-medium">
                  <span className="block text-[10px] uppercase tracking-wide">{d.scope.context}</span>
                  <span className="block font-mono text-foreground">{d.scope.namespace}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {shown.map((r) => <Row key={r.name} row={r} data={data} onOpen={(i) => navigate(detailHref("deployment", r.name, data[i].scope))} />)}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {data.some((d) => d.loading) ? "Loading…" : filter === "differs" ? "Every deployment runs the same version everywhere." : filter === "unhealthy" ? "Every deployment is ready." : "No deployments."}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ row, data, onOpen }: { row: CompareRow; data: ScopeData[]; onOpen: (i: number) => void }) {
  // the version most places run; a cell with another one is the drift
  const common = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of Object.values(row.cells)) n.set(c.tags.join(","), (n.get(c.tags.join(",")) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }, [row]);
  return (
    <tr className="hover:bg-muted/30">
      <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-normal">
        <span className="block truncate text-sm font-medium">{row.name}</span>
        <span className="flex gap-1">
          {row.drift && <span className="rounded bg-amber-500/10 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">versions differ</span>}
          {row.missing && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">not everywhere</span>}
        </span>
      </th>
      {data.map((d, i) => {
        const c = row.cells[scopeKey(d.scope)];
        if (!c) return <td key={scopeKey(d.scope)} className="px-3 py-2 text-muted-foreground/60">{d.loading ? "…" : "—"}</td>;
        const differs = row.drift && c.tags.join(",") !== common;
        return (
          <td key={scopeKey(d.scope)} className="px-3 py-2">
            <button type="button" onClick={() => onOpen(i)} className="block max-w-[11rem] text-left hover:underline">
              <span className={cn("block tabular-nums font-medium", c.degraded ? "text-destructive" : "text-success")}>{c.ready}</span>
              <span title={c.tags.join(", ")} className={cn("block truncate font-mono text-[11px]", differs ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{c.tags.join(", ") || "—"}</span>
            </button>
          </td>
        );
      })}
    </tr>
  );
}
