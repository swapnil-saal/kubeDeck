import type { FC } from "react";
import { Check, ChevronDown, Download, History, Layers, Loader2, Maximize2, Minimize2, Pause, Play, RefreshCw, SlidersHorizontal, Sparkles, Trash2, Copy } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { LogPod, StreamStatus } from "@/hooks/use-log-stream";
import { podColor, shortPod } from "@shared/logs";
import { cn } from "@/lib/utils";

const SINCE: { value: string; label: string }[] = [
  { value: "", label: "Latest lines" },
  { value: "5m", label: "Last 5 min" },
  { value: "15m", label: "Last 15 min" },
  { value: "1h", label: "Last hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
];
const TAILS = [200, 500, 1000, 2000, 5000];

const STATUS_UI: Record<StreamStatus | "paused", { label: string; dot: string; text: string }> = {
  idle: { label: "Idle", dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
  connecting: { label: "Connecting…", dot: "bg-amber-500 animate-pulse", text: "text-amber-600 dark:text-amber-400" },
  live: { label: "Live", dot: "bg-emerald-500 animate-pulse", text: "text-emerald-600 dark:text-emerald-400" },
  paused: { label: "Paused", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  ended: { label: "Snapshot", dot: "bg-muted-foreground/60", text: "text-muted-foreground" },
  error: { label: "Disconnected", dot: "bg-destructive", text: "text-destructive" },
};

const podStatusTone = (s: string) =>
  /^(CrashLoopBackOff|Error|ImagePullBackOff|ErrImagePull|OOMKilled|Failed|Evicted)$/.test(s) ? "text-destructive"
    : /^(Pending|ContainerCreating|PodInitializing|Terminating|Init:.*)$/.test(s) ? "text-amber-500"
    : "text-emerald-500";

export interface LogToolbarProps {
  kindLabel: string;
  name: string;
  workload?: string;
  labels: Map<string, string>;
  pods: LogPod[];
  skipped: string[];
  selectedPods: Set<string> | null;
  onSelectedPods: (s: Set<string> | null) => void;
  containers: string[];
  container: string | null;
  onContainer: (c: string | null) => void;
  since: string;
  onSince: (v: string) => void;
  tail: number;
  onTail: (n: number) => void;
  previous: boolean;
  onPrevious: (v: boolean) => void;
  canPrevious: boolean;
  status: StreamStatus;
  paused: boolean;
  onTogglePause: () => void;
  newLines: number;
  onReconnect: () => void;
  onClear: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onSummarize: () => void;
  summarizing: boolean;
  format: "auto" | "pretty" | "raw";
  onFormat: (f: "auto" | "pretty" | "raw") => void;
  wrap: boolean;
  onWrap: (v: boolean) => void;
  showTime: boolean;
  onShowTime: (v: boolean) => void;
  /** a pod view can jump to its owning workload's combined logs */
  workloadLink?: { label: string; onClick: () => void };
  focus: boolean;
  onFocus: (v: boolean) => void;
  compact: boolean;
  onCompact: (v: boolean) => void;
}

const Btn: FC<{ onClick?: () => void; title: string; disabled?: boolean; active?: boolean; children: React.ReactNode }> = ({ onClick, title, disabled, active, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    aria-pressed={active}
    className={cn("flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors disabled:opacity-40", active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
  >
    {children}
  </button>
);

const Select: FC<{ value: string | number; onChange: (v: string) => void; label: string; children: React.ReactNode }> = ({ value, onChange, label, children }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} title={label} className="h-8 rounded-md border border-border bg-background px-2 text-[11px] text-foreground hover:border-primary/40 focus-visible:border-primary/50">
    {children}
  </select>
);

export const LogToolbar: FC<LogToolbarProps> = (p) => {
  const multi = p.pods.length > 1;
  const selectedCount = p.selectedPods ? p.selectedPods.size : p.pods.length;
  const st = STATUS_UI[p.paused && p.status === "live" ? "paused" : p.status];

  const togglePod = (name: string) => {
    const cur = new Set(p.selectedPods ?? p.pods.map((x) => x.name));
    if (cur.has(name)) cur.delete(name); else cur.add(name);
    p.onSelectedPods(cur.size === p.pods.length ? null : cur);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-border bg-card px-3 py-2">
      <div className={cn("flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold", st.text)} role="status" aria-live="polite">
        <span className={cn("h-2 w-2 rounded-full", st.dot)} />{st.label}
        {p.paused && p.newLines > 0 && <span className="font-normal tabular-nums text-muted-foreground">+{p.newLines.toLocaleString()}</span>}
      </div>

      {multi && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:border-primary/40" aria-label="Choose pods">
              <Layers className="h-3.5 w-3.5 text-primary" />
              {selectedCount === p.pods.length ? `All ${p.pods.length} pods` : `${selectedCount} of ${p.pods.length} pods`}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[24rem] p-2" align="start">
            <div className="mb-1 flex items-center justify-between px-2 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pods · {p.name}</span>
              <span className="flex gap-2 text-[11px]">
                <button type="button" onClick={() => p.onSelectedPods(null)} className="text-primary hover:underline">All</button>
                <button type="button" onClick={() => p.onSelectedPods(new Set())} className="text-muted-foreground hover:text-foreground hover:underline">None</button>
              </span>
            </div>
            <ul className="max-h-72 overflow-y-auto">
              {p.pods.map((pod) => {
                const on = p.selectedPods ? p.selectedPods.has(pod.name) : true;
                return (
                  <li key={pod.name} className="group flex items-center gap-1 rounded-md hover:bg-muted">
                    <button type="button" role="checkbox" aria-checked={on} onClick={() => togglePod(pod.name)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs">
                      <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{on && <Check className="h-3 w-3" />}</span>
                      <span className={cn("min-w-0 flex-1 truncate font-mono", podColor(pod.name))} title={pod.name}>{p.labels.get(pod.name) ?? shortPod(pod.name, p.workload ?? p.name)}</span>
                      <span className={cn("shrink-0 text-[10px]", podStatusTone(pod.status))}>{pod.status}</span>
                      {pod.restarts > 0 && <span className="shrink-0 text-[10px] tabular-nums text-amber-500">{pod.restarts}↻</span>}
                    </button>
                    <button type="button" onClick={() => p.onSelectedPods(new Set([pod.name]))} className="mr-1 rounded px-1.5 py-0.5 text-[10px] text-primary opacity-0 hover:bg-primary/10 focus-visible:opacity-100 group-hover:opacity-100">only</button>
                  </li>
                );
              })}
            </ul>
            {p.skipped.length > 0 && (
              <p className="mt-1 border-t border-border px-2 pt-2 text-[10px] leading-snug text-muted-foreground">{p.skipped.length} older pod{p.skipped.length === 1 ? " is" : "s are"} not streamed (the limit is 12 at a time).</p>
            )}
          </PopoverContent>
        </Popover>
      )}

      {p.containers.length > 1 && (
        <Select value={p.container ?? ""} onChange={(v) => p.onContainer(v || null)} label="Container">
          <option value="">All containers</option>
          {p.containers.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      )}

      <Select value={p.since} onChange={p.onSince} label="Time range">
        {SINCE.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </Select>
      <Select value={p.tail} onChange={(v) => p.onTail(Number(v))} label="Lines to load per container">
        {TAILS.map((n) => <option key={n} value={n}>{n.toLocaleString()} lines</option>)}
      </Select>

      <Btn onClick={() => p.onPrevious(!p.previous)} active={p.previous} disabled={!p.canPrevious} title="Logs of the previous (crashed) container instead of the current one">
        <History className="h-3.5 w-3.5" />Previous
      </Btn>

      {p.workloadLink && (
        <button type="button" onClick={p.workloadLink.onClick} className="flex h-8 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 text-[11px] font-semibold text-primary hover:bg-primary/20">
          <Layers className="h-3.5 w-3.5" />{p.workloadLink.label}
        </button>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        {!p.previous && (
          <Btn onClick={p.onTogglePause} active={p.paused} title={p.paused ? "Resume live tail" : "Pause the view (the stream keeps collecting)"}>
            {p.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}{p.paused ? "Resume" : "Pause"}
          </Btn>
        )}
        <Btn onClick={p.onReconnect} title="Reload logs">
          {p.status === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Btn>
        <Btn onClick={p.onSummarize} disabled={p.summarizing} title="Summarize what is going on with AI">
          {p.summarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-primary" />}Summarize
        </Btn>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="View options" title="View options" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><SlidersHorizontal className="h-3.5 w-3.5" /></button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-60 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Format</p>
            <div className="mb-3 flex rounded-md border border-border p-0.5 text-[11px]" role="group" aria-label="Line format">
              {(["auto", "pretty", "raw"] as const).map((f) => (
                <button key={f} type="button" aria-pressed={p.format === f} onClick={() => p.onFormat(f)} className={cn("flex-1 rounded px-2 py-1 capitalize", p.format === f ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground hover:text-foreground")}>{f}</button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center justify-between py-1 text-xs"><span>Wrap long lines</span><input type="checkbox" checked={p.wrap} onChange={(e) => p.onWrap(e.target.checked)} className="accent-[hsl(var(--primary))]" /></label>
            <label className="flex cursor-pointer items-center justify-between py-1 text-xs"><span>Compact toolbar</span><input type="checkbox" checked={p.compact} onChange={(e) => p.onCompact(e.target.checked)} className="accent-[hsl(var(--primary))]" /></label>
            <label className="flex cursor-pointer items-center justify-between py-1 text-xs"><span>Show timestamps</span><input type="checkbox" checked={p.showTime} onChange={(e) => p.onShowTime(e.target.checked)} className="accent-[hsl(var(--primary))]" /></label>
          </PopoverContent>
        </Popover>
        <Btn onClick={() => p.onFocus(!p.focus)} active={p.focus} title={p.focus ? "Leave focus mode (Esc)" : "Focus: use the whole window for the logs"}>
          {p.focus ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}{p.focus ? "Exit" : "Focus"}
        </Btn>
        <Btn onClick={p.onCopy} title="Copy the lines you can see"><Copy className="h-3.5 w-3.5" /></Btn>
        <Btn onClick={p.onDownload} title="Download the lines you can see"><Download className="h-3.5 w-3.5" /></Btn>
        <Btn onClick={p.onClear} title="Clear the view"><Trash2 className="h-3.5 w-3.5" /></Btn>
      </div>
    </div>
  );
};
