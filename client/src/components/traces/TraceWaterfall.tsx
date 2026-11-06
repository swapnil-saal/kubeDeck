import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Loader2, Maximize2, ScrollText, X } from "lucide-react";
import type { LogLine, TraceDetail, TraceSpan } from "@shared/traces";
import { CopyButton } from "@/components/CopyButton";
import { useLogHistory, useTrace } from "@/hooks/use-traces";
import { cn } from "@/lib/utils";
import { clockTime, fmtMs, grafanaLink, serviceColor, spanSummary, spanTree, visibleRows } from "./trace-format";

/** One trace: who called whom, how long each step took, and what failed. */
export function TraceWaterfall({ traceId, context, grafanaTraceUrl, logs = false, onClose, showOpenFull = true }: {
  traceId: string;
  context: string;
  grafanaTraceUrl?: string | null;
  /** Loki is set up: show the pod's log lines next to a span */
  logs?: boolean;
  onClose?: () => void;
  showOpenFull?: boolean;
}) {
  const trace = useTrace(traceId, context);
  if (trace.isLoading) {
    return <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading trace…</p>;
  }
  if (trace.isError || !trace.data) {
    return (
      <div className="p-6">
        <p className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4" />{trace.error?.message || "Could not load the trace."}</p>
        {onClose && <button type="button" onClick={onClose} className="mt-3 text-xs text-muted-foreground underline">Close</button>}
      </div>
    );
  }
  return <Waterfall trace={trace.data} context={context} grafanaTraceUrl={grafanaTraceUrl} logs={logs} onClose={onClose} showOpenFull={showOpenFull} />;
}

function Waterfall({ trace, context, grafanaTraceUrl, logs, onClose, showOpenFull }: {
  trace: TraceDetail;
  context: string;
  grafanaTraceUrl?: string | null;
  logs: boolean;
  onClose?: () => void;
  showOpenFull: boolean;
}) {
  const rows = useMemo(() => spanTree(trace.spans), [trace.spans]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const shown = useMemo(() => visibleRows(rows, collapsed), [rows, collapsed]);
  // open on the first failure, which is usually what you came for
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setSelected(rows.find((r) => r.span.error)?.span.id ?? null); setCollapsed(new Set()); }, [trace.traceId, rows]);
  const span = selected ? trace.spans.find((s) => s.id === selected) : undefined;
  const total = Math.max(trace.durationMs, 0.001);
  const services = useMemo(() => {
    const m = new Map<string, { spans: number; errors: number }>();
    for (const s of trace.spans) {
      const e = m.get(s.service) ?? { spans: 0, errors: 0 };
      e.spans++;
      if (s.error) e.errors++;
      m.set(s.service, e);
    }
    return [...m].sort((a, b) => b[1].spans - a[1].spans);
  }, [trace.spans]);
  const errors = trace.spans.filter((s) => s.error).length;
  const grafana = grafanaLink(grafanaTraceUrl, trace.traceId);
  const toggle = (id: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-1.5 border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tabular-nums">{fmtMs(trace.durationMs)}</span>
          <span className="text-xs text-muted-foreground">
            {clockTime(trace.start)} · {trace.spans.length} spans
            {errors > 0 && <span className="font-medium text-destructive"> · {errors} failed</span>}
            {trace.hidden > 0 && <span title="Spans from namespaces you cannot list pods in"> · {trace.hidden} hidden</span>}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <CopyButton text={trace.traceId} title={`Copy trace id ${trace.traceId}`} className="px-1.5 font-mono text-[11px]">{trace.traceId.slice(0, 12)}…</CopyButton>
            {grafana && (
              <a href={grafana} target="_blank" rel="noreferrer" title="Open in Grafana" className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                <ExternalLink className="h-3 w-3" />Grafana
              </a>
            )}
            {showOpenFull && (
              <Link href={`/trace/${trace.traceId}?context=${encodeURIComponent(context)}`} className="inline-flex h-7 items-center rounded-md px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Open trace on its own page" title="Open on its own page">
                <Maximize2 className="h-3 w-3" />
              </Link>
            )}
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Close trace" className="inline-flex h-7 items-center rounded-md px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
            )}
          </div>
        </div>
        {services.length > 1 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {services.map(([name, v]) => (
              <span key={name} className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: serviceColor(name) }} />
                {name || "unknown"}
                {v.errors > 0 && <span className="tabular-nums text-destructive">{v.errors}✗</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] border-b border-border/60 px-4 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Span</span>
        <span className="relative h-3">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <span key={f} className="absolute top-0 tabular-nums normal-case" style={{ left: `${f * 100}%`, transform: f === 1 ? "translateX(-100%)" : f > 0 ? "translateX(-50%)" : undefined }}>
              {fmtMs(total * f)}
            </span>
          ))}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" role="tree" aria-label="Spans">
        {shown.map(({ span: s, depth, childCount }) => {
          const left = (s.offsetMs / total) * 100;
          const width = Math.max((s.durationMs / total) * 100, 0.3);
          const isOpen = !collapsed.has(s.id);
          const on = s.id === selected;
          return (
            <div
              key={s.id}
              role="treeitem"
              aria-selected={on}
              aria-expanded={childCount ? isOpen : undefined}
              tabIndex={0}
              onClick={() => setSelected(on ? null : s.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(on ? null : s.id); } }}
              className={cn(
                "grid cursor-pointer grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center px-4 py-[3px] text-xs outline-none hover:bg-primary/[0.04] focus-visible:bg-primary/[0.06]",
                on && "bg-primary/[0.08]",
                s.error && "text-destructive",
              )}
            >
              <span className="flex min-w-0 items-center gap-1" style={{ paddingLeft: Math.min(depth, 14) * 12 }}>
                {childCount ? (
                  <button type="button" onClick={(e) => { e.stopPropagation(); toggle(s.id); }} aria-label={isOpen ? "Collapse" : "Expand"} className="shrink-0 rounded text-muted-foreground hover:text-foreground">
                    {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                ) : <span className="w-3 shrink-0" />}
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: serviceColor(s.service) }} title={s.service} />
                <span className="truncate" title={`${s.service}: ${s.name}`}>
                  <span className={cn("text-muted-foreground", s.error && "text-destructive/80")}>{s.service} </span>
                  <span className="font-medium">{s.name}</span>
                </span>
                {s.error && <AlertTriangle className="h-3 w-3 shrink-0" />}
                {!isOpen && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">+{childCount}</span>}
              </span>
              <span className="relative h-4">
                <span
                  className={cn("absolute top-1 h-2 rounded-sm", s.error && "ring-1 ring-destructive")}
                  style={{ left: `${left}%`, width: `${width}%`, background: s.error ? "hsl(var(--destructive))" : serviceColor(s.service) }}
                />
                <span
                  className={cn(
                    "absolute top-0 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground",
                    // a bar that reaches the right edge carries its label inside, on a chip
                    left + width > 80 && left < 20 && "rounded bg-card/90 px-1 leading-4 text-foreground",
                  )}
                  style={left + width <= 80 ? { left: `calc(${left + width}% + 4px)` } : left >= 20 ? { right: `calc(${100 - left}% + 4px)` } : { right: `calc(${100 - left - width}% + 2px)` }}
                >
                  {fmtMs(s.durationMs)}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {span && <SpanDetail span={span} traceStart={trace.start} context={context} logs={logs} onClose={() => setSelected(null)} />}
    </div>
  );
}

const HIDDEN_ATTRS = /^(resource\.(telemetry\.|process\.|host\.|os\.|otel\.|span\.metrics|service\.instance)|span\.metrics\.)/;

/** What the span's pod logged while it ran (±3s), from Loki: often the exception the span itself lacks. */
function SpanLogs({ span, traceStart, context }: { span: TraceSpan; traceStart: number; context: string }) {
  const at = traceStart + span.offsetMs;
  const history = useLogHistory({ context, namespace: span.namespace, pod: span.pod, start: at - 3000, end: at + span.durationMs + 3000, limit: 200 });
  const lines = history.data?.lines ?? [];
  const looksBad = (l: LogLine) => /^(error|critical|fatal)$/i.test(l.level) || /\b(error|exception|traceback|fatal|panic)\b/i.test(l.line);
  return (
    <div>
      <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
        Logs of {span.pod} at this time
        {history.isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
      </p>
      {history.isError ? (
        <p className="text-[11px] text-destructive">{history.error.message}</p>
      ) : !history.isLoading && lines.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Nothing logged within 3 seconds of this span.</p>
      ) : (
        <pre className="max-h-56 overflow-auto rounded-md border border-border bg-surface-inset p-2 font-mono text-[10.5px] leading-relaxed">
          {lines.map((l, i) => (
            <div key={i} className={cn("whitespace-pre-wrap break-all", looksBad(l) && "text-destructive")}>
              <span className="select-none text-muted-foreground">{clockTime(l.ts)} </span>{l.line}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

function SpanDetail({ span, traceStart, context, logs, onClose }: { span: TraceSpan; traceStart: number; context: string; logs: boolean; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const attrs = Object.entries(span.attributes).filter(([k, v]) => v !== "" && (all || !HIDDEN_ATTRS.test(k))).sort(([a], [b]) => (a.startsWith("resource.") ? 1 : 0) - (b.startsWith("resource.") ? 1 : 0) || a.localeCompare(b));
  const exceptions = span.events.filter((e) => e.name === "exception");
  const summary = spanSummary(span);
  return (
    <div className="max-h-[55%] shrink-0 overflow-y-auto border-t border-border bg-card/60">
      <div className="sticky top-0 flex items-start gap-2 border-b border-border/60 bg-card px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-semibold", span.error && "text-destructive")}>{span.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {span.service}{span.namespace ? ` · ${span.namespace}` : ""}{span.kind ? ` · ${span.kind}` : ""} · {fmtMs(span.durationMs)} at +{fmtMs(span.offsetMs)}{summary ? ` · ${summary}` : ""}
          </p>
        </div>
        {span.pod && span.namespace && (
          <Link
            href={`/resource/pod/${encodeURIComponent(span.pod)}?context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(span.namespace)}&tab=logs`}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            title={`Logs of ${span.pod}`}
          >
            <ScrollText className="h-3 w-3" />Pod logs
          </Link>
        )}
        <button type="button" onClick={onClose} aria-label="Close span" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="space-y-3 px-4 py-3">
        {(span.statusMessage || exceptions.length > 0) && (
          <div className="space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/[0.06] p-2.5 text-xs">
            {span.statusMessage && <p className="font-medium text-destructive">{span.statusMessage}</p>}
            {exceptions.map((e, i) => (
              <div key={i}>
                <p className="font-medium text-destructive">{e.attributes["exception.type"]}: {e.attributes["exception.message"]}</p>
                {e.attributes["exception.stacktrace"] && (
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">{e.attributes["exception.stacktrace"]}</pre>
                )}
              </div>
            ))}
          </div>
        )}
        {logs && span.pod && span.namespace && <SpanLogs span={span} traceStart={traceStart} context={context} />}
        <table className="w-full text-[11px]">
          <tbody>
            {attrs.map(([k, v]) => (
              <tr key={k} className="align-top">
                <td className="w-[38%] py-0.5 pr-3 font-mono text-muted-foreground">{k}</td>
                <td className="break-all py-0.5 font-mono">{v}</td>
              </tr>
            ))}
            {span.pod && <tr className="align-top"><td className="py-0.5 pr-3 font-mono text-muted-foreground">pod</td><td className="py-0.5 font-mono">{span.pod}</td></tr>}
          </tbody>
        </table>
        <button type="button" onClick={() => setAll((v) => !v)} className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          {all ? "Hide host and SDK attributes" : "Show every attribute"}
        </button>
        {span.events.filter((e) => e.name !== "exception").length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Events</p>
            <ul className="space-y-0.5 text-[11px]">
              {span.events.filter((e) => e.name !== "exception").map((e, i) => (
                <li key={i} className="font-mono"><span className="text-muted-foreground">+{fmtMs(e.offsetMs)}</span> {e.name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
