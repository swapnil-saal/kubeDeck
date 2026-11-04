import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import type { DashboardChart } from "./types";

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

/** One chart from a dashboard payload. */
export function MiniChart({ chart }: { chart: DashboardChart }) {
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
