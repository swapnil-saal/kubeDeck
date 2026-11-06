import { useMemo, useState, type FC } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle, ArrowUpRight, Box, CalendarClock, Database, FileText, Globe, HardDrive, KeyRound, Layers, Loader2,
  Network, Route, Search, Split, Workflow, X, type LucideIcon,
} from "lucide-react";
import type { MapNode } from "@shared/routes";
import { AppHeader } from "@/components/AppHeader";
import { OverviewViews } from "@/components/OverviewViews";
import { LiveRefresh } from "@/components/LiveRefresh";
import { useK8sNamespaces, useNamespaceMap } from "@/hooks/use-k8s";
import { useHashParams } from "@/hooks/use-hash-params";
import { useScopeFromUrl } from "@/hooks/use-scope-from-url";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { adjacency, chainOf, layout, MAP, type Placed } from "@/lib/map-layout";
import { cn } from "@/lib/utils";

const ICON: Record<string, LucideIcon> = {
  Ingress: Globe, HTTPRoute: Route, GRPCRoute: Split, Service: Network, Deployment: Layers, StatefulSet: Database, DaemonSet: Layers, CronJob: CalendarClock,
  Job: CalendarClock, Pod: Box, ConfigMap: FileText, Secret: KeyRound, PersistentVolumeClaim: HardDrive,
};
const COLUMN_TITLE = ["Ingress & routes", "Services", "Workloads", "Config & storage"];
const TONE_DOT = { good: "bg-success", warn: "bg-warning", bad: "bg-destructive", neutral: "bg-muted-foreground/40" } as const;
const TONE_RING = { good: "", warn: "border-warning/50", bad: "border-destructive/60", neutral: "" } as const;

/** `/map` — the selected namespace as a graph: what routes to what, what runs, and what it reads. */
/** One namespace's map with its search and filters; used by the Map page and by projects. */
export function MapView({ context, namespace }: { context: string; namespace: string }) {
  const [, navigate] = useLocation();
  const { get, set } = useHashParams();
  const q = (get("q") || "").trim().toLowerCase();
  const problemsOnly = get("problems") === "1";
  const hideConfig = get("config") === "0";
  const [focus, setFocus] = useState<string | null>(null);
  const map = useNamespaceMap(context, namespace);

  const adj = useMemo(() => adjacency(map.data ?? { edges: [] }), [map.data]);

  // what is drawn: search and "problems only" keep the matching nodes plus their chains
  const visible = useMemo(() => {
    const all = (map.data?.nodes ?? []).filter((n) => !(hideConfig && n.column === 3));
    const seeds = all.filter((n) => (!q || n.name.toLowerCase().includes(q) || n.kind.toLowerCase().includes(q)) && (!problemsOnly || n.tone === "bad" || n.tone === "warn"));
    if (!q && !problemsOnly) return all;
    const keep = new Set<string>();
    for (const s of seeds) chainOf(s.id, adj).forEach((id) => keep.add(id));
    return all.filter((n) => keep.has(n.id));
  }, [map.data, q, problemsOnly, hideConfig, adj]);

  const shownIds = useMemo(() => new Set(visible.map((n) => n.id)), [visible]);
  const edges = useMemo(() => (map.data?.edges ?? []).filter((e) => shownIds.has(e.from) && shownIds.has(e.to)), [map.data, shownIds]);
  const { placed, columns, width, height } = useMemo(() => layout(visible, edges), [visible, edges]);
  const pos = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const lit = useMemo(() => (focus && shownIds.has(focus) ? chainOf(focus, adj) : null), [focus, adj, shownIds]);
  const problems = (map.data?.nodes ?? []).filter((n) => n.tone === "bad" || n.tone === "warn").length;

  const open = (n: MapNode) => navigate(`/resource/${n.type}/${encodeURIComponent(n.name)}?context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(namespace)}`);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {map.data && (
        <div className="flex flex-wrap items-center gap-2 px-5 pt-3 sm:px-7">
          <label className="focus-frame flex h-8 w-64 max-w-full items-center gap-2 rounded-lg border border-border bg-secondary/50 px-2.5 focus-within:border-primary/40">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input value={get("q") || ""} onChange={(e) => set("q", e.target.value || null)} placeholder="Find a resource…" aria-label="Find a resource on the map" className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70" />
          </label>
          <Toggle on={problemsOnly} onClick={() => set("problems", problemsOnly ? null : "1")} icon={AlertTriangle}>
            Problems{problems ? ` ${problems}` : ""}
          </Toggle>
          <Toggle on={!hideConfig} onClick={() => set("config", hideConfig ? null : "0")} icon={FileText}>Config & storage</Toggle>
          <span className="ml-auto hidden text-[11px] text-muted-foreground lg:inline">Click to follow connections · double-click to open</span>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-auto" onClick={() => setFocus(null)}>
        {map.isLoading ? (
          <p className="flex items-center gap-2 px-7 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Reading {namespace}…</p>
        ) : map.isError ? (
          <p className="px-7 py-10 text-sm text-destructive">{map.error?.message}</p>
        ) : (
          <div className="p-5 sm:px-7">
            {map.data && map.data.missing.length > 0 && (
              <p className="mb-3 text-xs text-muted-foreground">Not shown (no permission to read): {map.data.missing.join(", ")}.</p>
            )}
            {placed.length === 0 ? (
              <p className="py-10 text-sm text-muted-foreground">{q || problemsOnly ? "Nothing matches." : "This namespace is empty."}</p>
            ) : (
              <div className="relative" style={{ width, height }}>
                {columns.map((c) => (
                  <h2 key={c.column} className="absolute top-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground" style={{ left: c.x, width: MAP.colW }}>
                    {COLUMN_TITLE[c.column]} <span className="font-normal tabular-nums">{c.count}</span>
                  </h2>
                ))}
                <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden>
                  {edges.map((e) => {
                    const a = pos.get(e.from)!;
                    const b = pos.get(e.to)!;
                    const x1 = a.x + MAP.colW, y1 = a.y + MAP.nodeH / 2, x2 = b.x, y2 = b.y + MAP.nodeH / 2;
                    const mid = (x1 + x2) / 2;
                    const on = !lit || (lit.has(e.from) && lit.has(e.to));
                    return (
                      <path
                        key={`${e.from}>${e.to}`}
                        d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                        fill="none"
                        className={cn("transition-opacity", lit && on ? "stroke-primary" : "stroke-muted-foreground")}
                        strokeWidth={lit && on ? 1.6 : 1}
                        // quiet until something is followed: hundreds of edges should read as texture, not a wall
                        opacity={lit ? (on ? 1 : 0.06) : 0.22}
                      />
                    );
                  })}
                </svg>
                {placed.map((n) => (
                  <MapCard key={n.id} node={n} dim={!!lit && !lit.has(n.id)} focused={focus === n.id} onFocus={() => setFocus(focus === n.id ? null : n.id)} onOpen={() => open(n)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** `/map` — the selected namespace as a graph: what routes to what, what runs, and what it reads. */
export default function MapPage() {
  useScopeFromUrl();
  const { context, namespace, setNamespace } = useTerminalStore();
  const namespaces = useK8sNamespaces(namespace === "all" ? context : undefined);

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <AppHeader breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Map" }]} rightSlot={<><OverviewViews /><LiveRefresh /></>} />
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-2.5 sm:px-7">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Workflow className="h-4 w-4" /></span>
        <h1 className="text-lg font-bold tracking-tight">Map</h1>
        <span className="text-xs text-muted-foreground">{context || "…"} · {namespace === "all" ? "pick a namespace" : namespace}</span>
      </div>
      {namespace === "all" ? (
        <div className="mx-auto max-w-2xl px-6 py-12 text-center">
          <Workflow className="mx-auto mb-3 h-8 w-8 text-primary" />
          <p className="text-sm font-medium">The map shows one namespace at a time.</p>
          <p className="mt-1 text-xs text-muted-foreground">Every namespace at once would be unreadable. Pick one:</p>
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {(namespaces.data ?? []).map((ns) => (
              <button key={ns.name} type="button" onClick={() => setNamespace(ns.name)} className="rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                {ns.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <MapView context={context} namespace={namespace} />
      )}
    </div>
  );
}

const Toggle: FC<{ on: boolean; onClick: () => void; icon: LucideIcon; children: React.ReactNode }> = ({ on, onClick, icon: Icon, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    className={cn(
      "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
      on ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
    )}
  >
    <Icon className="h-3.5 w-3.5" />{children}
  </button>
);

const MapCard: FC<{ node: Placed; dim: boolean; focused: boolean; onFocus: () => void; onOpen: () => void }> = ({ node: n, dim, focused, onFocus, onOpen }) => {
  const Icon = ICON[n.kind] ?? Box;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onFocus(); }}
      onDoubleClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); else if (e.key === " ") { e.preventDefault(); onFocus(); } }}
      title={`${n.kind} ${n.name}${n.detail ? ` · ${n.detail}` : ""}${n.badge ? ` · ${n.badge}` : ""}\nClick to follow its connections, double-click to open`}
      className={cn(
        "group absolute flex items-center gap-2 rounded-lg border bg-card px-2.5 text-left shadow-sm transition-[opacity,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        TONE_RING[n.tone] || "border-border",
        focused && "border-primary shadow-md ring-2 ring-primary/20",
        dim && "opacity-25",
      )}
      style={{ left: n.x, top: n.y, width: MAP.colW, height: MAP.nodeH }}
    >
      <span className="relative shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className={cn("absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-card", TONE_DOT[n.tone])} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium leading-tight text-foreground">{n.name}</span>
        <span className="block truncate text-[10.5px] leading-tight text-muted-foreground">
          {n.badge ? <span className={n.tone === "bad" ? "text-destructive" : n.tone === "warn" ? "text-warning" : "text-primary"}>{n.badge}</span> : (n.detail || n.kind)}
        </span>
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        aria-label={`Open ${n.kind} ${n.name}`}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
      >
        <ArrowUpRight className="h-3.5 w-3.5" />
      </button>
      {focused && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onFocus(); }} aria-label="Stop following" className="absolute -right-2 -top-2 rounded-full border border-border bg-card p-0.5 text-muted-foreground hover:text-foreground">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};
