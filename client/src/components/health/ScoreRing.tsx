import type { FC } from "react";
import { cn } from "@/lib/utils";

export function scoreTone(score: number) {
  if (score >= 90) return { stroke: "stroke-emerald-500", text: "text-emerald-500", label: "Healthy" };
  if (score >= 70) return { stroke: "stroke-amber-500", text: "text-amber-500", label: "Degraded" };
  return { stroke: "stroke-destructive", text: "text-destructive", label: "Unhealthy" };
}

/** Circular 0–100 health score. `null` renders an empty "unknown" ring — never a made-up number. */
export const ScoreRing: FC<{ score: number | null; size?: number; className?: string }> = ({ score, size = 64, className }) => {
  const r = 24;
  const c = 2 * Math.PI * r;
  const tone = score === null ? null : scoreTone(score);
  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={score === null ? "Health unknown" : `Health score ${score} of 100`}
    >
      <svg viewBox="0 0 60 60" className="h-full w-full -rotate-90">
        <circle cx="30" cy="30" r={r} fill="none" strokeWidth="5" className="stroke-muted" strokeDasharray={score === null ? "3 5" : undefined} />
        {tone && score !== null && (
          <circle
            cx="30" cy="30" r={r} fill="none" strokeWidth="5" strokeLinecap="round"
            className={cn("transition-all duration-700", tone.stroke)}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - score / 100)}
          />
        )}
      </svg>
      <span
        className={cn("absolute inset-0 flex items-center justify-center font-bold tabular-nums", tone?.text ?? "text-muted-foreground")}
        style={{ fontSize: size * 0.28 }}
      >
        {score === null ? "?" : score}
      </span>
    </div>
  );
};
