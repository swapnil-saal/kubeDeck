import { useMemo, useState, type FC } from "react";
import { AlertTriangle, GitCommitHorizontal, PauseCircle, Scaling } from "lucide-react";
import type { Change, Issue } from "@/lib/cluster-health";
import { cn } from "@/lib/utils";
import { Panel, relTime } from "./parts";

type Filter = "all" | "changes" | "warnings";

interface Item {
  id: string;
  at: number;
  kind: "change" | "warning";
  icon: JSX.Element;
  title: string;
  detail: string;
  prompt: string;
}

/** What changed and what complained, on one timeline (newest first). */
export const ActivityFeed: FC<{ changes: Change[]; warnings: Issue[]; onAsk?: (prompt: string) => void }> = ({ changes, warnings, onAsk }) => {
  const [filter, setFilter] = useState<Filter>("all");

  const items = useMemo<Item[]>(() => {
    const out: Item[] = changes.map((c) => ({
      id: c.id,
      at: c.at,
      kind: "change",
      icon: c.kind === "scaled" ? <Scaling className="h-3.5 w-3.5" /> : c.kind === "stopped" ? <PauseCircle className="h-3.5 w-3.5" /> : <GitCommitHorizontal className="h-3.5 w-3.5" />,
      title: c.title,
      detail: `${c.kind === "rollout" ? "rolled out" : c.kind} · ${c.detail}`,
      prompt: c.prompt,
    }));
    for (const w of warnings) {
      out.push({
        id: w.id,
        at: w.at ?? 0,
        kind: "warning",
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        title: w.title,
        detail: `${w.reason} · ${w.meta.replace(/^\d+[smhd] ago · /, "")}`,
        prompt: w.prompt,
      });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [changes, warnings]);

  const shown = items.filter((i) => filter === "all" || (filter === "changes" ? i.kind === "change" : i.kind === "warning")).slice(0, 10);
  const count = (f: Filter) => (f === "all" ? items.length : items.filter((i) => (f === "changes" ? i.kind === "change" : i.kind === "warning")).length);

  return (
    <Panel
      title="Activity"
      right={
        <div role="tablist" aria-label="Show" className="flex gap-0.5 rounded-lg bg-muted/60 p-0.5 text-[11px] font-medium">
          {(["all", "changes", "warnings"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn("rounded-md px-2 py-0.5 capitalize", filter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {f} <span className="tabular-nums text-muted-foreground">{count(f)}</span>
            </button>
          ))}
        </div>
      }
    >
      {shown.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          {filter === "warnings" ? "No warning events in the last hour." : "Nothing rolled out, scaled or warned recently."}
        </p>
      ) : (
        <ol className="px-4 py-3">
          {shown.map((i, n) => (
            <li key={i.id} className="relative">
              {/* connector from this icon's centre to the next one's (icons are opaque and sit above it) */}
              {n < shown.length - 1 && <span aria-hidden className="absolute left-3 top-5 -bottom-5 w-px -translate-x-1/2 bg-border" />}
              <button
                type="button"
                disabled={!onAsk}
                onClick={() => onAsk?.(i.prompt)}
                title={onAsk ? "Ask the assistant about this" : undefined}
                className="group flex w-full items-start gap-3 rounded-lg py-1.5 pr-2 text-left disabled:cursor-default"
              >
                <span className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 rounded-full bg-card">
                  <span className={cn(
                    "flex h-full w-full items-center justify-center rounded-full",
                    i.kind === "warning" ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary",
                  )}>
                    {i.icon}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[13px] text-foreground group-enabled:group-hover:underline">{i.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{i.detail}</span>
                </span>
                <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">{i.at ? relTime(i.at) : ""}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
};
