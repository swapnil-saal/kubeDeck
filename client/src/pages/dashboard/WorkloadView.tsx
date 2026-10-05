import { useMemo, useState, type FC } from "react";
import { ChevronDown, ChevronRight, Pin, RotateCw, Scaling, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { parseCpuMilli, type UsageLike } from "@/lib/cluster-health";
import { cn } from "@/lib/utils";

export interface WorkloadPod {
  name: string;
  namespace: string;
  status: string;
  restarts: number;
  ready?: string;
  age: string;
  node?: string;
  cpu?: string;
  workload?: { kind: string; name: string };
}

export interface Workload {
  key: string;
  kind: string;
  name: string;
  namespace: string;
  pods: WorkloadPod[];
  readyPods: number;
  restarts: number;
  failing: number;
  cpuMilli: number;
  newest: number;
}

const FAILING = new Set(["CrashLoopBackOff", "Error", "ImagePullBackOff", "ErrImagePull", "OOMKilled", "CreateContainerConfigError", "InvalidImageName", "Failed", "Evicted", "RunContainerError"]);
const PENDING = /^(Pending|ContainerCreating|PodInitializing|Init:.*|Terminating)$/;

const ROUTE_TYPE: Record<string, string> = { Deployment: "deployment", StatefulSet: "statefulset", DaemonSet: "daemonset", Job: "job", CronJob: "cronjob" };

function podOk(p: WorkloadPod): boolean {
  if (p.status === "Completed" || p.status === "Succeeded") return true;
  if (p.status !== "Running") return false;
  const m = p.ready?.match(/^(\d+)\/(\d+)$/);
  return !m || Number(m[1]) >= Number(m[2]);
}

/** Groups pods under their owning workload. Problem workloads sort first, then restart-heavy ones. */
export function groupWorkloads(pods: WorkloadPod[], usage: Map<string, UsageLike>): Workload[] {
  const map = new Map<string, Workload>();
  for (const p of pods) {
    const kind = p.workload?.kind ?? "Pod";
    const name = p.workload?.name ?? p.name;
    const key = `${p.namespace}/${kind}/${name}`;
    const w = map.get(key) ?? { key, kind, name, namespace: p.namespace, pods: [], readyPods: 0, restarts: 0, failing: 0, cpuMilli: 0, newest: 0 };
    w.pods.push(p);
    if (podOk(p)) w.readyPods++;
    if (FAILING.has(p.status)) w.failing++;
    w.restarts += p.restarts;
    const u = usage.get(`${p.namespace}/${p.name}`) ?? usage.get(p.name);
    w.cpuMilli += u ? u.cpuMilli : usage.size === 0 ? parseCpuMilli(p.cpu) : 0;
    w.newest = Math.max(w.newest, Date.parse(p.age) || 0);
    map.set(key, w);
  }
  return Array.from(map.values()).sort((a, b) => {
    const bad = (w: Workload) => (w.failing > 0 ? 2 : w.readyPods < w.pods.length ? 1 : 0);
    return bad(b) - bad(a) || b.restarts - a.restarts || a.name.localeCompare(b.name);
  });
}

export const restartTone = (n: number) =>
  n >= 20 ? "text-destructive font-bold" : n >= 5 ? "text-amber-500 font-semibold" : n > 0 ? "text-foreground" : "text-muted-foreground";

const Chip: FC<{ status: string }> = ({ status }) => (
  <span className={cn(
    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
    FAILING.has(status) ? "bg-destructive/10 text-destructive" : PENDING.test(status) ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  )}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" />{status}
  </span>
);

export interface WorkloadViewProps {
  pods: WorkloadPod[];
  usage: UsageLike[] | undefined;
  showNamespace: boolean;
  isPinned: (type: string, name: string, ns: string) => boolean;
  onOpen: (type: string, name: string, ns: string) => void;
  onPin: (type: string, name: string, ns: string) => void;
  onAsk: (prompt: string) => void;
  onScale: (name: string, current: number) => void;
  onRestart: (name: string) => void;
}

/** Pods grouped under the Deployment / StatefulSet / … that owns them. */
export const WorkloadView: FC<WorkloadViewProps> = ({ pods, usage, showNamespace, isPinned, onOpen, onPin, onAsk, onScale, onRestart }) => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const usageMap = useMemo(() => new Map((usage ?? []).map((u) => [u.namespace ? `${u.namespace}/${u.name}` : u.name, u])), [usage]);
  const groups = useMemo(() => groupWorkloads(pods, usageMap), [pods, usageMap]);

  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const age = (ms: number) => (ms ? formatDistanceToNow(ms).replace("about ", "~") : "");

  if (groups.length === 0) return <p className="px-4 py-10 text-center text-sm text-muted-foreground">No pods in this scope.</p>;

  return (
    <ul className="divide-y divide-border/50" aria-label="Workloads">
      {groups.map((w) => {
        const expanded = open.has(w.key);
        const type = ROUTE_TYPE[w.kind] ?? "pod";
        const healthy = w.readyPods === w.pods.length && w.failing === 0;
        const pinned = isPinned(type, w.name, w.namespace);
        return (
          <li key={w.key}>
            <div className={cn("group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40", !healthy && "bg-amber-500/[0.04]")}>
              <button type="button" onClick={() => toggle(w.key)} aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${w.name}`} className="text-muted-foreground hover:text-foreground">
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              <span className="w-14 shrink-0 rounded bg-muted px-1.5 py-0.5 text-center text-[9px] font-semibold uppercase text-muted-foreground">{w.kind === "Deployment" ? "deploy" : w.kind.slice(0, 6)}</span>
              <button type="button" onClick={() => onOpen(type, w.name, w.namespace)} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground/90 hover:text-foreground hover:underline underline-offset-2">
                {w.name}
                {showNamespace && <span className="ml-2 text-[10px] font-normal text-muted-foreground">{w.namespace}</span>}
              </button>
              <span className={cn("hidden shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-bold tabular-nums sm:inline", healthy ? "border-foreground/10 bg-foreground/5 text-foreground/70" : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400")} title="Pods ready">
                {w.readyPods}/{w.pods.length}
              </span>
              <span className={cn("hidden w-14 shrink-0 text-right text-xs tabular-nums md:inline", restartTone(w.restarts))} title="Restarts across pods">{w.restarts}↻</span>
              <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground lg:inline" title={usage ? "CPU in use" : "CPU requested"}>{w.cpuMilli > 0 ? `${Math.round(w.cpuMilli)}m` : "–"}</span>
              <span className="hidden w-12 shrink-0 text-right text-[11px] text-muted-foreground lg:inline">{age(w.newest)}</span>
              <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button type="button" title="Diagnose with AI" aria-label={`Diagnose ${w.name} with AI`} onClick={() => onAsk(`Diagnose ${w.kind.toLowerCase()} ${w.name} in namespace ${w.namespace}: ${w.pods.length} pods, ${w.readyPods} ready, ${w.restarts} restarts. Check pod status, recent logs and events and tell me if anything is wrong.`)} className="rounded p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"><Sparkles className="h-3.5 w-3.5" /></button>
                <button type="button" title={pinned ? "Unpin" : "Pin"} aria-label={pinned ? `Unpin ${w.name}` : `Pin ${w.name}`} aria-pressed={pinned} onClick={() => onPin(type, w.name, w.namespace)} className={cn("rounded p-1.5 hover:bg-muted", pinned ? "text-primary" : "text-muted-foreground hover:text-foreground")}><Pin className="h-3.5 w-3.5" /></button>
                {w.kind === "Deployment" && (
                  <>
                    <button type="button" title="Scale" aria-label={`Scale ${w.name}`} onClick={() => onScale(w.name, w.pods.length)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Scaling className="h-3.5 w-3.5" /></button>
                    <button type="button" title="Rolling restart" aria-label={`Restart ${w.name}`} onClick={() => onRestart(w.name)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><RotateCw className="h-3.5 w-3.5" /></button>
                  </>
                )}
              </div>
            </div>
            {expanded && (
              <ul className="bg-background/40 pb-1" aria-label={`Pods of ${w.name}`}>
                {w.pods.map((p) => (
                  <li key={p.name} className="flex items-center gap-3 py-1.5 pl-[4.75rem] pr-4 text-xs hover:bg-muted/30">
                    <button type="button" onClick={() => onOpen("pod", p.name, p.namespace)} className="min-w-0 flex-1 truncate text-left font-mono text-foreground/80 hover:text-foreground hover:underline underline-offset-2">{p.name}</button>
                    <Chip status={p.status} />
                    <span className={cn("w-12 shrink-0 text-right tabular-nums", restartTone(p.restarts))}>{p.restarts}↻</span>
                    <span className="hidden w-40 shrink-0 truncate text-[11px] text-muted-foreground lg:inline" title={p.node}>{p.node}</span>
                    <span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground">{age(Date.parse(p.age))}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
};
