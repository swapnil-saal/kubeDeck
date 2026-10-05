import type { FC, ReactNode } from "react";
import { ChevronRight, Globe, Layers, Network, Box, Sparkles } from "lucide-react";
import type { RelatedResources } from "@shared/routes";
import { cn } from "@/lib/utils";

interface Node {
  key: string;
  type: string;
  name: string;
  namespace: string;
  sub?: ReactNode;
  tone: "good" | "warn" | "bad" | "neutral";
  current?: boolean;
}

const WORKLOAD_TYPES = new Set(["deployment", "statefulset", "daemonset"]);
const BAD_POD = /^(CrashLoopBackOff|Error|ImagePullBackOff|ErrImagePull|OOMKilled|CreateContainerConfigError|InvalidImageName|Failed|Evicted)$/;
const WAIT_POD = /^(Pending|ContainerCreating|PodInitializing|Init:.*|Terminating)$/;

const TONE_DOT = { good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-destructive", neutral: "bg-muted-foreground/50" } as const;

export function podTone(status: string): Node["tone"] {
  return BAD_POD.test(status) ? "bad" : WAIT_POD.test(status) ? "warn" : status === "Running" || status === "Completed" || status === "Succeeded" ? "good" : "neutral";
}

export function readyTone(ready: string): Node["tone"] {
  const [c, t] = ready.split("/").map(Number);
  if (!Number.isFinite(c) || !Number.isFinite(t)) return "neutral";
  return t === 0 ? "neutral" : c >= t ? "good" : c === 0 ? "bad" : "warn";
}

/** Builds the four columns of the traffic path, always including the resource being viewed. */
export function buildColumns(type: string, name: string, namespace: string, related: RelatedResources | undefined) {
  const here = (t: string) => type === t;
  const cur = (n: Node): Node => ({ ...n, current: n.type === type && n.name === name });

  const ingress: Node[] = (related?.ingresses ?? []).map((i) => cur({ key: `i/${i.name}`, type: "ingress", name: i.name, namespace: i.namespace, sub: i.hosts, tone: "neutral" }));
  const service: Node[] = (related?.services ?? []).map((s) => cur({ key: `s/${s.name}`, type: "service", name: s.name, namespace: s.namespace, sub: `${s.type}${s.ports ? ` · ${s.ports}` : ""}`, tone: "neutral" }));
  const workload: Node[] = (related?.deployments ?? []).map((d) => cur({ key: `d/${d.name}`, type: "deployment", name: d.name, namespace: d.namespace, sub: `${d.ready} ready`, tone: readyTone(d.ready) }));
  const pods: Node[] = (related?.pods ?? []).map((p) => cur({ key: `p/${p.name}`, type: "pod", name: p.name, namespace: p.namespace, sub: `${p.status}${p.restarts > 0 ? ` · ${p.restarts}↻` : ""}`, tone: podTone(p.status) }));

  const ensure = (list: Node[], t: string, tone: Node["tone"] = "neutral") => {
    if (!list.some((n) => n.type === t && n.name === name)) list.unshift({ key: `${t}/${name}`, type: t, name, namespace, tone, current: true });
  };
  // The API does not return the resource being viewed; a workload takes its colour from its pods.
  const podsTone: Node["tone"] = pods.some((p) => p.tone === "bad") ? "bad" : pods.some((p) => p.tone === "warn") ? "warn" : pods.length > 0 ? "good" : "neutral";
  if (here("ingress")) ensure(ingress, "ingress");
  else if (here("service")) ensure(service, "service");
  else if (WORKLOAD_TYPES.has(type)) ensure(workload, type, podsTone);
  else if (here("pod")) ensure(pods, "pod");

  return [
    { key: "ingress", label: "Ingress", icon: Globe, nodes: ingress },
    { key: "service", label: "Service", icon: Network, nodes: service },
    { key: "workload", label: "Workload", icon: Layers, nodes: workload },
    { key: "pod", label: "Pods", icon: Box, nodes: pods },
  ].filter((c) => c.nodes.length > 0);
}

const NodeCard: FC<{ node: Node; onOpen: () => void }> = ({ node, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    disabled={node.current}
    aria-current={node.current ? "true" : undefined}
    className={cn(
      "group w-full rounded-lg border bg-card/60 p-2.5 text-left transition-colors",
      node.current ? "border-primary/60 ring-1 ring-primary/30" : "border-border hover:border-primary/40 hover:bg-card",
    )}
  >
    <div className="flex items-center gap-2">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE_DOT[node.tone])} />
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" title={node.name}>{node.name}</code>
      {node.current && <span className="shrink-0 rounded bg-primary/10 px-1 py-px text-[9px] font-semibold uppercase text-primary">here</span>}
    </div>
    {node.sub && <p className="mt-1 truncate pl-4 text-[10px] text-muted-foreground" title={typeof node.sub === "string" ? node.sub : undefined}>{node.sub}</p>}
  </button>
);

/**
 * The path a request takes — Ingress → Service → Workload → Pods — with live status on every hop,
 * built from the related-resources API. The resource you are viewing is marked "here".
 */
export const Topology: FC<{
  type: string;
  name: string;
  namespace: string;
  related: RelatedResources | undefined;
  onNavigate: (type: string, name: string, ns: string) => void;
  onAsk?: (prompt: string) => void;
}> = ({ type, name, namespace, related, onNavigate, onAsk }) => {
  const columns = buildColumns(type, name, namespace, related);
  const all = columns.flatMap((c) => c.nodes);
  const unhealthy = all.filter((n) => n.tone === "bad" || n.tone === "warn").length;

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Traffic path</h3>
        <span className="text-[11px] text-muted-foreground">
          {all.length} resource{all.length === 1 ? "" : "s"}
          {unhealthy > 0 ? <span className="text-amber-500"> · {unhealthy} not healthy</span> : all.length > 1 ? <span className="text-emerald-500"> · all healthy</span> : null}
        </span>
        {onAsk && all.length > 1 && (
          <button
            type="button"
            onClick={() => onAsk(`Trace how traffic reaches ${type} ${name} in namespace ${namespace}. Check every hop (${columns.map((c) => c.label.toLowerCase()).join(" → ")}): are the service selectors matching ready pods, are ports and targetPorts consistent, and is anything unhealthy? Tell me where it breaks, if anywhere.`)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary ring-1 ring-primary/20 transition-colors hover:bg-primary/20"
          >
            <Sparkles className="h-3 w-3" />Trace with AI
          </button>
        )}
      </div>

      <div className="flex items-stretch gap-1 overflow-x-auto pb-2">
        {columns.map((col, i) => (
          <div key={col.key} className="flex min-w-[11.5rem] flex-1 items-stretch gap-1">
            {i > 0 && (
              <div className="flex shrink-0 items-center text-muted-foreground/40" aria-hidden>
                <ChevronRight className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
                <col.icon className="h-3.5 w-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-widest">{col.label}</span>
                <span className="text-[10px] tabular-nums text-muted-foreground/60">{col.nodes.length}</span>
              </div>
              <div className="space-y-1.5">
                {col.nodes.slice(0, col.key === "pod" ? 24 : 12).map((n) => (
                  <NodeCard key={n.key} node={n} onOpen={() => onNavigate(n.type, n.name, n.namespace)} />
                ))}
                {col.nodes.length > (col.key === "pod" ? 24 : 12) && (
                  <p className="px-1 text-[10px] text-muted-foreground">+{col.nodes.length - (col.key === "pod" ? 24 : 12)} more</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
