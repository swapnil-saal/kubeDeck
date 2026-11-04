import type { FC, ReactNode } from "react";
import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import type { Issue, Severity } from "@/lib/cluster-health";
import { cn } from "@/lib/utils";

export const SEVERITY: Record<Severity, { icon: JSX.Element; pill: string; dot: string }> = {
  critical: { icon: <AlertOctagon className="h-4 w-4 text-destructive" />, pill: "bg-destructive/10 text-destructive ring-destructive/25", dot: "bg-destructive" },
  warning: { icon: <AlertTriangle className="h-4 w-4 text-warning" />, pill: "bg-warning/10 text-warning ring-warning/25", dot: "bg-warning" },
  info: { icon: <Info className="h-4 w-4 text-muted-foreground" />, pill: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground" },
};

/** A titled panel on the overview. */
export const Panel: FC<{ title: ReactNode; right?: ReactNode; className?: string; children: ReactNode }> = ({ title, right, className, children }) => (
  <section className={cn("rounded-2xl border border-border bg-card", className)}>
    <header className="flex min-h-11 items-center justify-between gap-3 border-b border-border/60 px-4 py-2">
      <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      {right}
    </header>
    {children}
  </section>
);

export function Meter({ pct, tone, label }: { pct: number; tone?: "good" | "warn" | "bad"; label: string }) {
  const color = tone === "bad" ? "bg-destructive" : tone === "warn" ? "bg-warning" : "bg-primary";
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
    </div>
  );
}

export const fmtCores = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} cores` : `${Math.round(m)}m`);
export const fmtMem = (mi: number) => (mi >= 1024 ? `${(mi / 1024).toFixed(1)} GiB` : `${Math.round(mi)} MiB`);

/** The pod or deployment an issue is about, when it has one. */
export function issueTarget(issue: Issue): { type: string; name: string; namespace: string } | null {
  if (issue.kind !== "pod" && issue.kind !== "deployment") return null;
  const [ns, name] = issue.id.replace(/^[a-z]+:/, "").split("/");
  return name ? { type: issue.kind, name, namespace: ns } : null;
}

export const relTime = (ms: number, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};
