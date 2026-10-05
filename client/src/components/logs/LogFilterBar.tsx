import { useRef, useState, type FC } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, EyeOff, HelpCircle, Plus, Search, X, Zap } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Level, NoiseSuggestion, TopMessage } from "@shared/logs";
import { cn } from "@/lib/utils";

const LEVEL_CHIPS: { id: Level; label: string; cls: string; on: string }[] = [
  { id: "error", label: "Error", cls: "text-destructive", on: "bg-destructive/15 border-destructive/40" },
  { id: "warn", label: "Warn", cls: "text-amber-600 dark:text-amber-400", on: "bg-amber-500/15 border-amber-500/40" },
  { id: "info", label: "Info", cls: "text-sky-600 dark:text-sky-400", on: "bg-sky-500/15 border-sky-500/40" },
  { id: "debug", label: "Debug", cls: "text-muted-foreground", on: "bg-muted border-border" },
];

const EXAMPLES: [string, string][] = [
  ["timeout", "lines containing “timeout” (case-insensitive)"],
  ["timeout -healthcheck", "…but not health-check lines"],
  ['"request served"', "an exact phrase"],
  ["level:error,warn", "only errors and warnings"],
  ["pod:5584d", "one replica (part of the pod name)"],
  ["/user\\d+ (failed|denied)/", "a regular expression"],
];

export interface LogFilterBarProps {
  query: string;
  onQuery: (q: string) => void;
  queryError?: string;
  regex: boolean;
  onRegex: (v: boolean) => void;
  caseSensitive: boolean;
  onCase: (v: boolean) => void;
  context: number;
  onContext: (n: number) => void;
  matches: number;
  total: number;
  filtering: boolean;
  nav: { index: number; count: number; onPrev: () => void; onNext: () => void };
  levelCounts: Record<Level, number>;
  levels: Set<Level> | null;
  onToggleLevel: (l: Level) => void;
  hidden: string[];
  hiddenSuspended: boolean;
  hiddenCount: number;
  onRemoveHidden: (p: string) => void;
  onAddHidden: (p: string) => void;
  onSuspendHidden: (v: boolean) => void;
  noise: NoiseSuggestion | null;
  onAcceptNoise: (s: NoiseSuggestion) => void;
  onDismissNoise: (s: NoiseSuggestion) => void;
  problems: TopMessage[];
  onPickProblem: (p: TopMessage) => void;
  /** one slim line instead of stacked banners */
  compact: boolean;
}

const Toggle: FC<{ on: boolean; onClick: () => void; title: string; children: React.ReactNode }> = ({ on, onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    title={title}
    className={cn("h-7 min-w-7 rounded-md border px-1.5 font-mono text-[11px] font-semibold transition-colors", on ? "border-primary/50 bg-primary/15 text-primary" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground")}
  >
    {children}
  </button>
);

export const LogFilterBar: FC<LogFilterBarProps> = (p) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [showProblems, setShowProblems] = useState(false);
  const errTotal = p.levelCounts.error + p.levelCounts.fatal;

  const submitHidden = () => {
    const v = draft.trim();
    if (v) p.onAddHidden(v);
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="space-y-2 border-x border-border bg-card/60 px-3 py-2">
      {/* query */}
      <div className="flex flex-wrap items-center gap-2">
        <label className={cn("flex min-w-[16rem] flex-1 items-center gap-2 rounded-lg border bg-background px-2.5 focus-within:border-primary/50", p.queryError ? "border-destructive/50" : "border-border")}>
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); (e.shiftKey ? p.nav.onPrev : p.nav.onNext)(); }
              if (e.key === "Escape") p.onQuery("");
            }}
            placeholder="Filter — e.g.  timeout -healthcheck level:error"
            spellCheck={false}
            aria-label="Filter log lines"
            className="h-8 w-full bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:!outline-none"
          />
          {p.query && (
            <button type="button" onClick={() => { p.onQuery(""); inputRef.current?.focus(); }} aria-label="Clear filter" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          )}
        </label>

        <div className="flex items-center gap-0.5" role="group" aria-label="Filter options">
          <Toggle on={p.regex} onClick={() => p.onRegex(!p.regex)} title="Treat terms as regular expressions">.*</Toggle>
          <Toggle on={p.caseSensitive} onClick={() => p.onCase(!p.caseSensitive)} title="Match case">Aa</Toggle>
          <select
            value={p.context}
            onChange={(e) => p.onContext(Number(e.target.value))}
            aria-label="Context lines around each match"
            title="Show surrounding lines around each match"
            className="h-7 rounded-md border border-transparent bg-transparent px-1 text-[11px] text-muted-foreground hover:bg-muted focus-visible:border-primary/50"
          >
            <option value={0}>no context</option>
            <option value={2}>±2 lines</option>
            <option value={5}>±5 lines</option>
            <option value={10}>±10 lines</option>
          </select>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Filter syntax help" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><HelpCircle className="h-3.5 w-3.5" /></button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[22rem] p-3">
              <p className="mb-2 text-xs font-semibold text-foreground">Filter syntax</p>
              <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">Words are ANDed. Put <code className="rounded bg-muted px-1">-</code> in front to exclude.</p>
              <ul className="space-y-1.5">
                {EXAMPLES.map(([q, d]) => (
                  <li key={q} className="flex items-start gap-2 text-[11px]">
                    <button type="button" onClick={() => p.onQuery(q)} className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-foreground hover:bg-primary/15">{q}</button>
                    <span className="pt-0.5 text-muted-foreground">{d}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-muted-foreground">Click a field chip on a line to filter to it; Shift-click to hide it. Enter / Shift+Enter jump between matches.</p>
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
          {p.queryError ? (
            <span className="text-destructive" title={p.queryError}>invalid regex</span>
          ) : p.filtering ? (
            <>
              <span><b className="text-foreground">{p.matches.toLocaleString()}</b> of {p.total.toLocaleString()} lines</span>
              {p.matches > 0 && p.nav.count > 0 && (
                <span className="ml-1 flex items-center">
                  <span className="mr-0.5">{p.nav.index + 1}/{p.nav.count}</span>
                  <button type="button" onClick={p.nav.onPrev} aria-label="Previous match" className="rounded p-0.5 hover:bg-muted hover:text-foreground"><ChevronUp className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={p.nav.onNext} aria-label="Next match" className="rounded p-0.5 hover:bg-muted hover:text-foreground"><ChevronDown className="h-3.5 w-3.5" /></button>
                </span>
              )}
            </>
          ) : (
            <span>{p.total.toLocaleString()} lines</span>
          )}
        </div>
      </div>

      {/* levels + hidden patterns */}
      <div className="flex flex-wrap items-center gap-1.5">
        {LEVEL_CHIPS.map((c) => {
          const n = c.id === "error" ? errTotal : p.levelCounts[c.id];
          const on = p.levels?.has(c.id) ?? false;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => p.onToggleLevel(c.id)}
              aria-pressed={on}
              disabled={n === 0 && !on}
              className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-35", on ? c.on : "border-border hover:bg-muted", c.cls)}
            >
              {c.label}<span className="tabular-nums opacity-80">{n.toLocaleString()}</span>
            </button>
          );
        })}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden />

        {p.hidden.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => p.onSuspendHidden(!p.hiddenSuspended)}
              title={p.hiddenSuspended ? "Hide these lines again" : "Show the hidden lines for now"}
              className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors", p.hiddenSuspended ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border-border text-muted-foreground hover:bg-muted")}
            >
              <EyeOff className="h-3 w-3" />
              {p.hiddenSuspended ? "Hidden lines shown" : `${p.hiddenCount.toLocaleString()} hidden`}
            </button>
            {p.hidden.map((h) => (
              <span key={h} className={cn("inline-flex h-6 max-w-[16rem] items-center gap-1 rounded-full border border-border bg-muted/50 pl-2.5 pr-1 font-mono text-[10.5px] text-muted-foreground", p.hiddenSuspended && "opacity-50")}>
                <span className="truncate" title={h}>{h}</span>
                <button type="button" onClick={() => p.onRemoveHidden(h)} aria-label={`Stop hiding ${h}`} className="rounded-full p-0.5 hover:bg-muted hover:text-foreground"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </>
        )}
        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitHidden}
            onKeyDown={(e) => { if (e.key === "Enter") submitHidden(); if (e.key === "Escape") { setDraft(""); setAdding(false); } }}
            placeholder="text or /regex/ to hide"
            aria-label="Pattern to hide"
            className="h-6 w-44 rounded-full border border-primary/40 bg-background px-2.5 font-mono text-[11px] outline-none focus-visible:!outline-none"
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
            <Plus className="h-3 w-3" />Hide…
          </button>
        )}

        {p.problems.length > 0 && (
          <button type="button" onClick={() => setShowProblems((s) => !s)} aria-expanded={showProblems} className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            {p.problems.length} distinct problem{p.problems.length === 1 ? "" : "s"}
            {showProblems ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>

      {/* noise suggestion */}
      {p.noise && p.compact && (
        <div role="status" className="flex items-center gap-2 text-[11px]">
          <Zap className="h-3 w-3 shrink-0 text-primary" />
          <span className="min-w-0 truncate text-muted-foreground">
            <b className="text-foreground">{Math.round(p.noise.pct * 100)}%</b> of lines are <code className="rounded bg-muted px-1 font-mono">{p.noise.pattern.length > 48 ? p.noise.pattern.slice(0, 46) + "…" : p.noise.pattern}</code>
          </span>
          <button type="button" onClick={() => p.onAcceptNoise(p.noise!)} className="shrink-0 rounded bg-primary px-2 py-0.5 font-semibold text-primary-foreground hover:opacity-90">Hide</button>
          <button type="button" onClick={() => p.onDismissNoise(p.noise!)} aria-label="Dismiss suggestion" className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3 w-3" /></button>
        </div>
      )}
      {p.noise && !p.compact && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2 text-xs">
          <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 text-foreground">
            <b>{Math.round(p.noise.pct * 100)}%</b> of these lines ({p.noise.count.toLocaleString()}) are <code className="rounded bg-muted px-1 font-mono text-[11px]">{p.noise.pattern.length > 60 ? p.noise.pattern.slice(0, 58) + "…" : p.noise.pattern}</code>
            {p.noise.probe ? " — looks like a health check or probe." : " — a line that repeats constantly."}
          </span>
          <button type="button" onClick={() => p.onAcceptNoise(p.noise!)} className="rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-foreground hover:opacity-90">Hide them</button>
          <button type="button" onClick={() => p.onDismissNoise(p.noise!)} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">Not now</button>
        </div>
      )}

      {/* distinct problems */}
      {showProblems && p.problems.length > 0 && (
        <ul className="divide-y divide-border/50 rounded-lg border border-border bg-background/60">
          {p.problems.map((t) => (
            <li key={t.signature}>
              <button type="button" onClick={() => p.onPickProblem(t)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-muted/60" title="Filter to this problem">
                <span className={cn("shrink-0 rounded px-1 text-[9px] font-bold uppercase", t.level === "warn" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-destructive/15 text-destructive")}>{t.level === "warn" ? "warn" : "error"}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-foreground/85">{t.sample}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">×{t.count.toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
