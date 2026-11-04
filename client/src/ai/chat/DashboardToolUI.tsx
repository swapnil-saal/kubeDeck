import { makeAssistantToolUI } from "@assistant-ui/react";
import { AlertTriangle, Activity, CheckCircle2, Info, Loader2, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { MiniChart } from "./dashboard/DashboardChart";
import { parseDashboard, type DashboardIssue, type DashboardMetric, type DashboardPayload } from "./dashboard/types";

function toneClass(tone?: DashboardMetric["tone"]) {
  switch (tone) {
    case "good": return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
    case "warn": return "text-amber-400 border-amber-500/30 bg-amber-500/10";
    case "bad": return "text-red-400 border-red-500/30 bg-red-500/10";
    default: return "text-foreground border-border bg-muted/40";
  }
}

function scoreTone(score: number) {
  if (score >= 80) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

function severityIcon(sev: DashboardIssue["severity"]) {
  if (sev === "critical") return <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  if (sev === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  return <Info className="h-3.5 w-3.5 text-primary shrink-0" />;
}

function DashboardBoard({ data }: { data: DashboardPayload }) {
  return (
    <div className="my-2.5 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 px-3.5 py-3 border-b border-border">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <LayoutDashboard className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground tracking-tight">{data.title}</h3>
            {typeof data.score === "number" && (
              <span className={cn("text-xs font-bold tabular-nums", scoreTone(data.score))}>
                {Math.round(data.score)}/100
              </span>
            )}
          </div>
          {data.summary && (
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{data.summary}</p>
          )}
        </div>
        <Activity className="h-3.5 w-3.5 text-primary shrink-0 mt-1" />
      </div>

      {data.metrics && data.metrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 border-b border-border">
          {data.metrics.map((m, i) => (
            <div
              key={`${m.label}-${i}`}
              className={cn("rounded-lg border px-2.5 py-2", toneClass(m.tone))}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
                {m.label}
              </div>
              <div className="mt-0.5 text-lg font-bold tabular-nums leading-tight">
                {m.value}
                {m.unit ? <span className="text-[11px] font-medium ml-0.5 opacity-70">{m.unit}</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.charts && data.charts.length > 0 && (
        <div className={cn(
          "grid gap-3 p-3 border-b border-border",
          data.charts.length > 1 ? "sm:grid-cols-2" : "grid-cols-1",
        )}
        >
          {data.charts.map((c, i) => (
            <div key={i} className="rounded-lg border border-border/80 bg-muted/40 dark:bg-[hsl(220_16%_10%)] p-2.5">
              <MiniChart chart={c} />
            </div>
          ))}
        </div>
      )}

      {data.issues && data.issues.length > 0 && (
        <div className="p-3 border-b border-border space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Issues
          </div>
          {data.issues.map((iss, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs",
                iss.severity === "critical" && "border-red-500/30 bg-red-500/5",
                iss.severity === "warning" && "border-amber-500/30 bg-amber-500/5",
                iss.severity === "info" && "border-border bg-muted/30",
              )}
            >
              {severityIcon(iss.severity)}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-foreground">{iss.title}</div>
                {iss.detail && (
                  <div className="mt-0.5 text-muted-foreground leading-snug">{iss.detail}</div>
                )}
                {iss.resource && (
                  <code className="mt-1 inline-block text-[10px] font-mono text-primary/90">
                    {iss.resource}
                  </code>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.tables && data.tables.length > 0 && (
        <div className="p-3 space-y-3">
          {data.tables.map((t, ti) => (
            <div key={ti}>
              {t.title && (
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  {t.title}
                </div>
              )}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-muted/50 text-left">
                      {t.columns.map((c) => (
                        <th key={c} className="px-2.5 py-1.5 font-semibold text-muted-foreground whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((row, ri) => (
                      <tr key={ri} className="border-t border-border/60">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-2.5 py-1.5 text-foreground font-mono whitespace-nowrap">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const PresentDashboardToolUI = makeAssistantToolUI<DashboardPayload, string>({
  toolName: "present_dashboard",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <div className="my-2.5 flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          Building dashboard…
        </div>
      );
    }
    const data = parseDashboard(result, args);
    if (!data) {
      return (
        <div className="my-2.5 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <CheckCircle2 className="inline h-3.5 w-3.5 text-emerald-500 mr-1.5" />
          Dashboard ready
        </div>
      );
    }
    return <DashboardBoard data={data} />;
  },
});
