import type { FC } from "react";
import { Cpu, Info, MemoryStick } from "lucide-react";
import type { NodeUsage } from "@/hooks/use-cluster-extras";
import type { ClusterHealth } from "@/lib/cluster-health";
import { Meter, Panel, fmtCores, fmtMem } from "./parts";

interface Totals { cpuMilli: number; memMi: number }

/** One resource: what the pods use against what they asked for, and what that means. */
const UsageRow: FC<{ label: string; icon: JSX.Element; used: number; requested: number; fmt: (n: number) => string; over: string; idle: string }> = ({
  label, icon, used, requested, fmt, over, idle,
}) => {
  const pct = requested > 0 ? (used / requested) * 100 : 0;
  const note = requested > 0 && pct > 100 ? over : requested > 0 && pct < 25 ? idle : null;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-foreground">{icon}{label}</span>
        <span className="tabular-nums text-foreground">
          {fmt(used)} <span className="text-muted-foreground">used of {fmt(requested)} requested</span>
        </span>
      </div>
      <Meter pct={pct} tone={pct > 100 ? "warn" : undefined} label={`${label}: ${Math.round(pct)}% of requests in use`} />
      {note && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <Info className="mt-px h-3 w-3 shrink-0" />{note}
        </p>
      )}
    </div>
  );
};

/** Is there room? Usage against requests for the scope, how full the nodes are, and the busiest pods. */
export const CapacityPanel: FC<{
  health: ClusterHealth;
  usage?: Totals | null;
  requests: Totals;
  metricsReason?: "forbidden" | "no-metrics-server" | "error";
  nodeUsage?: NodeUsage[];
  onOpen: (type: string, name: string, namespace: string) => void;
  namespace: string;
}> = ({ health, usage, requests, metricsReason, nodeUsage, onOpen, namespace }) => {
  const nodes = [...(nodeUsage ?? [])].sort((a, b) => Math.max(b.cpuPct, b.memPct) - Math.max(a.cpuPct, a.memPct));
  const avg = (k: "cpuPct" | "memPct") => (nodes.length ? Math.round(nodes.reduce((t, n) => t + n[k], 0) / nodes.length) : 0);

  return (
    <Panel title="Capacity">
      <div className="space-y-5 p-4">
        {usage ? (
          <div className="space-y-4">
            <UsageRow
              label="CPU" icon={<Cpu className="h-3.5 w-3.5 text-muted-foreground" />} used={usage.cpuMilli} requested={requests.cpuMilli} fmt={fmtCores}
              over="Pods use more CPU than they request: they may be throttled when the node is busy."
              idle="Pods use under a quarter of the CPU they request: requests could be lowered to free room."
            />
            <UsageRow
              label="Memory" icon={<MemoryStick className="h-3.5 w-3.5 text-muted-foreground" />} used={usage.memMi} requested={requests.memMi} fmt={fmtMem}
              over="Pods use more memory than they request: they are first to be evicted when a node runs short."
              idle="Pods use under a quarter of the memory they request: requests could be lowered."
            />
          </div>
        ) : (
          <div className="space-y-2 text-xs">
            <p className="leading-relaxed text-muted-foreground">
              {metricsReason === "forbidden" ? "Your user can't read live metrics (metrics.k8s.io), so only requests are shown."
                : metricsReason === "no-metrics-server" ? "This cluster has no metrics-server, so only requests are shown."
                : "Live metrics are unavailable, so only requests are shown."}
            </p>
            <p className="flex justify-between"><span className="text-muted-foreground">CPU requested</span><span className="tabular-nums">{fmtCores(requests.cpuMilli)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">Memory requested</span><span className="tabular-nums">{fmtMem(requests.memMi)}</span></p>
          </div>
        )}

        {nodes.length > 0 && (
          <div>
            <p className="mb-2 flex justify-between text-[11px] font-medium text-muted-foreground">
              <span>Nodes · fullest first</span>
              <span className="tabular-nums">avg CPU {avg("cpuPct")}% · mem {avg("memPct")}%</span>
            </p>
            <ul className="space-y-2.5">
              {nodes.slice(0, 5).map((n) => {
                const top = Math.max(n.cpuPct, n.memPct);
                return (
                  <li key={n.name}>
                    <button type="button" onClick={() => onOpen("node", n.name, namespace)} className="block w-full text-left">
                      <span className="mb-1 flex justify-between gap-2 text-[11px]">
                        <span className="truncate font-mono text-foreground hover:underline">{n.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">CPU {n.cpuPct}% · mem {n.memPct}%</span>
                      </span>
                      <Meter pct={top} tone={top > 85 ? "bad" : top > 70 ? "warn" : undefined} label={`${n.name}: ${top}% used`} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {health.hot.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">{health.hotSource === "usage" ? "Busiest pods right now" : "Largest requests"}</p>
            <ul>
              {health.hot.slice(0, 4).map((h) => (
                <li key={`${h.namespace}/${h.name}`}>
                  <button
                    type="button"
                    onClick={() => onOpen("pod", h.name, h.namespace ?? namespace)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/60"
                  >
                    <span className="truncate font-mono text-foreground">{h.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{fmtCores(h.cpuMilli)} · {fmtMem(h.memMi)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
};
