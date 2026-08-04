import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  HeartPulse, ChevronDown, ChevronUp, AlertTriangle, AlertOctagon,
  CheckCircle2, Sparkles, Loader2, ChevronRight, Activity, RefreshCw, Clock,
  ExternalLink,
} from "lucide-react";
import { Markdown } from "@/components/assistant/Markdown";
import { useClusterEvents, type ClusterEvent } from "@/hooks/use-k8s";

export type HealthSeverity = "critical" | "warning" | "info";

export interface HealthIssue {
  severity: HealthSeverity;
  category: string;
  reason: string;
  title: string;
  items: { name: string; detail?: string; tab?: string; namespace?: string; kind?: string }[];
  tab?: string;
}

interface Props {
  context: string;
  namespace: string;
  issues: HealthIssue[];
  loading: boolean;
  onJumpToTab?: (tab: string) => void;
}

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
  const [activeFilter, setActiveFilter] = useState<"issues" | "events">("issues");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const score = computeScore(issues);
  const scoreUi = scoreColor(score);
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  const prevScoreRef = useRef(score);
  const delta = score - prevScoreRef.current;
  useEffect(() => {
    prevScoreRef.current = score;
  }, [score]);

  const { data: events, isLoading: eventsLoading, refetch: refetchEvents } =
    useClusterEvents(context, namespace, { warningsOnly: true, maxAgeMinutes: 60 });

  const eventGroupCount = events?.length ?? 0;

  // Auto-expand the first critical issue
  useEffect(() => {
    if (issues.length > 0 && expandedKey === null) {
      const firstCritical = issues.findIndex((i) => i.severity === "critical");
      if (firstCritical >= 0) {
        setExpandedKey(`issue-${firstCritical}`);
      }
    }
  }, [issues, expandedKey]);

  const toggleRow = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  return (
    <div className={`rounded-xl shadow-sm border overflow-hidden transition-all backdrop-blur bg-card/50 ${scoreUi.ring} border-border/50`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left"
      >
        <div className={`relative w-10 h-10 rounded-xl ${scoreUi.bg} ring-2 ${scoreUi.ring} flex items-center justify-center shrink-0`}>
          <span className={`text-sm font-bold tabular-nums ${scoreUi.text}`}>{loading ? "…" : score}</span>
        </div>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <HeartPulse size={14} className={`shrink-0 ${scoreUi.text}`} />
            <span className="text-sm font-semibold text-foreground">Cluster Health</span>
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${scoreUi.text}`}>{scoreUi.label}</span>
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
          {/* Segmented filter control */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-background/40">
            <FilterChip
              active={activeFilter === "issues"}
              onClick={() => { setActiveFilter("issues"); setExpandedKey(null); }}
              icon={AlertOctagon}
              label="Issues"
              count={issues.length}
            />
            <FilterChip
              active={activeFilter === "events"}
              onClick={() => { setActiveFilter("events"); setExpandedKey(null); }}
              icon={Activity}
              label="Events"
              count={eventGroupCount}
            />
            <div className="ml-auto">
              {activeFilter === "events" && (
                <button
                  onClick={() => refetchEvents()}
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  title="Refresh events"
                >
                  <RefreshCw className={`w-3 h-3 ${eventsLoading ? "animate-spin" : ""}`} />
                </button>
              )}
            </div>
          </div>

          <div className="px-4 py-2">
            {activeFilter === "issues" && (
              <IssuesView
                issues={issues}
                loading={loading}
                onJumpToTab={onJumpToTab}
                navigate={navigate}
                context={context}
                namespace={namespace}
                expandedKey={expandedKey}
                onToggle={toggleRow}
              />
            )}
            {activeFilter === "events" && (
              <EventsView
                events={events ?? []}
                loading={eventsLoading}
                navigate={navigate}
                context={context}
                namespace={namespace}
                expandedKey={expandedKey}
                onToggle={toggleRow}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Filter chip (segmented control item) ────────────────────

function FilterChip({
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
      className={`flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold rounded-md transition-colors ${
        active
          ? "bg-primary/10 text-primary border border-primary/20"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
      }`}
    >
      <Icon size={11} />
      {label}
      {count !== undefined && count > 0 && (
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Issues view (compact rows, single-expand) ──────────────

function IssuesView({
  issues, loading, onJumpToTab, navigate, context, namespace, expandedKey, onToggle,
}: {
  issues: HealthIssue[];
  loading: boolean;
  onJumpToTab?: (tab: string) => void;
  navigate: (to: string) => void;
  context: string;
  namespace: string;
  expandedKey: string | null;
  onToggle: (key: string) => void;
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
    <div className="space-y-1">
      {issues.map((issue, i) => {
        const key = `issue-${i}`;
        const isOpen = expandedKey === key;
        return (
          <IssueRow
            key={key}
            issue={issue}
            isOpen={isOpen}
            onToggle={() => onToggle(key)}
            onJumpToTab={onJumpToTab}
            navigate={navigate}
            context={context}
            namespace={namespace}
          />
        );
      })}
    </div>
  );
}

function IssueRow({
  issue, isOpen, onToggle, onJumpToTab, navigate, context, namespace,
}: {
  issue: HealthIssue;
  isOpen: boolean;
  onToggle: () => void;
  onJumpToTab?: (tab: string) => void;
  navigate: (to: string) => void;
  context: string;
  namespace: string;
}) {
  const isCritical = issue.severity === "critical";
  const borderL = isCritical ? "border-l-red-500" : "border-l-amber-500";
  const Icon = isCritical ? AlertOctagon : AlertTriangle;
  const iconCol = isCritical ? "text-red-500" : "text-amber-500";

  const investigatePrompt = `Investigate this Kubernetes issue: ${issue.title} (${issue.reason}) — affecting ${issue.items.length} ${issue.category.toLowerCase()}: ${issue.items.slice(0, 5).map((it) => it.name).join(", ")}${issue.items.length > 5 ? "…" : ""}. Diagnose root cause and propose fixes.`;

  return (
    <div className={`rounded-lg border-l-2 ${borderL} bg-background/50 border border-border overflow-hidden`}>
      {/* Collapsed row — one line */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        {isOpen
          ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
          : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />}
        <Icon className={`w-3.5 h-3.5 shrink-0 ${iconCol}`} />
        <span className="text-[12px] text-foreground font-medium truncate">{issue.title}</span>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">
          {issue.items.length}
        </span>
        {issue.reason && (
          <code className="text-[10px] text-muted-foreground font-mono truncate hidden sm:inline">{issue.reason}</code>
        )}
      </button>

      {/* Expanded drawer */}
      {isOpen && (
        <div className="border-t border-border/60 bg-muted/10 px-3 py-2.5 space-y-3">
          {/* Sample items — max 3 */}
          <div className="space-y-1">
            {issue.items.slice(0, 3).map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] group">
                <span className="text-muted-foreground/60">•</span>
                <code className="font-mono text-foreground/80">{item.name}</code>
                {item.detail && <span className="text-muted-foreground truncate">— {item.detail}</span>}
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
            {issue.items.length > 3 && (
              <div className="text-[10px] text-muted-foreground italic pl-4">
                +{issue.items.length - 3} more
              </div>
            )}
          </div>

          {/* Inline AI panel */}
          <AlertAiPanel
            context={context}
            namespace={namespace}
            issue={issue}
          />

          {/* Investigate in chat link */}
          <button
            onClick={() =>
              navigate(`/ai?prompt=${encodeURIComponent(investigatePrompt)}&context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(namespace)}`)
            }
            className="flex items-center gap-1.5 text-[10px] text-primary hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            Investigate in AI chat
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Events view (compact rows, single-expand) ──────────────

function EventsView({
  events, loading, navigate, context, namespace, expandedKey, onToggle,
}: {
  events: ClusterEvent[];
  loading: boolean;
  navigate: (to: string) => void;
  context: string;
  namespace: string;
  expandedKey: string | null;
  onToggle: (key: string) => void;
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
      {events.map((e, i) => {
        const key = `event-${i}`;
        const isOpen = expandedKey === key;
        return (
          <EventRow
            key={key}
            event={e}
            isOpen={isOpen}
            onToggle={() => onToggle(key)}
            navigate={navigate}
            context={context}
            namespace={namespace}
          />
        );
      })}
    </div>
  );
}

function EventRow({
  event: e, isOpen, onToggle, navigate, context, namespace,
}: {
  event: ClusterEvent;
  isOpen: boolean;
  onToggle: () => void;
  navigate: (to: string) => void;
  context: string;
  namespace: string;
}) {
  const investigatePrompt = `Explain this Kubernetes event and propose a fix: ${e.reason} on ${e.objectKind}/${e.objectName} (ns=${e.namespace}): ${e.message}`;

  return (
    <div className="rounded-lg bg-background/50 border border-border overflow-hidden">
      {/* Collapsed row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/30 transition-colors text-[11px]"
      >
        {isOpen
          ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
          : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />}
        <AlertTriangle className="w-3 h-3 shrink-0 text-amber-500" />
        <span className="font-mono text-foreground font-medium truncate">{e.reason}</span>
        <code className="text-muted-foreground text-[10px] truncate">{e.objectKind}/{e.objectName}</code>
        {e.count > 1 && (
          <span className="text-[10px] px-1 py-0 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">×{e.count}</span>
        )}
        <span className="ml-auto flex items-center gap-1 text-muted-foreground/70 text-[10px] shrink-0">
          <Clock className="w-2.5 h-2.5" />
          {shortAge(e.lastTimestamp)}
        </span>
      </button>

      {/* Expanded drawer */}
      {isOpen && (
        <div className="border-t border-border/60 bg-muted/10 px-3 py-2.5 space-y-2">
          {e.namespace && (
            <div className="text-[10px] text-muted-foreground">
              namespace: <code className="font-mono">{e.namespace}</code>
            </div>
          )}
          <div className="text-[11px] text-foreground/80 break-words">{e.message}</div>

          <button
            onClick={() =>
              navigate(`/ai?prompt=${encodeURIComponent(investigatePrompt)}&context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(namespace)}`)
            }
            className="flex items-center gap-1.5 text-[10px] text-primary hover:underline"
          >
            <Sparkles className="w-3 h-3" />
            Investigate in AI chat
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Inline AI panel (per-issue, lazy-loaded) ────────────────

function AlertAiPanel({
  context, namespace, issue,
}: {
  context: string;
  namespace: string;
  issue: HealthIssue;
}) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

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
            issues: [{
              severity: issue.severity,
              category: issue.category,
              reason: issue.reason,
              title: issue.title,
              count: issue.items.length,
              samples: issue.items.slice(0, 5).map((i) => ({ name: i.name, detail: i.detail })),
            }],
            recentWarningEvents: [],
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

  useEffect(() => {
    if (!fetchedRef.current && context) {
      fetchedRef.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-md border border-primary/15 bg-primary/5 px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          <Sparkles className="w-3 h-3 text-primary" />
          AI insight
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-1 text-[10px] text-primary hover:underline disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {loading ? "Analyzing…" : "Retry"}
        </button>
      </div>
      {error && (
        <div className="text-[11px] text-destructive">{error}</div>
      )}
      {!error && !content && loading && (
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin text-primary" />
          Analyzing this issue…
        </div>
      )}
      {!error && content && (
        <div className="text-[11px] leading-relaxed [&_p]:mb-1 [&_ul]:ml-3 [&_li]:list-disc">
          <Markdown text={content} />
        </div>
      )}
    </div>
  );
}
