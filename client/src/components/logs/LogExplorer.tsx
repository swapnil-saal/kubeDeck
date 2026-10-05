import { useCallback, useDeferredValue, useEffect, useMemo, useState, type FC, type ReactNode } from "react";
import { Loader2, RefreshCw, ServerCrash, ShieldAlert, SearchX, X, Sparkles } from "lucide-react";
import { fetchAiSuggestion } from "@/ai";
import { useLogStream, type LogKind, type StreamSettings } from "@/hooks/use-log-stream";
import { hiddenKey, loadHidden, loadPrefs, saveHidden, savePrefs, type GlobalPrefs } from "@/lib/log-prefs";
import {
  applyFilter, compileExclude, countLevels, detectNoise, highlightRegex, parseQuery, podLabels, topProblems,
  type Level, type LogEntry, type NoiseSuggestion, type TopMessage,
} from "@shared/logs";
import { LogFilterBar } from "./LogFilterBar";
import { LogRows } from "./LogRows";
import { LogToolbar } from "./LogToolbar";

const KIND_LABEL: Record<LogKind, string> = {
  pod: "Pod", deployment: "Deployment", statefulset: "StatefulSet", daemonset: "DaemonSet",
  replicaset: "ReplicaSet", job: "Job", service: "Service",
};

/** Pods of the same app share their hide-patterns: `web-5d79ccfd54-abcde` -> `web`. */
export function appKey(kind: LogKind, name: string): string {
  return kind === "pod" ? name.replace(/-[a-z0-9]{6,10}-[a-z0-9]{5}$/, "").replace(/-[a-z0-9]{5}$/, "") : name;
}

const UNREACHABLE = /unable to connect|context deadline|i\/o timeout|connection refused|no route to host/i;

/** The text a user can see, one line each, for copy / download. */
export function visibleText(entries: LogEntry[], multiPod: boolean): string {
  return entries
    .map((e) => `${e.ts ? new Date(e.ts).toISOString() : ""} ${multiPod && e.source ? `[${e.source}] ` : ""}${e.raw}`.trim())
    .join("\n");
}

/** A phrase that finds this problem again: the message up to the first number/id. */
export function phraseFor(sample: string): string {
  const cut = sample.search(/[0-9]|[A-Za-z0-9_-]{16,}/);
  const head = (cut > 8 ? sample.slice(0, cut) : sample).trim();
  return head.length >= 8 ? head.slice(0, 60) : sample.slice(0, 60);
}

export interface LogExplorerProps {
  kind: LogKind;
  name: string;
  context: string;
  namespace: string;
  /** the filter box is kept in the page URL so a filtered view can be shared */
  query: string;
  onQueryChange: (q: string) => void;
  /** pods can jump to their workload's combined logs */
  workloadLink?: { label: string; onClick: () => void };
}

export const LogExplorer: FC<LogExplorerProps> = ({ kind, name, context, namespace, query, onQueryChange, workloadLink }) => {
  const [prefs, setPrefs] = useState<GlobalPrefs>(loadPrefs);
  const patchPrefs = useCallback((patch: Partial<GlobalPrefs>) => { setPrefs((p) => ({ ...p, ...patch })); savePrefs(patch); }, []);

  const [previous, setPrevious] = useState(false);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<LogEntry[] | null>(null);
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [context_, setContext] = useState(0);
  const [levels, setLevels] = useState<Set<Level> | null>(null);
  const [selectedPods, setSelectedPods] = useState<Set<string> | null>(null);
  const [container, setContainer] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [focus, setFocus] = useState(false);
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.innerHeight < 860);
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFocus(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  const settings: StreamSettings = useMemo(
    () => ({ tail: prefs.tail, since: prefs.since || undefined, previous, follow: !previous }),
    [prefs.tail, prefs.since, previous],
  );
  const { entries, pods, skipped, status, error, notes, reconnect, clear } = useLogStream({ kind, name, context, namespace }, settings);

  // always-hide patterns, remembered per app
  const hkey = hiddenKey(context, namespace, "app", appKey(kind, name));
  const [hidden, setHidden] = useState<string[]>(() => loadHidden(hkey));
  const [suspended, setSuspended] = useState(false);
  useEffect(() => { setHidden(loadHidden(hkey)); setSuspended(false); setDismissed(new Set()); }, [hkey]);
  const updateHidden = useCallback((next: string[]) => { setHidden(next); saveHidden(hkey, next); }, [hkey]);

  // reset view state that only makes sense for one stream
  useEffect(() => { setSelectedPods(null); setContainer(null); setPaused(false); setFrozen(null); setLevels(null); setSummary(null); }, [kind, name, context, namespace, previous]);
  useEffect(() => setActiveIdx(null), [query, regex, caseSensitive, levels]);

  const view = frozen ?? entries;
  const parsed = useMemo(() => parseQuery(query, { regex, caseSensitive }), [query, regex, caseSensitive]);
  const exclude = useMemo(
    () => (suspended ? [] : hidden.map(compileExclude).filter((m): m is NonNullable<typeof m> => m !== null)),
    [hidden, suspended],
  );
  const result = useMemo(
    () => applyFilter(view, { query: parsed, exclude, levels, sources: selectedPods, containers: container ? new Set([container]) : null, context: context_ }),
    [view, parsed, exclude, levels, selectedPods, container, context_],
  );
  const hiddenWhileSuspended = useMemo(
    () => (suspended ? applyFilter(view, { query: parseQuery("", { regex: false, caseSensitive: false }), exclude: hidden.map(compileExclude).filter((m): m is NonNullable<typeof m> => m !== null), levels: null, sources: null, context: 0 }).hiddenByExclude : result.hiddenByExclude),
    [suspended, view, hidden, result.hiddenByExclude],
  );

  const levelCounts = useMemo(() => countLevels(result.base), [result.base]);
  const deferredBase = useDeferredValue(result.base);
  const noise = useMemo<NoiseSuggestion | null>(() => {
    if (deferredBase.length < 30) return null;
    return detectNoise(deferredBase).find((n) => !dismissed.has(n.pattern) && !hidden.includes(n.pattern)) ?? null;
  }, [deferredBase, dismissed, hidden]);
  const problems = useMemo<TopMessage[]>(() => topProblems(deferredBase, 5), [deferredBase]);

  const filtering = !parsed.empty || levels !== null || !!parsed.error;
  const matchIds = useMemo(
    () => (filtering ? result.rows.flatMap((r) => (r.kind === "entry" && r.match ? [r.entry.id] : [])) : []),
    [filtering, result.rows],
  );
  const stepMatch = useCallback((dir: 1 | -1) => {
    if (matchIds.length === 0) return;
    setPaused(true);
    setActiveIdx((i) => (i === null ? (dir === 1 ? matchIds.length - 1 : 0) : (i + dir + matchIds.length) % matchIds.length));
  }, [matchIds.length]);

  const highlight = useMemo(() => highlightRegex(query, { regex, caseSensitive }), [query, regex, caseSensitive]);
  const labels = useMemo(() => podLabels(pods.map((x) => x.name), kind === "pod" ? undefined : name), [pods, kind, name]);
  const containers = useMemo(() => Array.from(new Set(pods.flatMap((p) => p.containers))), [pods]);
  const multiPod = kind !== "pod" && (pods.length > 1 || new Set(entries.map((e) => e.source)).size > 1);

  const jsonShare = entries.length > 0 ? entries.filter((e) => e.format === "json").length / entries.length : 0;
  const format: "pretty" | "raw" = prefs.format === "auto" ? (jsonShare > 0.5 ? "pretty" : "raw") : prefs.format;

  const togglePause = () => {
    if (paused) { setPaused(false); setFrozen(null); } else { setPaused(true); setFrozen(entries); }
  };
  const onScrolledUp = useCallback(() => { setPaused(true); setFrozen(entries); }, [entries]);
  const resume = useCallback(() => { setPaused(false); setFrozen(null); setActiveIdx(null); }, []);

  const hideLike = useCallback((e: LogEntry) => {
    const pathLike = e.fields && ["path", "url", "uri", "endpoint", "route"].map((k) => e.fields![k]).find((v): v is string => typeof v === "string");
    const pattern = pathLike ? pathLike.split("?")[0] : e.message.slice(0, 60);
    if (pattern && !hidden.includes(pattern)) updateHidden([...hidden, pattern]);
  }, [hidden, updateHidden]);

  const addTerm = useCallback((term: string, exclude_: boolean) => {
    const t = /\s/.test(term) ? `"${term}"` : term;
    const next = `${query.trim()} ${exclude_ ? "-" : ""}${t}`.trim();
    onQueryChange(next);
  }, [query, onQueryChange]);

  const toggleLevel = (l: Level) => {
    setLevels((cur) => {
      const group: Level[] = l === "error" ? ["error", "fatal"] : [l];
      const next = new Set(cur ?? []);
      const on = group.every((g) => next.has(g));
      group.forEach((g) => (on ? next.delete(g) : next.add(g)));
      return next.size === 0 ? null : next;
    });
  };

  const download = () => {
    const rows = result.rows.flatMap((r) => (r.kind === "entry" ? [r.entry] : []));
    const url = URL.createObjectURL(new Blob([visibleText(rows, multiPod)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-logs.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copyAll = () => {
    const rows = result.rows.flatMap((r) => (r.kind === "entry" ? [r.entry] : []));
    void navigator.clipboard?.writeText(visibleText(rows, multiPod)).catch(() => {});
  };

  const summarize = async () => {
    setSummarizing(true);
    setSummary(null);
    try {
      const base = result.base;
      const problemsFirst = base.filter((e) => e.level === "error" || e.level === "fatal" || e.level === "warn").slice(-50);
      const latest = base.slice(-70);
      const picked = Array.from(new Map([...problemsFirst, ...latest].map((e) => [e.id, e])).values()).sort((a, b) => a.id - b.id);
      const text = picked.map((e) => `${multiPod && e.source ? `[${e.source.slice(-12)}] ` : ""}${e.raw.slice(0, 280)}`).join("\n").slice(-7000);
      const out = await fetchAiSuggestion(
        `You are an SRE. These are recent logs from ${KIND_LABEL[kind].toLowerCase()} "${name}" (health checks already removed). ` +
        `In 4-6 short bullet points: what is happening, any errors and their likely root cause, and the single next step to take. Be specific; cite messages.\n\n${text}`,
        500,
      );
      setSummary(out);
    } catch (e) {
      setSummary(`Couldn't summarize: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSummarizing(false);
    }
  };

  // ── empty / error states ──
  let empty: ReactNode;
  if (error && entries.length === 0) {
    const unreachable = UNREACHABLE.test(error.message);
    const forbidden = error.reason === "forbidden";
    empty = (
      <div className="max-w-md text-center">
        <span className={`mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${forbidden ? "bg-amber-500/15 text-amber-500" : "bg-destructive/10 text-destructive"}`}>
          {forbidden ? <ShieldAlert className="h-5 w-5" /> : <ServerCrash className="h-5 w-5" />}
        </span>
        <p className="text-sm font-medium text-foreground">{unreachable ? "Can't reach the cluster" : forbidden ? "No permission to read these logs" : "Couldn't load logs"}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{unreachable ? "Check your VPN or network connection, then try again." : error.message}</p>
        <button type="button" onClick={reconnect} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"><RefreshCw className="h-3.5 w-3.5" />Try again</button>
      </div>
    );
  } else if (status === "connecting" && entries.length === 0) {
    empty = <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Connecting to {KIND_LABEL[kind].toLowerCase()} logs…</div>;
  } else if (entries.length === 0) {
    empty = (
      <div className="max-w-sm text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{previous ? "No previous container logs" : "No log output yet"}</p>
        <p className="mt-1 text-xs leading-relaxed">{previous ? "This container hasn't restarted, so there's no earlier instance to read." : settings.since ? `Nothing was logged in the selected time range. Try a longer one.` : "The container hasn't written anything. New lines will appear here as they arrive."}</p>
      </div>
    );
  } else {
    empty = (
      <div className="max-w-sm text-center">
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><SearchX className="h-5 w-5" /></span>
        <p className="text-sm font-medium text-foreground">No lines match</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{result.hiddenByExclude > 0 ? `${result.hiddenByExclude.toLocaleString()} lines are hidden by your hide patterns. ` : ""}Try a broader filter.</p>
        <div className="mt-3 flex justify-center gap-2">
          {filtering && <button type="button" onClick={() => { onQueryChange(""); setLevels(null); }} className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted">Clear filter</button>}
          {result.hiddenByExclude > 0 && !suspended && <button type="button" onClick={() => setSuspended(true)} className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted">Show hidden lines</button>}
        </div>
      </div>
    );
  }

  const activeId = activeIdx !== null ? matchIds[activeIdx] : undefined;

  return (
    <div className={focus ? "fixed inset-0 z-50 flex min-h-0 flex-col bg-background p-2" : "flex h-full min-h-0 flex-col"}>
      <LogToolbar
        focus={focus}
        onFocus={setFocus}
        compact={compact}
        onCompact={setCompact}
        kindLabel={KIND_LABEL[kind]}
        name={name}
        workload={kind === "pod" ? undefined : name}
        labels={labels}
        pods={pods}
        skipped={skipped}
        selectedPods={selectedPods}
        onSelectedPods={setSelectedPods}
        containers={containers}
        container={container}
        onContainer={setContainer}
        since={prefs.since}
        onSince={(v) => patchPrefs({ since: v })}
        tail={prefs.tail}
        onTail={(n) => patchPrefs({ tail: n })}
        previous={previous}
        onPrevious={setPrevious}
        canPrevious={pods.some((p) => p.restarts > 0)}
        status={status}
        paused={paused}
        onTogglePause={togglePause}
        newLines={frozen ? entries.length - frozen.length : 0}
        onReconnect={() => { setFrozen(null); setPaused(false); reconnect(); }}
        onClear={() => { clear(); setFrozen(null); }}
        onDownload={download}
        onCopy={copyAll}
        onSummarize={summarize}
        summarizing={summarizing}
        format={prefs.format}
        onFormat={(f) => patchPrefs({ format: f })}
        wrap={prefs.wrap}
        onWrap={(v) => patchPrefs({ wrap: v })}
        showTime={prefs.showTime}
        onShowTime={(v) => patchPrefs({ showTime: v })}
        workloadLink={workloadLink}
      />

      <LogFilterBar
        compact={compact}
        query={query}
        onQuery={onQueryChange}
        queryError={parsed.error}
        regex={regex}
        onRegex={setRegex}
        caseSensitive={caseSensitive}
        onCase={setCaseSensitive}
        context={context_}
        onContext={setContext}
        matches={result.matches}
        total={result.base.length}
        filtering={filtering}
        nav={{ index: activeIdx ?? 0, count: matchIds.length, onPrev: () => stepMatch(-1), onNext: () => stepMatch(1) }}
        levelCounts={levelCounts}
        levels={levels}
        onToggleLevel={toggleLevel}
        hidden={hidden}
        hiddenSuspended={suspended}
        hiddenCount={hiddenWhileSuspended}
        onRemoveHidden={(p) => updateHidden(hidden.filter((h) => h !== p))}
        onAddHidden={(p) => !hidden.includes(p) && updateHidden([...hidden, p])}
        onSuspendHidden={setSuspended}
        noise={noise}
        onAcceptNoise={(s) => updateHidden([...hidden, s.pattern])}
        onDismissNoise={(s) => setDismissed((d) => new Set(d).add(s.pattern))}
        problems={problems}
        onPickProblem={(t) => { onQueryChange(`"${phraseFor(t.sample)}"`); }}
      />

      {notes.length > 0 && !error && (
        <div className="border-x border-border bg-amber-500/[0.06] px-3 py-1 text-[11px] text-amber-700 dark:text-amber-400" title={notes.join("\n")}>
          {notes[notes.length - 1]}{notes.length > 1 ? `  (+${notes.length - 1} more)` : ""}
        </div>
      )}
      {error && entries.length > 0 && (
        <div role="alert" className="flex items-center gap-2 border-x border-border bg-destructive/[0.06] px-3 py-1.5 text-xs text-destructive">
          <ServerCrash className="h-3.5 w-3.5" />{error.message}
          <button type="button" onClick={reconnect} className="ml-auto rounded px-2 py-0.5 font-medium hover:bg-destructive/10">Reconnect</button>
        </div>
      )}
      {summary && (
        <div className="relative max-h-24 overflow-auto border-x border-border bg-primary/[0.05] px-3 py-2 text-xs">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 whitespace-pre-wrap leading-relaxed text-foreground/90">{summary}</p>
            <button type="button" onClick={() => setSummary(null)} aria-label="Dismiss summary" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}

      <LogRows
        rows={result.rows}
        format={format}
        wrap={prefs.wrap}
        showTime={prefs.showTime}
        multiPod={multiPod}
        workload={kind === "pod" ? undefined : name}
        labels={labels}
        highlight={highlight}
        follow={!paused}
        onScrolledUp={onScrolledUp}
        onResume={resume}
        activeId={activeId}
        onHide={hideLike}
        onTerm={addTerm}
        empty={empty}
      />
    </div>
  );
};
