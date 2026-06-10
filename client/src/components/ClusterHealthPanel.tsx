import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  HeartPulse, ChevronDown, ChevronUp, AlertTriangle, AlertOctagon,
  CheckCircle2, Sparkles, Loader2, ChevronRight, Activity, RefreshCw, Clock,
} from "lucide-react";
import { Markdown } from "@/components/assistant/Markdown";
import { useClusterEvents, type ClusterEvent } from "@/hooks/use-k8s";

export type HealthSeverity = "critical" | "warning" | "info";

export interface HealthIssue {
  severity: HealthSeverity;
  category: string;        // e.g. "Pods", "Deployments", "Nodes"
  reason: string;          // e.g. "CrashLoopBackOff", "NotReady"
  title: string;           // e.g. "Pod in error state"
  items: { name: string; detail?: string; tab?: string; namespace?: string; kind?: string }[];
  tab?: string;            // dashboard tab to jump to
}

interface Props {
  context: string;
  namespace: string;
  issues: HealthIssue[];
  loading: boolean;
  onJumpToTab?: (tab: string) => void;
}

/**
 * Score = 100 - (criticalWeight * groups + warningWeight * groups), clamped 0..100.
 * Items inside a group bump the score lower with diminishing returns.
 */
function computeScore(issues: HealthIssue[]): number {
  if (issues.length === 0) return 100;
  let penalty = 0;
  for (const g of issues) {
    const base = g.severity === "critical" ? 25 : g.severity === "warning" ? 8 : 2;
    const extra = Math.min(15, Math.log2(Math.max(1, g.items.length)) * 4);
    penalty += base + extra;
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

function scoreColor(score: number): { bg: string; text: string; ring: string; label: string } {
  if (score >= 90) return { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500/20", label: "Healthy" };
  if (score >= 70) return { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", ring: "ring-amber-500/20", label: "Degraded" };
  if (score >= 40) return { bg: "bg-orange-500/10", text: "text-orange-600 dark:text-orange-400", ring: "ring-orange-500/20", label: "Unhealthy" };
  return { bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", ring: "ring-red-500/20", label: "Critical" };
}

function shortAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ClusterHealthPanel({ context, namespace, issues, loading, onJumpToTab }: Props) {
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<"issues" | "events" | "brief">("issues");
  const score = computeScore(issues);
  const scoreUi = scoreColor(score);
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  // Trend: compare score to previous render (cached in ref).
  const prevScoreRef = useRef(score);
  const delta = score - prevScoreRef.current;
  useEffect(() => {
    prevScoreRef.current = score;
  }, [score]);

  const { data: events, isLoading: eventsLoading, refetch: refetchEvents } =
    useClusterEvents(context, namespace, { warningsOnly: true, maxAgeMinutes: 60 });

  const eventGroupCount = events?.length ?? 0;

  return (
    <div className={`rounded-xl shadow-sm border overflow-hidden transition-all ${scoreUi.ring} ${scoreUi.bg} border-border`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left"
      >
        <div className={`relative w-10 h-10 rounded-full ${scoreUi.bg} ring-2 ${scoreUi.ring} flex items-center justify-center shrink-0`}>
          <span className={`text-sm font-bold tabular-nums ${scoreUi.text}`}>{loading ? "…" : score}</span>
        </div>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <HeartPulse className={`w-4 h-4 shrink-0 ${scoreUi.text}`} />
            <span className="text-sm font-semibold text-foreground">Cluster Health</span>
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${scoreUi.text}`}>{scoreUi.label}</span>
            {delta !== 0 && !loading && (
              <span className={`text-[10px] tabular-nums ${delta > 0 ? "text-emerald-500" : "text-red-500"}`}>
                {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {criticalCount > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{criticalCount} critical</span>}
            {warningCount > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium">{warningCount} warning</span>}
            {issues.length === 0 && !loading && <span className="text-emerald-600 dark:text-emerald-400 font-medium">All systems healthy</span>}
            {eventGroupCount > 0 && <span>· {eventGroupCount} recent event{eventGroupCount === 1 ? "" : "s"}</span>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Tab bar */}
          <div className="flex items-center gap-0.5 px-3 pt-2 border-b border-border bg-background/40">
            <TabButton active={activeTab === "issues"} onClick={() => setActiveTab("issues")} icon={AlertOctagon} label="Issues" count={issues.length} />
            <TabButton active={activeTab === "events"} onClick={() => setActiveTab("events")} icon={Activity} label="Events" count={eventGroupCount} />
            <TabButton active={activeTab === "brief"} onClick={() => setActiveTab("brief")} icon={Sparkles} label="AI Brief" />
            <div className="ml-auto" />
            {activeTab === "events" && (
              <button
                onClick={() => refetchEvents()}
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-3 h-3 ${eventsLoading ? "animate-spin" : ""}`} />
              </button>
            )}
          </div>

          <div className="px-4 py-3">
            {activeTab === "issues" && (
              <IssuesView issues={issues} loading={loading} onJumpToTab={onJumpToTab} navigate={navigate} context={context} namespace={namespace} />
            )}
            {activeTab === "events" && (
              <EventsView events={events ?? []} loading={eventsLoading} navigate={navigate} context={context} namespace={namespace} />
            )}
            {activeTab === "brief" && (
              <AiBriefView context={context} namespace={namespace} issues={issues} events={events ?? []} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab button ──────────────────────────────────────────────

function TabButton({
  active, onClick, icon: Icon, label, count,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof AlertOctagon;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-t-md transition-colors ${
        active
          ? "bg-card text-foreground border border-border border-b-card -mb-px"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
      }`}
    >
      <Icon className="w-3 h-3" />
      {label}
      {count !== undefined && count > 0 && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Issues view (grouped, expandable) ───────────────────────

function IssuesView({
  issues, loading, onJumpToTab, navigate, context, namespace,
}: {
  issues: HealthIssue[];
  loading: boolean;
  onJumpToTab?: (tab: string) => void;
  navigate: (to: string) => void;
  context: string;
  namespace: string;
}) {
  if (loading) return <div className="text-xs text-muted-foreground py-2">Computing health…</div>;
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 py-3">
        <CheckCircle2 className="w-4 h-4" />
        No issues detected in <code className="font-mono text-[10px]">{namespace || "all"}</code>.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {issues.map((issue, i) => (
        <IssueGroup
          key={i}
          issue={issue}
          onJumpToTab={onJumpToTab}
          onInvestigate={(prompt) =>
            navigate(`/ai?q=${encodeURIComponent(prompt)}&context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(namespace)}`)
          }
        />
      ))}
    </div>
  );
}

function IssueGroup({
  issue, onJumpToTab, onInvestigate,
}: {
  issue: HealthIssue;
  onJumpToTab?: (tab: string) => void;
  onInvestigate: (prompt: string) => void;
}) {
  const [open, setOpen] = useState(issue.severity === "critical");
  const isCritical = issue.severity === "critical";
  const borderL = isCritical ? "border-l-red-500" : "border-l-amber-500";
  const Icon = isCritical ? AlertOctagon : AlertTriangle;
  const iconCol = isCritical ? "text-red-500" : "text-amber-500";

  const investigatePrompt = `Investigate this Kubernetes issue: ${issue.title} (${issue.reason}) — affecting ${issue.items.length} ${issue.category.toLowerCase()}: ${issue.items.slice(0, 5).map((it) => it.name).join(", ")}${issue.items.length > 5 ? "…" : ""}. Diagnose root cause and propose fixes.`;

  return (
    <div className={`rounded-lg border-l-2 ${borderL} bg-background/50 border border-border overflow-hidden`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        {open
          ? <ChevronDown className="w-3 h-3 shrink-0 mt-1 text-muted-foreground" />
          : <ChevronRight className="w-3 h-3 shrink-0 mt-1 text-muted-foreground" />}
        <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${iconCol}`} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-foreground font-medium">
            {issue.title}
            <span className="ml-2 text-muted-foreground font-normal">
              ({issue.items.length} {issue.category.toLowerCase()}
              {issue.items.length === 1 ? "" : "s"})
            </span>
          </div>
          {issue.reason && (
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{issue.reason}</div>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onInvestigate(investigatePrompt); }}
          className="shrink-0 flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md transition-colors"
          title="Investigate with AI"
        >
          <Sparkles className="w-3 h-3" />
          Investigate
        </button>
      </button>

      {open && (
        <div className="border-t border-border/60 bg-muted/10 px-3 py-2 space-y-1">
          {issue.items.slice(0, 30).map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] group">
              <span className="text-muted-foreground/60">•</span>
              <code className="font-mono text-foreground/80">{item.name}</code>
              {item.detail && <span className="text-muted-foreground">— {item.detail}</span>}
              {issue.tab && onJumpToTab && (
                <button
                  onClick={() => onJumpToTab(issue.tab!)}
                  className="ml-auto opacity-0 group-hover:opacity-100 text-[10px] text-primary hover:underline transition-opacity"
                >
                  view →
                </button>
              )}
            </div>
          ))}
          {issue.items.length > 30 && (
            <div className="text-[10px] text-muted-foreground italic">
              … and {issue.items.length - 30} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Events view ─────────────────────────────────────────────

function EventsView({
  events, loading, navigate, context, namespace,
}: {
  events: ClusterEvent[];
  loading: boolean;
  navigate: (to: string) => void;
  context: string;
  namespace: string;
}) {
  if (loading && events.length === 0) {
    return <div className="text-xs text-muted-foreground py-2 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Fetching events…</div>;
  }
  if (events.length === 0) {
    return (
      <div className="text-xs text-emerald-600 dark:text-emerald-400 py-3 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4" /> No warning events in the last 60 minutes.
      </div>
    );
  }
  return (
    <div className="space-y-1 max-h-80 overflow-auto">
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/40 transition-colors text-[11px]">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-500" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-foreground font-medium">{e.reason}</span>
              <code className="text-muted-foreground text-[10px]">{e.objectKind}/{e.objectName}</code>
              {e.namespace && <code className="text-muted-foreground/60 text-[10px]">ns={e.namespace}</code>}
              {e.count > 1 && <span className="text-[10px] px-1 py-0 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">×{e.count}</span>}
              <span className="ml-auto flex items-center gap-1 text-muted-foreground/70 text-[10px]">
                <Clock className="w-2.5 h-2.5" />
                {shortAge(e.lastTimestamp)}
              </span>
            </div>
            <div className="text-foreground/70 mt-0.5 break-words">{e.message}</div>
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={() =>
                  navigate(`/ai?q=${encodeURIComponent(
                    `Explain this Kubernetes event and propose a fix: ${e.reason} on ${e.objectKind}/${e.objectName} (ns=${e.namespace}): ${e.message}`,
                  )}&context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(namespace)}`)
                }
                className="flex items-center gap-1 text-[10px] text-primary hover:underline"
              >
                <Sparkles className="w-2.5 h-2.5" /> investigate
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── AI Brief view ───────────────────────────────────────────

function AiBriefView({
  context, namespace, issues, events,
}: {
  context: string;
  namespace: string;
  issues: HealthIssue[];
  events: ClusterEvent[];
}) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable signal signature so we don't re-fetch on every render
  const signalKey = useMemo(() => {
    const slim = {
      ctx: context,
      ns: namespace,
      issues: issues.map((g) => `${g.severity}:${g.category}:${g.reason}:${g.items.length}`),
      events: events.slice(0, 20).map((e) => `${e.reason}:${e.objectKind}/${e.objectName}:${e.count}`),
    };
    return JSON.stringify(slim);
  }, [context, namespace, issues, events]);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/cluster-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context,
          namespace,
          signals: {
            issues: issues.map((g) => ({
              severity: g.severity,
              category: g.category,
              reason: g.reason,
              title: g.title,
              count: g.items.length,
              samples: g.items.slice(0, 5).map((i) => ({ name: i.name, detail: i.detail })),
            })),
            recentWarningEvents: events.slice(0, 30).map((e) => ({
              reason: e.reason,
              kind: e.objectKind,
              name: e.objectName,
              namespace: e.namespace,
              count: e.count,
              age: shortAge(e.lastTimestamp),
              message: e.message,
            })),
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const body = await res.json();
      setContent(body.briefing || "");
    } catch (err: any) {
      setError(err?.message || "Failed");
    } finally {
      setLoading(false);
    }
  };

  // Auto-run once when entering tab if we have a context
  useEffect(() => {
    if (!context) return;
    if (content || loading) return;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          <Sparkles className="w-3 h-3 text-primary" />
          AI briefing
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-1 text-[10px] text-primary hover:underline disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {loading ? "Generating…" : "Regenerate"}
        </button>
      </div>
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-2 py-1.5">{error}</div>
      )}
      {!error && !content && !loading && (
        <div className="text-xs text-muted-foreground italic py-3">Click Regenerate to get an AI-summarized briefing of this cluster.</div>
      )}
      {!error && !content && loading && (
        <div className="text-xs text-muted-foreground py-3 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin text-primary" />
          Asking the AI for a briefing… (uses your fast model)
        </div>
      )}
      {content && (
        <div className="text-xs">
          <Markdown text={content} />
        </div>
      )}
      <input type="hidden" value={signalKey} readOnly />
    </div>
  );
}
