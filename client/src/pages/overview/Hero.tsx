import { useState, type FC, type FormEvent } from "react";
import { Send, Sparkles, Zap } from "lucide-react";
import { ScoreRing, scoreTone } from "@/components/health/ScoreRing";
import type { ClusterHealth } from "@/lib/cluster-health";
import { cn } from "@/lib/utils";
import { StatTiles, type Tile } from "@/pages/dashboard/StatTiles";

export interface HeroSuggestion { label: string; prompt: string }

/** The verdict first: score, one sentence, the five numbers that matter, and a way to ask. */
export const Hero: FC<{
  scopeText: string;
  health: ClusterHealth;
  tiles: Tile[];
  suggestions: HeroSuggestion[];
  onAsk?: (prompt: string) => void;
}> = ({ scopeText, health, tiles, suggestions, onAsk }) => {
  const [question, setQuestion] = useState("");
  const tone = health.score === null ? null : scoreTone(health.score);
  const problems = health.issues.length;

  const verdict = health.score === null
    ? "Health unknown"
    : problems > 0
      ? `${problems} thing${problems === 1 ? "" : "s"} need${problems === 1 ? "s" : ""} attention`
      : health.flakyTotal > 0
        ? "Running, with restarts to watch"
        : "Everything is running";

  const summary = [
    `${health.pods.running + health.pods.done} of ${health.pods.total} pods up`,
    health.deployments.total > 0 && `${health.deployments.ready}/${health.deployments.total} deployments ready`,
    health.nodes.total > 0 && `${health.nodes.ready}/${health.nodes.total} nodes ready`,
    health.flakyTotal > 0 && `${health.flakyTotal} restart-heavy pod${health.flakyTotal === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setQuestion("");
    onAsk?.(q);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-5 p-5 xl:flex-row xl:items-center">
        <div className="flex items-center gap-4 xl:w-[22rem] xl:shrink-0">
          <ScoreRing score={health.score} size={84} />
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{scopeText}</p>
            <h1 className={cn("text-xl font-bold leading-tight tracking-tight", tone?.text ?? "text-muted-foreground")}>{verdict}</h1>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{summary}</p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <StatTiles tiles={tiles} compact />
        </div>
      </div>

      {onAsk && (
        <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/20 px-5 py-3 lg:flex-row lg:items-center">
          <form onSubmit={submit} className="focus-frame flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 py-1 focus-within:border-primary/50">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`Ask about ${scopeText}…`}
              aria-label={`Ask the assistant about ${scopeText}`}
              className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button type="submit" disabled={!question.trim()} aria-label="Ask" className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-30">
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => onAsk(s.prompt)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <Zap className="h-3 w-3 text-primary" />{s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
