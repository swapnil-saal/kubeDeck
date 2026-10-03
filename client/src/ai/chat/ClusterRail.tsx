import { useMemo, useState, type FC, type ReactNode } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import {
  AlertOctagon, AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight,
  Cpu, Info, Loader2, RefreshCw, ServerCrash, Sparkles, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useK8sPods, useK8sDeployments, useK8sNodes, useClusterEvents } from "@/hooks/use-k8s";
import { AgentActivity } from "./ActivityRail";
import {
  analyzePulse, diagnoseAllPrompt,
  type DeployLike, type EventLike, type Issue, type NodeLike, type PodLike, type Severity,
} from "./pulse";

const SEVERITY_UI: Record<Severity, { icon: ReactNode; dot: string; pill: string }> = {
  critical: {
    icon: <AlertOctagon className="h-3.5 w-3.5 text-destructive" />,
    dot: "bg-destructive",
    pill: "bg-destructive/10 text-destructive ring-destructive/20",
  },
  warning: {
    icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
    dot: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  },
  info: {
    icon: <Info className="h-3.5 w-3.5 text-muted-foreground" />,
    dot: "bg-muted-foreground/60",
    pill: "bg-muted text-muted-foreground ring-border",
  },
};

function scoreTone(score: number) {
  if (score >= 90) return { stroke: "stroke-emerald-500", text: "text-emerald-500", label: "Healthy" };
  if (score >= 70) return { stroke: "stroke-amber-500", text: "text-amber-500", label: "Degraded" };
  return { stroke: "stroke-destructive", text: "text-destructive", label: "Unhealthy" };
}

const ScoreRing: FC<{ score: number }> = ({ score }) => {
  const tone = scoreTone(score);
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0" role="img" aria-label={`Health score ${score} of 100`}>
      <svg viewBox="0 0 60 60" className="h-full w-full -rotate-90">
        <circle cx="30" cy="30" r={r} fill="none" strokeWidth="5" className="stroke-muted" />
        <circle
          cx="30" cy="30" r={r} fill="none" strokeWidth="5" strokeLinecap="round"
          className={cn("transition-all duration-700", tone.stroke)}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
        />
      </svg>
      <span className={cn("absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums", tone.text)}>
        {score}
      </span>
    </div>
  );
};

const SectionTitle: FC<{ children: ReactNode; right?: ReactNode }> = ({ children, right }) => (
  <div className="flex items-center justify-between px-4 pb-1.5 pt-4">
    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{children}</span>
    {right}
  </div>
);

/** One finding. Clicking hands it to the agent with a ready-made prompt. */
const FindingRow: FC<{ issue: Issue; actionLabel: string; disabled: boolean; onAsk: (prompt: string) => void }> = ({
  issue, actionLabel, disabled, onAsk,
}) => {
  const ui = SEVERITY_UI[issue.severity];
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onAsk(issue.prompt)}
        title={`${actionLabel}: ${issue.title}`}
        className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="mt-1 shrink-0">{ui.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <code className="min-w-0 truncate font-mono text-[11px] text-foreground">{issue.title}</code>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className={cn("shrink-0 rounded-md px-1.5 py-px text-[10px] font-medium ring-1", ui.pill)}>{issue.reason}</span>
            {issue.meta && <span className="truncate text-[10px] text-muted-foreground">{issue.meta}</span>}
          </span>
        </span>
        <span className="mt-0.5 flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
          {actionLabel}
          <ArrowUpRight className="h-3 w-3" />
        </span>
      </button>
    </li>
  );
};

/** Collapsible group that shows `limit` rows and expands to the rest. */
const Findings: FC<{
  issues: Issue[];
  actionLabel: string;
  limit: number;
  disabled: boolean;
  onAsk: (prompt: string) => void;
}> = ({ issues, actionLabel, limit, disabled, onAsk }) => {
  const [all, setAll] = useState(false);
  const shown = all ? issues : issues.slice(0, limit);
  return (
    <>
      <ul className="px-2">
        {shown.map((i) => (
          <FindingRow key={i.id} issue={i} actionLabel={actionLabel} disabled={disabled} onAsk={onAsk} />
        ))}
      </ul>
      {issues.length > limit && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mx-4 mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {all ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {all ? "Show less" : `Show ${issues.length - limit} more`}
        </button>
      )}
    </>
  );
};

const PodBar: FC<{ running: number; pending: number; failed: number; done: number; total: number }> = ({
  running, pending, failed, done, total,
}) => {
  if (total === 0) return null;
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="px-4">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label="Pod states">
        <div className="bg-emerald-500" style={{ width: seg(running) }} />
        <div className="bg-sky-500/70" style={{ width: seg(done) }} />
        <div className="bg-amber-500" style={{ width: seg(pending) }} />
        <div className="bg-destructive" style={{ width: seg(failed) }} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        <span><b className="text-foreground">{running}</b> running</span>
        {pending > 0 && <span><b className="text-amber-500">{pending}</b> pending / not ready</span>}
        {failed > 0 && <span><b className="text-destructive">{failed}</b> failing</span>}
        {done > 0 && <span><b className="text-foreground">{done}</b> completed</span>}
      </div>
    </div>
  );
};

export interface ClusterRailProps {
  context: string;
  namespace: string;
}

/**
 * Right-hand rail for wide screens: a live, deterministic read of the cluster the
 * agent is pointed at. Every finding is one click from a precise question to the
 * agent, so the chat starts from what is actually broken instead of a blank box.
 */
export const ClusterRail: FC<ClusterRailProps> = ({ context, namespace }) => {
  const aui = useAui();
  const busy = useAuiState((s) => s.thread.isRunning);

  const podsQ = useK8sPods(context, namespace);
  const deployQ = useK8sDeployments(context, namespace);
  const nodesQ = useK8sNodes(context);
  const eventsQ = useClusterEvents(context, namespace, { warningsOnly: true, maxAgeMinutes: 60 });

  const pulse = useMemo(
    () =>
      analyzePulse({
        pods: podsQ.data as unknown as PodLike[] | undefined,
        deployments: deployQ.data as unknown as DeployLike[] | undefined,
        nodes: nodesQ.data as unknown as NodeLike[] | undefined,
        events: eventsQ.data as unknown as EventLike[] | undefined,
      }),
    [podsQ.data, deployQ.data, nodesQ.data, eventsQ.data],
  );

  const ask = (prompt: string) => {
    if (busy) return;
    aui.thread().append({ role: "user", content: [{ type: "text", text: prompt }] });
  };

  const loading = !podsQ.data && podsQ.isLoading;
  const blind = podsQ.isError && !podsQ.data;
  const tone = scoreTone(pulse.score);
  const refreshing = podsQ.isFetching || deployQ.isFetching;
  const maxCpu = Math.max(1, ...pulse.hot.map((h) => h.cpuMilli));

  return (
    <aside
      aria-label="Cluster pulse"
      className="hidden w-[22rem] shrink-0 flex-col overflow-y-auto border-l border-border bg-card/40 xl:flex 2xl:w-[25rem]"
    >
      {/* Header: score + counts */}
      <div className="flex items-center gap-3.5 px-4 pb-1 pt-4">
        {loading || blind ? (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ServerCrash className="h-5 w-5" />}
          </div>
        ) : (
          <ScoreRing score={pulse.score} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Cluster pulse</span>
            <span className="relative flex h-2 w-2" title="Live — refreshes automatically">
              <span className={cn("absolute inline-flex h-full w-full rounded-full bg-emerald-500/60", refreshing ? "animate-ping" : "opacity-0")} />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {context || "current-context"} / {namespace || "all"}
          </div>
          {!loading && !blind && (
            <div className={cn("mt-0.5 text-[11px] font-medium", tone.text)}>
              {tone.label}
              <span className="font-normal text-muted-foreground">
                {" · "}{pulse.deployments.ready}/{pulse.deployments.total} deploys
                {pulse.nodes.total > 0 && ` · ${pulse.nodes.ready}/${pulse.nodes.total} nodes`}
              </span>
            </div>
          )}
        </div>
      </div>

      {blind && (
        <p className="mx-4 mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Can't read pods here — your kubeconfig user may lack permission for this namespace, or the cluster is unreachable.
          The agent will tell you the same when it tries.
        </p>
      )}

      {!blind && !loading && (
        <>
          <div className="mt-3">
            <PodBar {...pulse.pods} />
          </div>

          {/* Needs attention */}
          <SectionTitle
            right={
              pulse.issues.length > 1 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => ask(diagnoseAllPrompt(pulse.issues, namespace))}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/20 transition-colors hover:bg-primary/20 disabled:opacity-50"
                >
                  <Sparkles className="h-3 w-3" />
                  Diagnose all
                </button>
              ) : null
            }
          >
            Needs attention{pulse.issues.length > 0 && ` · ${pulse.issues.length}`}
          </SectionTitle>
          {pulse.issues.length === 0 ? (
            <div className="mx-4 flex items-start gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <div className="text-xs leading-relaxed">
                <div className="font-medium text-foreground">All clear</div>
                <div className="text-muted-foreground">
                  {pulse.pods.running} of {pulse.pods.total} pods running, every deployment at full replicas.
                </div>
              </div>
            </div>
          ) : (
            <Findings issues={pulse.issues} actionLabel="Diagnose" limit={6} disabled={busy} onAsk={ask} />
          )}

          {/* Warning events */}
          {pulse.events.length > 0 && (
            <>
              <SectionTitle right={<span className="text-[10px] text-muted-foreground">last 60 min</span>}>
                Warnings · {pulse.events.length}
              </SectionTitle>
              <Findings issues={pulse.events} actionLabel="Explain" limit={4} disabled={busy} onAsk={ask} />
            </>
          )}

          {/* Flaky pods */}
          {pulse.flaky.length > 0 && (
            <>
              <SectionTitle right={<span className="text-[10px] tabular-nums text-muted-foreground">{pulse.restarts} restarts total</span>}>
                Flaky pods
              </SectionTitle>
              <Findings issues={pulse.flaky} actionLabel="Investigate" limit={3} disabled={busy} onAsk={ask} />
            </>
          )}

          {/* Hot pods */}
          {pulse.hot.length > 0 && (
            <>
              <SectionTitle right={<Cpu className="h-3 w-3 text-muted-foreground" />}>Busiest pods · CPU</SectionTitle>
              <ul className="px-2 pb-1">
                {pulse.hot.map((h) => (
                  <li key={`${h.namespace}/${h.name}`}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        ask(
                          `Pod ${h.name}${h.namespace ? ` in namespace ${h.namespace}` : ""} is using ${h.cpuMilli}m CPU and ${Math.round(h.memMi)}Mi memory, ` +
                          `among the highest here. Compare that with its requests/limits, check for throttling or a hot loop in its logs, and tell me if it needs tuning.`,
                        )
                      }
                      title="Ask the agent about this pod's resource use"
                      className="group w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <code className="truncate font-mono text-foreground">{h.name}</code>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {h.cpuMilli}m · {Math.round(h.memMi)}Mi
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary/70 group-hover:bg-primary" style={{ width: `${(h.cpuMilli / maxCpu) * 100}%` }} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* Ask-anything shortcut when nothing is wrong */}
      {!blind && !loading && pulse.issues.length === 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            ask(
              `Give me a short health briefing for ${namespace && namespace !== "all" ? `namespace ${namespace}` : "this cluster"}: ` +
              `what is risky even though everything is Running (missing resource limits, single replicas, restart-heavy pods, ` +
              `stale images, no probes)? Rank by impact.`,
            )
          }
          className="mx-4 mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted disabled:opacity-50"
        >
          <Zap className="h-3.5 w-3.5 text-primary" />
          Find hidden risks
        </button>
      )}

      <div className="flex-1" />

      <div className="mt-4 flex items-center justify-end gap-1.5 px-4 pb-2 text-[10px] text-muted-foreground">
        <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
        live · updates automatically
      </div>

      <AgentActivity />
    </aside>
  );
};
