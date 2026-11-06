import { useMemo } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Loader2, Waypoints, X } from "lucide-react";
import { TRACE_SINCE, type StatRow, type TraceSince, type TraceSummary, type TraceWorkloadKind } from "@shared/traces";
import { useGenericList } from "@/hooks/use-k8s";
import { useHashParams } from "@/hooks/use-hash-params";
import { useScope } from "@/hooks/use-scope";
import { useServerMode } from "@/hooks/use-server-mode";
import { useTraceSearch, useTraceStats, useTraceStatus, type TraceFilter } from "@/hooks/use-traces";
import { cn } from "@/lib/utils";
import { ageSeconds } from "@/pages/resources/GenericList";
import { StatsTable } from "./StatsTable";
import { TraceDrawer } from "./TraceDrawer";
import { ago, clockTime, fmtMs, fmtPercent, fmtRate } from "./trace-format";

const FILTERS: { id: TraceFilter; label: string }[] = [
  { id: "all", label: "Recent" },
  { id: "errors", label: "Failed" },
  { id: "slow", label: "Slow" },
];
const DURATION = /^\d+(\.\d+)?(ms|s|m)$/;

/** Shown instead of traces when tracing is off or the cluster is unknown. */
export function TracingUnavailable({ message, configured }: { message?: string; configured: boolean }) {
  const { features } = useServerMode();
  return (
    <div className="mx-auto max-w-lg px-6 py-12 text-center">
      <Waypoints className="mx-auto mb-3 h-8 w-8 text-primary" />
      <p className="text-sm font-medium">{configured ? "Traces are not available here" : "Tracing is not set up"}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {message || (configured ? "" : "Connect Grafana Tempo to see requests across services, where they fail and where the time goes.")}
      </p>
      {features.settingsEdit ? (
        <Link href="/settings?section=observability" className="mt-4 inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium hover:border-primary/40">
          Open Settings → Observability
        </Link>
      ) : (
        !configured && <p className="mt-3 text-xs text-muted-foreground">An administrator sets <code className="font-mono">KUBEDECK_TEMPO_URL</code> on this KubeDeck.</p>
      )}
    </div>
  );
}

/**
 * A namespace whose apps send no traces would otherwise look like a quiet hour: say so, and offer the
 * namespaces of this cluster that do send them.
 */
function NoTracesHere({ namespace, cluster, traced, canSwitch }: { namespace: string; cluster: string; traced: string[]; canSwitch: boolean }) {
  const { setNamespace } = useScope();
  return (
    <div className="mx-auto max-w-lg px-6 py-12 text-center">
      <Waypoints className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">{namespace} sends no traces</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Tempo has nothing from this namespace in cluster <span className="font-mono">{cluster}</span> over the last day. Its apps are
        not instrumented with OpenTelemetry, or their traces go somewhere else.
      </p>
      {canSwitch && traced.length > 0 && (
        <>
          <p className="mt-5 text-xs text-muted-foreground">Namespaces here that send traces</p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {traced.map((ns) => (
              <button key={ns} type="button" onClick={() => setNamespace(ns)} className="rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] hover:border-primary/40 hover:text-primary">
                {ns}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** "12/s · 0.3% errors · p95 31ms" for the whole scope. */
function Summary({ total }: { total: StatRow | null | undefined }) {
  if (!total) return null;
  const share = total.rate ? total.errorRate / total.rate : 0;
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
      <span><span className="font-semibold tabular-nums text-foreground">{fmtRate(total.rate)}</span> requests</span>
      <span className={cn(share >= 0.05 ? "font-semibold text-destructive" : share > 0 && "text-warning")}>
        <span className="tabular-nums">{fmtPercent(total.errorRate, total.rate)}</span> errors
      </span>
      {total.p95Ms !== null && <span>p95 <span className="tabular-nums text-foreground">{fmtMs(total.p95Ms)}</span></span>}
    </p>
  );
}

/**
 * A Deployment with traffic on two ReplicaSets is mid- or just-after a rollout: compare the newest
 * one with the rest. Hidden when only one version served requests in the window.
 */
function RolloutCheck({ context, namespace, name, since }: { context: string; namespace: string; name: string; since: TraceSince }) {
  const versions = useTraceStats({ context, namespace, since, by: "version", kind: "deployment", name });
  const several = (versions.data?.rows.length ?? 0) > 1;
  const sets = useGenericList(several ? "replicasets" : "", context, namespace);
  const verdict = useMemo(() => {
    const rows = versions.data?.rows ?? [];
    if (rows.length < 2 || !sets.data) return null;
    const cols = sets.data.columns;
    const age = new Map(sets.data.rows.map((r) => [r[cols.indexOf("NAME")], ageSeconds(r[cols.indexOf("AGE")] ?? "") ?? Infinity]));
    const sorted = [...rows].sort((a, b) => (age.get(a.key) ?? Infinity) - (age.get(b.key) ?? Infinity));
    const [now, ...before] = sorted;
    const old = before.reduce((acc, r) => ({ rate: acc.rate + r.rate, errorRate: acc.errorRate + r.errorRate, p95Ms: Math.max(acc.p95Ms, r.p95Ms ?? 0) }), { rate: 0, errorRate: 0, p95Ms: 0 });
    const share = (r: { rate: number; errorRate: number }) => (r.rate ? r.errorRate / r.rate : 0);
    const moreErrors = share(now) > share(old) + 0.01 && share(now) > share(old) * 1.5;
    const slower = (now.p95Ms ?? 0) > old.p95Ms * 1.3 && (now.p95Ms ?? 0) - old.p95Ms > 20;
    return { now, old, ageNow: age.get(now.key), moreErrors, slower };
  }, [versions.data, sets.data]);
  if (!verdict) return null;
  const { now, old, ageNow, moreErrors, slower } = verdict;
  const hash = (rs: string) => rs.slice(name.length + 1) || rs;
  const bad = moreErrors || slower;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs", bad ? "border-destructive/40 bg-destructive/[0.05]" : "border-border bg-secondary/30")}>
      <span className={cn("flex items-center gap-1.5 font-semibold", bad ? "text-destructive" : "text-success")}>
        {bad ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        {moreErrors && slower ? "New version fails more and is slower" : moreErrors ? "New version fails more" : slower ? "New version is slower" : "New version looks no worse"}
      </span>
      <span className="text-muted-foreground">
        new <span className="font-mono text-foreground">{hash(now.key)}</span>{ageNow !== undefined && Number.isFinite(ageNow) ? ` (${ago(Date.now() - ageNow * 1000)})` : ""}:{" "}
        {fmtPercent(now.errorRate, now.rate)} errors · p95 {now.p95Ms === null ? "–" : fmtMs(now.p95Ms)}
      </span>
      <span className="text-muted-foreground">before: {fmtPercent(old.errorRate, old.rate)} errors · p95 {fmtMs(old.p95Ms)}</span>
    </div>
  );
}

/**
 * Traces for a namespace (grouped by service) or one workload (grouped by endpoint): the groups on the
 * left with requests, errors and p95; their traces on the right; one trace in a drawer. Everything
 * chosen lives in the URL, so a view can be shared.
 */
export function TraceExplorer({ context, namespace, kind, name, className }: {
  context: string;
  namespace: string;
  kind?: TraceWorkloadKind;
  name?: string;
  className?: string;
}) {
  const { get, set, setMany } = useHashParams();
  const by = kind ? "endpoint" : "service";
  const filter = (["all", "errors", "slow"].includes(get("tfilter") ?? "") ? get("tfilter") : "all") as TraceFilter;
  const since = ((TRACE_SINCE as readonly string[]).includes(get("tsince") ?? "") ? get("tsince") : "1h") as TraceSince;
  const minDuration = DURATION.test(get("tmin") ?? "") ? get("tmin")! : "1s";
  const picked = get("tsel");
  const open = get("trace");

  const status = useTraceStatus(context, namespace);
  const ready = !!status.data?.configured && !!status.data.cluster;
  const traced = status.data?.tracedNamespaces;
  const silent = !!traced && !!namespace && namespace !== "all" && !traced.includes(namespace);
  const stats = useTraceStats({ context, namespace, since, by, kind, name }, ready && !silent);
  // a picked service narrows the traces to it; a picked endpoint narrows by span name
  const scope = by === "service" && picked ? { kind: "service" as const, name: picked } : { kind, name };
  const search = useTraceSearch({ context, namespace, ...scope, filter, since, entryOnly: true, minDuration, span: by === "endpoint" ? picked ?? undefined : undefined }, ready && !silent);

  if (status.isLoading) return <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking tracing…</p>;
  if (!ready) return <TracingUnavailable configured={!!status.data?.configured} message={status.data?.message ?? status.error?.message} />;

  if (silent) return <NoTracesHere namespace={namespace} cluster={status.data!.cluster!} traced={traced!} canSwitch={!kind} />;

  const slow = (row: StatRow) => setMany({ tsel: row.key, tfilter: "slow", tmin: `${Math.max(1, Math.floor(row.p95Ms ?? 1000))}ms` });

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Summary total={stats.data?.total} />
        <select
          value={since}
          onChange={(e) => set("tsince", e.target.value === "1h" ? null : e.target.value)}
          aria-label="Time range"
          title={`Tempo cluster ${status.data!.cluster}`}
          className="ml-auto h-7 rounded-md border border-border bg-background px-1.5 text-xs"
        >
          {TRACE_SINCE.map((s) => <option key={s} value={s}>Last {s}</option>)}
        </select>
      </div>

      {kind === "deployment" && name && <RolloutCheck context={context} namespace={namespace} name={name} since={since} />}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section className="flex min-h-[12rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StatsTable
              title={by === "service" ? "Service" : "Endpoint"}
              rows={stats.data?.rows}
              loading={stats.isLoading}
              error={stats.error?.message}
              selected={picked}
              onSelect={(key) => setMany({ tsel: key, tmin: null })}
              onSlow={slow}
              dot={by === "service"}
            />
          </div>
          {stats.data && stats.data.since !== since && (
            <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">Measured over the last {stats.data.since}, the longest Tempo allows.</p>
          )}
        </section>

        <section className="flex min-h-[16rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
            <div role="radiogroup" aria-label="Which traces" className="flex items-center gap-0.5 rounded-md bg-secondary/50 p-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={filter === f.id}
                  onClick={() => setMany({ tfilter: f.id === "all" ? null : f.id, tmin: null })}
                  className={cn("rounded px-2 py-0.5 text-xs font-medium transition-colors", filter === f.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {f.id === "slow" && filter === "slow" ? `Slow ≥ ${minDuration}` : f.label}
                </button>
              ))}
            </div>
            {picked && (
              <button type="button" onClick={() => setMany({ tsel: null, tmin: null })} className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground" title="Show every one">
                <span className="truncate">{picked}</span><X className="h-3 w-3 shrink-0" />
              </button>
            )}
            {search.isFetching && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {search.isLoading ? (
              <p className="flex items-center gap-2 p-4 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Searching traces…</p>
            ) : search.isError ? (
              <p className="flex items-start gap-2 p-4 text-xs text-destructive"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{search.error.message}</p>
            ) : (search.data?.traces.length ?? 0) === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">
                {filter === "errors" ? "No failed requests" : filter === "slow" ? `Nothing slower than ${minDuration}` : "No traces"} in the last {since}.
              </p>
            ) : (
              <TraceRows traces={search.data!.traces} selected={open} onSelect={(id) => set("trace", id)} showService={by === "service" && !picked} />
            )}
          </div>
        </section>
      </div>

      <TraceDrawer traceId={open} context={context} grafanaTraceUrl={status.data!.grafanaTraceUrl} logs={!!status.data!.logs} onClose={() => set("trace", null)} />
    </div>
  );
}

function TraceRows({ traces, selected, onSelect, showService }: { traces: TraceSummary[]; selected: string | null; onSelect: (id: string) => void; showService: boolean }) {
  const max = useMemo(() => Math.max(...traces.map((t) => t.span?.durationMs ?? t.durationMs), 1), [traces]);
  return (
    <ul className="divide-y divide-border/40" aria-label="Traces">
      {traces.map((t) => {
        const ms = t.span?.durationMs ?? t.durationMs;
        const error = !!t.span?.error;
        const title = t.span?.name || t.rootName || "(unnamed)";
        const from = t.rootName && t.span && t.rootName !== t.span.name ? `from ${t.rootService}` : "";
        return (
          <li key={t.traceId}>
            <button
              type="button"
              onClick={() => onSelect(t.traceId)}
              aria-pressed={selected === t.traceId}
              className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)_auto_4.5rem] items-center gap-2.5 px-3 py-1.5 text-left text-xs hover:bg-primary/[0.04]", selected === t.traceId && "bg-primary/[0.08]")}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", error ? "bg-destructive" : "bg-success/70")} />
              <span className="min-w-0 truncate" title={`${title}${from ? ` · ${from}` : ""}`}>
                <span className={cn("font-medium", error && "text-destructive")}>{title}</span>
                {(showService || from) && <span className="text-muted-foreground"> · {showService ? t.rootService : from}</span>}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground" title={clockTime(t.start)}>{ago(t.start)}</span>
              <span className="relative flex h-4 items-center justify-end">
                <span className={cn("absolute left-0 h-1 rounded-full", error ? "bg-destructive/50" : "bg-primary/25")} style={{ width: `${Math.max((ms / max) * 100, 3)}%` }} />
                <span className="relative tabular-nums">{fmtMs(ms)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
