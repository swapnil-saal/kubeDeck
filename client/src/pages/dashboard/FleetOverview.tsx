import { useEffect, useRef, useState, type FC } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Lock, RefreshCw, ServerCrash } from "lucide-react";
import { ScoreRing } from "@/components/health/ScoreRing";
import { useClusterSummary } from "@/hooks/use-cluster-extras";
import { rememberedNamespace } from "@/lib/terminal-store";
import { summaryScore } from "@/lib/cluster-health";
import { cn } from "@/lib/utils";

const OPEN_KEY = "kubedeck-fleet-open";

function readOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; }
}

const ContextCard: FC<{
  name: string;
  isCurrent: boolean;
  enabled: boolean;
  onOpen: () => void;
  onSettled: () => void;
}> = ({ name, isCurrent, enabled, onOpen, onSettled }) => {
  const ns = rememberedNamespace(name) || "all";
  const q = useClusterSummary(name, ns, enabled);
  const settled = useRef(false);
  useEffect(() => {
    if (enabled && !q.isLoading && !settled.current) {
      settled.current = true;
      onSettled();
    }
  }, [enabled, q.isLoading, onSettled]);

  const s = q.data;
  const score = s && !s.error ? summaryScore(s) : null;
  const waiting = !enabled || q.isLoading;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-card/50 p-3 text-left transition-colors hover:border-primary/40 hover:bg-card",
        isCurrent ? "border-primary/40" : "border-border/60",
      )}
      aria-label={`Open cluster ${name}`}
    >
      {waiting ? (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
          {enabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-xs">…</span>}
        </div>
      ) : s?.error === "unreachable" ? (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"><ServerCrash className="h-4 w-4" /></div>
      ) : s?.error === "forbidden" ? (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-500"><Lock className="h-4 w-4" /></div>
      ) : (
        <ScoreRing score={score} size={44} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{name}</span>
          {isCurrent && <span className="shrink-0 rounded bg-primary/10 px-1.5 py-px text-[9px] font-semibold uppercase text-primary">viewing</span>}
        </div>
        <p className="truncate font-mono text-[11px] text-muted-foreground">{ns === "all" ? "all namespaces" : ns}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {waiting ? "Checking…"
            : s?.error === "unreachable" ? "Unreachable — VPN or network?"
            : s?.error === "forbidden" ? "Restricted — open to pick a namespace"
            : s?.error ? s.message ?? "Couldn't read this cluster"
            : s?.pods ? `${s.pods.running}/${s.pods.total} pods${s.pods.failing > 0 ? ` · ${s.pods.failing} failing` : ""}${s.deployments ? ` · ${s.deployments.ready}/${s.deployments.total} deploys` : ""}` : ""}
        </p>
      </div>
    </button>
  );
};

/**
 * Every cluster in your kubeconfig at a glance. Collapsed by default and loaded gently (two at a
 * time) because each card costs a few kubectl calls against that cluster.
 */
export const FleetOverview: FC<{
  contexts: { name: string; isCurrent: boolean }[];
  currentContext: string;
  onOpen: (context: string) => void;
}> = ({ contexts, currentContext, onOpen }) => {
  const [open, setOpen] = useState(readOpen);
  const [allowed, setAllowed] = useState(2);
  const qc = useQueryClient();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };

  if (contexts.length < 2) return null;

  return (
    <section className="rounded-xl border border-border/60 bg-card/30">
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={toggle} aria-expanded={open} className="flex items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">All clusters</span>
          <span className="text-[11px] text-muted-foreground">{contexts.length}</span>
        </button>
        {open && (
          <button
            type="button"
            onClick={() => { setAllowed(2); qc.invalidateQueries({ queryKey: ["clusterSummary"] }); }}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />Refresh
          </button>
        )}
      </div>
      {open && (
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
          {contexts.map((c, i) => (
            <ContextCard
              key={c.name}
              name={c.name}
              isCurrent={c.name === currentContext}
              enabled={i < allowed}
              onOpen={() => onOpen(c.name)}
              onSettled={() => setAllowed((a) => a + 1)}
            />
          ))}
        </div>
      )}
    </section>
  );
};
