import { AlertTriangle, Loader2 } from "lucide-react";
import type { StatRow } from "@shared/traces";
import { cn } from "@/lib/utils";
import { fmtMs, fmtPercent, fmtRate, serviceColor } from "./trace-format";

/**
 * Requests, errors and latency per service or endpoint. Clicking a row picks it; clicking its p95
 * opens requests at least that slow.
 */
export function StatsTable({ title, rows, loading, error, selected, onSelect, onSlow, dot }: {
  title: string;
  rows?: StatRow[];
  loading: boolean;
  error?: string;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onSlow: (row: StatRow) => void;
  /** a colour dot per row (services) */
  dot?: boolean;
}) {
  if (loading && !rows) return <p className="flex items-center gap-2 p-4 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Measuring…</p>;
  if (error) return <p className="flex items-start gap-2 p-4 text-xs text-destructive"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>;
  if (!rows?.length) return <p className="p-4 text-xs text-muted-foreground">No traced requests in this window.</p>;
  return (
    <table className="w-full table-fixed text-xs">
      <thead className="sticky top-0 bg-card">
        <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
          <th className="px-3 py-2 font-medium">{title}</th>
          <th className="w-16 px-2 py-2 text-right font-medium" title="Requests served and messages consumed">Req</th>
          <th className="w-16 px-2 py-2 text-right font-medium">Errors</th>
          <th className="w-16 px-3 py-2 text-right font-medium" title="Click to see requests at least this slow">p95</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/40">
        {rows.map((r) => {
          const on = selected === r.key;
          const share = r.rate ? r.errorRate / r.rate : 0;
          return (
            <tr key={r.key} className={cn("hover:bg-primary/[0.04]", on && "bg-primary/[0.08]")}>
              <td className="px-3 py-1.5">
                <button type="button" onClick={() => onSelect(on ? null : r.key)} aria-pressed={on} className="flex w-full min-w-0 items-center gap-2 text-left">
                  {dot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: serviceColor(r.key) }} />}
                  <span className={cn("truncate", on ? "font-semibold" : "font-medium")} title={r.key}>{r.key || "(no name)"}</span>
                </button>
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{fmtRate(r.rate)}</td>
              <td className={cn("px-2 py-1.5 text-right tabular-nums", share >= 0.05 ? "font-semibold text-destructive" : share > 0 ? "text-warning" : "text-muted-foreground/60")}>
                {fmtPercent(r.errorRate, r.rate)}
              </td>
              <td className="px-3 py-1.5 text-right">
                {r.p95Ms === null ? "–" : (
                  <button type="button" onClick={() => onSlow(r)} title="Requests at least this slow" className="tabular-nums underline-offset-2 hover:text-primary hover:underline">
                    {fmtMs(r.p95Ms)}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
