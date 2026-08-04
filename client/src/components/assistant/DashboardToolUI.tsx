import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  AlertTriangle, Activity, CheckCircle2, Info, Loader2, LayoutDashboard,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";

export interface DashboardMetric {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}

export interface DashboardChart {
  type: "bar" | "line" | "area" | "pie";
  title?: string;
  xKey?: string;
  series: { key: string; label?: string }[];
  data: Record<string, string | number | null>[];
}

export interface DashboardIssue {
  severity: "critical" | "warning" | "info";
  title: string;
  detail?: string;
  resource?: string;
}

export interface DashboardTable {
  title?: string;
  columns: string[];
  rows: string[][];
}

export interface DashboardPayload {
  title: string;
  summary?: string;
  score?: number;
  metrics?: DashboardMetric[];
  charts?: DashboardChart[];
  issues?: DashboardIssue[];
  tables?: DashboardTable[];
}

const CHART_COLORS = [
  "hsl(184, 65%, 58%)", // brand cyan
  "hsl(160, 55%, 48%)",
  "hsl(38, 90%, 52%)",
  "hsl(0, 70%, 55%)",
  "hsl(250, 55%, 65%)",
  "hsl(200, 50%, 55%)",
];

function parseDashboard(result: unknown, args: unknown): DashboardPayload | null {
  const tryParse = (raw: unknown): DashboardPayload | null => {
    if (!raw) return null;
    if (typeof raw === "object" && raw !== null && "title" in (raw as object)) {
      return raw as DashboardPayload;
    }
    if (typeof raw === "string") {
      try {
        const j = JSON.parse(raw);
        if (j && typeof j === "object" && j.title) return j as DashboardPayload;
      } catch { /* ignore */ }
    }
    return null;
  };
  return tryParse(result) || tryParse(args);
}

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

function MiniChart({ chart }: { chart: DashboardChart }) {
  const xKey = chart.xKey || "name";
  const data = chart.data.map((row) => {
    const clean: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(row)) {
      clean[k] = v == null ? 0 : v;
    }
    return clean;
  });

  if (chart.type === "pie") {
    const valueKey = chart.series[0]?.key || "value";
    const pieData = data.map((d) => ({
      name: String(d[xKey] ?? d.name ?? ""),
      value: Number(d[valueKey] ?? 0),
    }));
    return (
      <div className="h-44 w-full">
        {chart.title && (
          <div className="text-[11px] font-semibold text-muted-foreground mb-1.5 px-0.5">
            {chart.title}
          </div>
        )}
        <ResponsiveContainer width="100%" height="90%">
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={36} outerRadius={62} paddingAngle={2}>
              {pieData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 11,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const ChartEl = chart.type === "line" ? LineChart : chart.type === "area" ? AreaChart : BarChart;

  return (
    <div className="h-48 w-full">
      {chart.title && (
        <div className="text-[11px] font-semibold text-muted-foreground mb-1.5 px-0.5">
          {chart.title}
        </div>
      )}
      <ResponsiveContainer width="100%" height="90%">
        <ChartEl data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 11,
              color: "hsl(var(--foreground))",
            }}
          />
          {chart.series.map((s, i) => {
            const color = CHART_COLORS[i % CHART_COLORS.length];
            if (chart.type === "line") {
              return (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label || s.key}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                />
              );
            }
            if (chart.type === "area") {
              return (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label || s.key}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              );
            }
            return (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label || s.key}
                fill={color}
                radius={[4, 4, 0, 0]}
              />
            );
          })}
        </ChartEl>
      </ResponsiveContainer>
    </div>
  );
}

function DashboardBoard({ data }: { data: DashboardPayload }) {
  return (
    <div className="my-2.5 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
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
            <div key={i} className="rounded-lg border border-border bg-background/50 p-2.5">
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
