import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  AlertTriangle, Activity, CheckCircle2, Info, Loader2, LayoutDashboard,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useTheme } from "next-themes";
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

/** Fixed high-contrast palette (SVG ignores CSS variables; never use hsl(var(--…))). */
const CHART_COLORS = [
  "#4FD1D9", // brand cyan — high visibility on dark
  "#34D399", // emerald
  "#FBBF24", // amber
  "#F87171", // red
  "#A78BFA", // violet
  "#60A5FA", // blue
  "#F472B6", // pink
  "#2DD4BF", // teal
];

const AXIS_DARK = {
  tick: "#B8C0CC",
  grid: "rgba(184, 192, 204, 0.18)",
  tooltipBg: "#1a1f28",
  tooltipBorder: "rgba(184, 192, 204, 0.25)",
  tooltipText: "#F2F4F7",
  tooltipShadow: "0 8px 24px rgba(0,0,0,0.45)",
  cursor: "rgba(79, 209, 217, 0.12)",
  sliceStroke: "rgba(0,0,0,0.35)",
};

const AXIS_LIGHT: typeof AXIS_DARK = {
  tick: "#52525B",
  grid: "rgba(82, 82, 91, 0.16)",
  tooltipBg: "#FFFFFF",
  tooltipBorder: "rgba(24, 24, 27, 0.12)",
  tooltipText: "#18181B",
  tooltipShadow: "0 8px 24px rgba(24,24,27,0.12)",
  cursor: "rgba(17, 130, 140, 0.10)",
  sliceStroke: "rgba(255,255,255,0.9)",
};

/** Axis/tooltip colors for the active theme (SVG attributes need literal colors). */
function useChartAxis() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "light" ? AXIS_LIGHT : AXIS_DARK;
}

/**
 * Coerce chart values so bars render even when the model sends "507Mi" / "45m".
 * Returns numbers Recharts can plot.
 */
function toChartNumber(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  const s = v.trim().replace(/,/g, "");
  if (!s) return 0;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);

  // CPU millicores: 112m, 1.5m
  const milli = s.match(/^(-?[\d.]+)m$/i);
  if (milli) return parseFloat(milli[1]);

  // Memory binary units
  const bin = s.match(/^(-?[\d.]+)\s*(Ki|Mi|Gi|Ti|Pi)$/i);
  if (bin) {
    const n = parseFloat(bin[1]);
    const u = bin[2].toLowerCase();
    const mult: Record<string, number> = {
      ki: 1 / 1024,
      mi: 1,
      gi: 1024,
      ti: 1024 * 1024,
      pi: 1024 * 1024 * 1024,
    };
    return n * (mult[u] ?? 1);
  }

  // SI-ish: 120M, 1.2G (treat as Mi-ish scale for relative bars)
  const si = s.match(/^(-?[\d.]+)\s*([KMGTP])i?$/i);
  if (si) {
    const n = parseFloat(si[1]);
    const u = si[2].toUpperCase();
    const mult: Record<string, number> = { K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024, P: 1024 * 1024 * 1024 };
    return n * (mult[u] ?? 1);
  }

  const loose = parseFloat(s);
  return Number.isFinite(loose) ? loose : 0;
}

function shortLabel(s: string, max = 14): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function normalizeChartRows(
  chart: DashboardChart,
  xKey: string,
): { data: Record<string, string | number>[]; seriesKeys: string[] } {
  let seriesKeys = (chart.series?.length ? chart.series.map((s) => s.key) : []).filter(Boolean);

  const raw = (chart.data || []).map((row) => {
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === xKey || k === "name" || k === "label") {
        out[k] = v == null ? "" : String(v);
      } else {
        out[k] = toChartNumber(v);
      }
    }
    // ensure xKey present
    if (out[xKey] == null) {
      out[xKey] = String(row.name ?? row.label ?? "");
    }
    return out;
  });

  // If model series keys miss numeric fields, pick numeric keys from first row
  if (raw.length > 0) {
    const sample = raw[0];
    const numericKeys = Object.keys(sample).filter(
      (k) => k !== xKey && k !== "name" && k !== "label" && typeof sample[k] === "number",
    );
    const seriesHaveData = seriesKeys.some((k) =>
      raw.some((r) => typeof r[k] === "number" && Number(r[k]) !== 0),
    );
    if (!seriesKeys.length || !seriesHaveData) {
      seriesKeys = numericKeys.length ? numericKeys.slice(0, 4) : seriesKeys;
    }
  }

  if (!seriesKeys.length) seriesKeys = ["value"];

  // Guarantee series keys exist on every row
  for (const row of raw) {
    for (const k of seriesKeys) {
      if (row[k] == null) row[k] = 0;
      else if (typeof row[k] !== "number") row[k] = toChartNumber(row[k]);
    }
  }

  return { data: raw, seriesKeys };
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string | number }>;
  label?: string | number;
}) {
  const AXIS = useChartAxis();
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: AXIS.tooltipBg,
        border: `1px solid ${AXIS.tooltipBorder}`,
        borderRadius: 10,
        padding: "8px 10px",
        fontSize: 11,
        color: AXIS.tooltipText,
        boxShadow: AXIS.tooltipShadow,
        maxWidth: 280,
      }}
    >
      {label != null && label !== "" && (
        <div style={{ fontWeight: 600, marginBottom: 4, color: AXIS.tooltipText, wordBreak: "break-all" }}>
          {String(label)}
        </div>
      )}
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: p.color || CHART_COLORS[i % CHART_COLORS.length],
              flexShrink: 0,
            }}
          />
          <span style={{ color: AXIS.tick }}>{p.name || p.dataKey}</span>
          <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
            {p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function MiniChart({ chart }: { chart: DashboardChart }) {
  const AXIS = useChartAxis();
  const xKey = chart.xKey || "name";
  const { data, seriesKeys } = normalizeChartRows(chart, xKey);
  const seriesMeta = seriesKeys.map((key) => {
    const declared = chart.series?.find((s) => s.key === key);
    return { key, label: declared?.label || key };
  });

  if (!data.length) {
    return (
      <div className="h-44 flex items-center justify-center text-[11px] text-muted-foreground">
        No chart data
      </div>
    );
  }

  if (chart.type === "pie") {
    const valueKey = seriesKeys[0] || "value";
    const pieData = data.map((d) => ({
      name: String(d[xKey] ?? ""),
      value: Math.max(0, Number(d[valueKey] ?? 0)),
    }));
    const total = pieData.reduce((s, d) => s + d.value, 0);
    return (
      <div className="h-48 w-full">
        {chart.title && (
          <div className="text-[11px] font-semibold text-foreground/80 mb-1.5 px-0.5">
            {chart.title}
          </div>
        )}
        <ResponsiveContainer width="100%" height="88%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius={40}
              outerRadius={68}
              paddingAngle={2}
              stroke={AXIS.sliceStroke}
              strokeWidth={1}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {total === 0 && (
          <div className="text-[10px] text-muted-foreground text-center -mt-2">All zeros</div>
        )}
      </div>
    );
  }

  // Multi-color single-series bars when one series (rankings)
  const colorPerBar = seriesKeys.length === 1 && chart.type === "bar";

  const ChartEl = chart.type === "line" ? LineChart : chart.type === "area" ? AreaChart : BarChart;

  return (
    <div className="h-52 w-full">
      {chart.title && (
        <div className="text-[11px] font-semibold text-foreground/80 mb-1.5 px-0.5">
          {chart.title}
        </div>
      )}
      <ResponsiveContainer width="100%" height="88%">
        <ChartEl data={data} margin={{ top: 8, right: 10, left: 4, bottom: 28 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={AXIS.grid} vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={{ fill: AXIS.tick, fontSize: 10, fontWeight: 500 }}
            axisLine={{ stroke: AXIS.grid }}
            tickLine={false}
            interval={0}
            angle={data.length > 4 ? -28 : 0}
            textAnchor={data.length > 4 ? "end" : "middle"}
            height={data.length > 4 ? 48 : 28}
            tickFormatter={(v) => shortLabel(String(v), data.length > 5 ? 10 : 14)}
          />
          <YAxis
            tick={{ fill: AXIS.tick, fontSize: 10, fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
            width={40}
            allowDecimals
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: AXIS.cursor }}
          />
          {seriesMeta.map((s, i) => {
            const color = CHART_COLORS[i % CHART_COLORS.length];
            if (chart.type === "line") {
              return (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={color}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: color, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              );
            }
            if (chart.type === "area") {
              return (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.35}
                  strokeWidth={2.5}
                />
              );
            }
            return (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={color}
                radius={[5, 5, 0, 0]}
                maxBarSize={48}
                minPointSize={3}
              >
                {colorPerBar &&
                  data.map((_, idx) => (
                    <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                  ))}
              </Bar>
            );
          })}
        </ChartEl>
      </ResponsiveContainer>
    </div>
  );
}

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
            <div key={i} className="rounded-lg border border-border/80 bg-[hsl(220_16%_10%)] p-2.5">
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
