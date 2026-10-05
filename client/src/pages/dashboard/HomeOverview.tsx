import { useMemo, useState, type FC, type FormEvent } from "react";
import {
  AlertOctagon, AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight, Cpu, GitCommitHorizontal,
  Info, MemoryStick, Scaling, Send, Sparkles, Zap,
} from "lucide-react";
import { ScoreRing, scoreTone } from "@/components/health/ScoreRing";
import { ago, diagnoseAllPrompt, type Change, type ClusterHealth, type Issue, type Severity } from "@/lib/cluster-health";
import type { NodeUsage } from "@/hooks/use-cluster-extras";
import { cn } from "@/lib/utils";

const SEVERITY: Record<Severity, { icon: JSX.Element; pill: string }> = {
  critical: { icon: <AlertOctagon className="h-3.5 w-3.5 text-destructive" />, pill: "bg-destructive/10 text-destructive ring-destructive/20" },
  warning: { icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />, pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20" },
  info: { icon: <Info className="h-3.5 w-3.5 text-muted-foreground" />, pill: "bg-muted text-muted-foreground ring-border" },
};

const Card: FC<{ title: string; right?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, right, className, children }) => (
  <section className={cn("rounded-xl border border-border/60 bg-card/50", className)}>
    <header className="flex items-center justify-between px-4 pb-2 pt-3.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
      {right}
    </header>
    {children}
  </section>
);

function IssueRow({ issue, action, onAsk }: { issue: Issue; action: string; onAsk: (p: string) => void }) {
  const ui = SEVERITY[issue.severity];
  return (
    <li>
      <button
        type="button"
        onClick={() => onAsk(issue.prompt)}
        className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
        title={`${action} with the AI operator`}
      >
        <span className="mt-1 shrink-0">{ui.icon}</span>
        <span className="min-w-0 flex-1">
          <code className="block truncate font-mono text-xs text-foreground">{issue.title}</code>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className={cn("shrink-0 rounded-md px-1.5 py-px text-[10px] font-medium ring-1", ui.pill)}>{issue.reason}</span>
            {issue.meta && <span className="truncate text-[11px] text-muted-foreground">{issue.meta}</span>}
          </span>
        </span>
        <span className="mt-0.5 flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {action}<ArrowUpRight className="h-3 w-3" />
        </span>
      </button>
    </li>
  );
}

function Bar({ pct, tone }: { pct: number; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "bg-destructive" : tone === "warn" ? "bg-amber-500" : "bg-primary";
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
      <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
    </div>
  );
}

const fmtCores = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} cores` : `${Math.round(m)}m`);
const fmtMem = (mi: number) => (mi >= 1024 ? `${(mi / 1024).toFixed(1)} GiB` : `${Math.round(mi)} MiB`);

export interface HomeOverviewProps {
  context: string;
  namespace: string;
  health: ClusterHealth;
  changes: Change[];
  /** live usage totals for the scope, when the user may read metrics */
  usage?: { cpuMilli: number; memMi: number } | null;
  /** what the pods in scope asked for */
  requests: { cpuMilli: number; memMi: number };
  metricsReason?: "forbidden" | "no-metrics-server" | "error";
  nodeUsage?: NodeUsage[];
  /** send a question to the AI operator, scoped to this cluster/namespace */
  onAsk: (prompt: string) => void;
}

/**
 * The home screen's answer to "is anything wrong, and what do I do about it?".
 * Everything is derived from the lists already being polled; every item is one click from the
 * AI operator with a precise prompt.
 */
export const HomeOverview: FC<HomeOverviewProps> = ({
  context, namespace, health, changes, usage, requests, metricsReason, nodeUsage, onAsk,
}) => {
  const [question, setQuestion] = useState("");
  const [showFlaky, setShowFlaky] = useState(false);
  const [feed, setFeed] = useState<"changes" | "warnings">("changes");

  const scopeText = namespace === "all" ? "all namespaces" : namespace;
  const tone = health.score === null ? null : scoreTone(health.score);
  const problems = health.issues.length;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setQuestion("");
    onAsk(q);
  };

  const suggestions = useMemo(() => {
    const out: { label: string; prompt: string }[] = [];
    for (const i of health.issues.slice(0, 2)) out.push({ label: `Why is ${i.title.length > 28 ? i.title.slice(0, 26) + "…" : i.title} ${i.reason}?`, prompt: i.prompt });
    if (health.flaky[0]) out.push({ label: `Why does ${health.flaky[0].title.slice(0, 24)} restart?`, prompt: health.flaky[0].prompt });
    if (out.length < 3) out.push({ label: "Find hidden risks", prompt: `Give me a short health briefing for ${namespace === "all" ? "this cluster" : `namespace ${namespace}`}: what is risky even though everything is Running (missing resource limits, single replicas, restart-heavy pods, stale images, no probes)? Rank by impact.` });
    if (out.length < 3) out.push({ label: "Summarise what's running", prompt: `Summarise what is running in ${namespace === "all" ? "this cluster" : `namespace ${namespace}`} and call out anything unusual.` });
    return out.slice(0, 3);
  }, [health.issues, health.flaky, namespace]);

  const cpuUsed = usage?.cpuMilli ?? 0;
  const memUsed = usage?.memMi ?? 0;
  const cpuPct = requests.cpuMilli > 0 ? (cpuUsed / requests.cpuMilli) * 100 : 0;
  const memPct = requests.memMi > 0 ? (memUsed / requests.memMi) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="flex flex-col gap-5 rounded-xl border border-border/60 bg-card/50 p-5 lg:flex-row lg:items-center">
        <div className="flex items-center gap-4 lg:w-[24rem] lg:shrink-0">
          <ScoreRing score={health.score} size={76} />
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{context} / {scopeText}</p>
            <p className={cn("text-lg font-semibold leading-tight", tone?.text ?? "text-muted-foreground")}>
              {health.score === null ? "Unknown" : problems > 0 ? `${problems} thing${problems === 1 ? "" : "s"} need attention` : tone?.label}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {health.pods.total} pods
              {health.deployments.total > 0 && ` · ${health.deployments.ready}/${health.deployments.total} deploys ready`}
              {health.nodes.total > 0 && ` · ${health.nodes.ready}/${health.nodes.total} nodes`}
            </p>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <form onSubmit={submit} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5 focus-within:border-primary/50">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`Ask about ${scopeText} — e.g. “why is the slowest pod slow?”`}
              aria-label="Ask the AI operator about this scope"
              className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:!outline-none"
            />
            <button type="submit" disabled={!question.trim()} aria-label="Ask" className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-30">
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s.label} type="button" onClick={() => onAsk(s.prompt)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                <Zap className="h-3 w-3 text-primary" />{s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
        {/* Needs attention */}
        <Card
          title={`Needs attention${problems > 0 ? ` · ${problems}` : ""}`}
          right={problems > 1 ? (
            <button type="button" onClick={() => onAsk(diagnoseAllPrompt(health.issues, namespace))} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary ring-1 ring-primary/20 transition-colors hover:bg-primary/20">
              <Sparkles className="h-3 w-3" />Diagnose all
            </button>
          ) : null}
        >
          <div className="px-2 pb-3">
            {problems === 0 ? (
              <div className="mx-2 flex items-start gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <div className="text-xs leading-relaxed">
                  <p className="font-medium text-foreground">All clear</p>
                  <p className="text-muted-foreground">{health.pods.running} of {health.pods.total} pods running and every deployment at full replicas.</p>
                </div>
              </div>
            ) : (
              <ul>{health.issues.slice(0, 7).map((i) => <IssueRow key={i.id} issue={i} action="Diagnose" onAsk={onAsk} />)}</ul>
            )}
            {problems > 7 && <p className="px-3 pt-1 text-[11px] text-muted-foreground">+{problems - 7} more — use “Diagnose all”.</p>}

            {health.flaky.length > 0 && (
              <div className="mt-2 border-t border-border/50 pt-2">
                <button type="button" onClick={() => setShowFlaky((v) => !v)} className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground" aria-expanded={showFlaky}>
                  {showFlaky ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  Flaky pods · {health.flakyTotal}
                  <span className="ml-auto font-normal normal-case tracking-normal">{health.restarts} restarts total</span>
                </button>
                {showFlaky && <ul>{health.flaky.map((i) => <IssueRow key={i.id} issue={i} action="Investigate" onAsk={onAsk} />)}</ul>}
              </div>
            )}
          </div>
        </Card>

        {/* Changes / warnings */}
          <Card
            title={feed === "changes" ? "Recent changes" : "Warnings · last hour"}
            right={
              <div className="flex gap-1 rounded-md bg-muted/60 p-0.5 text-[10px] font-semibold" role="tablist" aria-label="Feed">
                {(["changes", "warnings"] as const).map((f) => (
                  <button key={f} type="button" role="tab" aria-selected={feed === f} onClick={() => setFeed(f)} className={cn("rounded px-2 py-0.5 capitalize transition-colors", feed === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {f}{f === "warnings" && health.events.length > 0 ? ` ${health.events.length}` : ""}
                  </button>
                ))}
              </div>
            }
          >
            <div className="px-2 pb-3">
              {feed === "changes" ? (
                changes.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Nothing was rolled out or scaled in the last 7 days.</p>
                ) : (
                  <ul>
                    {changes.slice(0, 6).map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => onAsk(c.prompt)} className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60" title="Ask the AI operator to check this change">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                            {c.kind === "scaled" ? <Scaling className="h-3 w-3" /> : <GitCommitHorizontal className="h-3 w-3" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <code className="block truncate font-mono text-xs text-foreground">{c.title}</code>
                            <span className="text-[11px] text-muted-foreground">{c.kind === "rollout" ? "rolled out" : c.kind} · {c.detail}</span>
                          </span>
                          <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">{ago(new Date(c.at).toISOString())} ago</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : health.events.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No warning events in the last hour.</p>
              ) : (
                <ul>{health.events.slice(0, 6).map((i) => <IssueRow key={i.id} issue={i} action="Explain" onAsk={onAsk} />)}</ul>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          {/* Usage */}
          <Card title="Resource usage" right={<Cpu className="h-3.5 w-3.5 text-muted-foreground" />}>
            <div className="space-y-3 px-4 pb-4">
              {usage ? (
                <>
                  <div>
                    <div className="mb-1 flex items-baseline justify-between text-xs"><span className="flex items-center gap-1.5 text-muted-foreground"><Cpu className="h-3 w-3" />CPU in use</span><span className="tabular-nums text-foreground">{fmtCores(cpuUsed)} <span className="text-muted-foreground">of {fmtCores(requests.cpuMilli)} requested</span></span></div>
                    <Bar pct={cpuPct} tone={cpuPct > 90 ? "bad" : cpuPct > 70 ? "warn" : undefined} />
                  </div>
                  <div>
                    <div className="mb-1 flex items-baseline justify-between text-xs"><span className="flex items-center gap-1.5 text-muted-foreground"><MemoryStick className="h-3 w-3" />Memory in use</span><span className="tabular-nums text-foreground">{fmtMem(memUsed)} <span className="text-muted-foreground">of {fmtMem(requests.memMi)} requested</span></span></div>
                    <Bar pct={memPct} tone={memPct > 90 ? "bad" : memPct > 70 ? "warn" : undefined} />
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {metricsReason === "forbidden" ? "Your user can't read live metrics (metrics.k8s.io), so only requests are shown."
                      : metricsReason === "no-metrics-server" ? "This cluster has no metrics-server, so only requests are shown."
                      : "Live metrics are unavailable, so only requests are shown."}
                  </p>
                  <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">CPU requested</span><span className="tabular-nums text-foreground">{fmtCores(requests.cpuMilli)}</span></div>
                  <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Memory requested</span><span className="tabular-nums text-foreground">{fmtMem(requests.memMi)}</span></div>
                </>
              )}
              {nodeUsage && nodeUsage.length > 0 && (
                <div className="border-t border-border/50 pt-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Nodes</p>
                  <ul className="space-y-2">
                    {nodeUsage.slice(0, 5).map((n) => (
                      <li key={n.name} className="text-[11px]">
                        <div className="mb-0.5 flex justify-between"><code className="truncate font-mono text-foreground">{n.name}</code><span className="tabular-nums text-muted-foreground">CPU {n.cpuPct}% · mem {n.memPct}%</span></div>
                        <Bar pct={Math.max(n.cpuPct, n.memPct)} tone={Math.max(n.cpuPct, n.memPct) > 85 ? "bad" : Math.max(n.cpuPct, n.memPct) > 70 ? "warn" : undefined} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {health.hot.length > 0 && (
                <div className="border-t border-border/50 pt-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{health.hotSource === "usage" ? "Busiest right now" : "Largest requests"}</p>
                  <ul>
                    {health.hot.slice(0, 3).map((h) => (
                      <li key={`${h.namespace}/${h.name}`}>
                        <button type="button" onClick={() => onAsk(`Pod ${h.name}${h.namespace ? ` in namespace ${h.namespace}` : ""} ${health.hotSource === "usage" ? `is using ${Math.round(h.cpuMilli)}m CPU and ${Math.round(h.memMi)}Mi` : `requests ${Math.round(h.cpuMilli)}m CPU and ${Math.round(h.memMi)}Mi`}. Is that appropriate? Check its limits, throttling and logs.`)} className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/60">
                          <code className="truncate font-mono text-foreground">{h.name}</code>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{Math.round(h.cpuMilli)}m · {Math.round(h.memMi)}Mi</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
};
