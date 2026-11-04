/** The present_dashboard tool's payload (validated on the server by `dashboardSchema`). */

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

/** The payload from the tool result, or from its input while the result is missing. */
export function parseDashboard(result: unknown, args: unknown): DashboardPayload | null {
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
