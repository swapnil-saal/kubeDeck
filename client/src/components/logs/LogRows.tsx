import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FC, type ReactNode } from "react";
import { ArrowDown, Check, ChevronDown, ChevronRight, Copy, EyeOff } from "lucide-react";
import { formatTime, highlightRanges, podColor, shortPod, type Level, type LogEntry, type LogRow } from "@shared/logs";
import { cn } from "@/lib/utils";

const LEVEL_UI: Record<Level, { label: string; cls: string; text: string }> = {
  fatal: { label: "FTL", cls: "bg-destructive/20 text-destructive ring-destructive/30", text: "text-destructive" },
  error: { label: "ERR", cls: "bg-destructive/15 text-destructive ring-destructive/25", text: "text-destructive" },
  warn: { label: "WRN", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/25", text: "text-amber-600 dark:text-amber-400" },
  info: { label: "INF", cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/20", text: "" },
  debug: { label: "DBG", cls: "bg-muted text-muted-foreground ring-border", text: "text-muted-foreground" },
  trace: { label: "TRC", cls: "bg-muted text-muted-foreground ring-border", text: "text-muted-foreground" },
  unknown: { label: "   ", cls: "", text: "" },
};

/** Fields that are the same on every line of an app: kept out of the collapsed row. */
const DIM_FIELDS = new Set(["v", "pid", "hostname", "name", "version", "service", "app", "env"]);
const MAX_CHIPS = 8;

const Highlighted: FC<{ text: string; re: RegExp | null }> = ({ text, re }) => (
  <>
    {highlightRanges(text, re).map((p, i) =>
      p.hit ? <mark key={i} className="rounded-sm bg-amber-400/30 px-0.5 text-foreground">{p.text}</mark> : <span key={i}>{p.text}</span>,
    )}
  </>
);

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

interface RowProps {
  entry: LogEntry;
  match: boolean;
  active: boolean;
  format: "pretty" | "raw";
  wrap: boolean;
  showTime: boolean;
  multiPod: boolean;
  workload?: string;
  labels: Map<string, string>;
  highlight: RegExp | null;
  onHide: (e: LogEntry) => void;
  onTerm: (term: string, exclude: boolean) => void;
}

const EntryRow = memo(function EntryRow({ entry: e, match, active, format, wrap, showTime, multiPod, workload, labels, highlight, onHide, onTerm }: RowProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const lv = LEVEL_UI[e.level];

  const copy = () => {
    void navigator.clipboard?.writeText(e.raw).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {});
  };

  const chips = useMemo(() => {
    if (!e.fields) return [];
    // name / version / v … are the same on every line of an app: they live in the expanded view
    return Object.entries(e.fields).filter(([k]) => !DIM_FIELDS.has(k));
  }, [e.fields]);

  const prefix = (
    <>
      {showTime && <span className="w-[5.6rem] shrink-0 select-none tabular-nums text-muted-foreground/70 max-sm:hidden">{formatTime(e.ts)}</span>}
      {multiPod && e.source && (
        <span className={cn("w-[6.5rem] shrink-0 select-none truncate font-medium", podColor(e.source))} title={`${e.source}${e.container ? ` / ${e.container}` : ""}`}>
          {labels.get(e.source) ?? shortPod(e.source, workload)}
        </span>
      )}
    </>
  );

  const actions = (
    <div className="ml-auto flex shrink-0 items-start gap-0.5 pl-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <button type="button" onClick={() => onHide(e)} title="Hide lines like this" aria-label="Hide lines like this" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><EyeOff className="h-3 w-3" /></button>
      <button type="button" onClick={copy} title="Copy line" aria-label="Copy line" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">{copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}</button>
    </div>
  );

  return (
    <div data-row-id={e.id} className={cn("group border-l-2 border-transparent hover:bg-muted/40", active && "border-primary bg-primary/[0.07]", match && !active && "border-amber-400/60", (e.level === "error" || e.level === "fatal") && "bg-destructive/[0.04]")}>
      <div className={cn("flex gap-2 px-3 py-[2px] font-mono text-[11.5px] leading-[1.55]", format === "raw" && !wrap && "whitespace-pre")}>
        {prefix}
        {format === "pretty" ? (
          <>
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Collapse line" : "Expand line"} className="mt-[3px] h-3 w-3 shrink-0 text-muted-foreground/60 hover:text-foreground">
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
            <span className={cn("mt-[1px] inline-flex h-[15px] w-7 shrink-0 select-none items-center justify-center rounded text-[9px] font-bold ring-1", lv.cls)}>{lv.label}</span>
            <div className={cn("min-w-0 flex-1", wrap ? "break-words" : "truncate")}>
              <span className={cn("text-foreground/90", lv.text)}><Highlighted text={e.message} re={highlight} /></span>
              {chips.slice(0, MAX_CHIPS).map(([k, v]) => {
                const value = stringify(v);
                const short = value.length > 48 ? value.slice(0, 47) + "…" : value;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={(ev) => onTerm(value, ev.shiftKey || ev.altKey)}
                    title={`${k}=${value}\nClick: filter to this · Shift-click: hide this`}
                    className={cn("ml-1.5 inline-flex max-w-[22rem] items-baseline gap-0.5 rounded bg-muted/70 px-1 py-px align-baseline text-[10.5px] hover:bg-muted", DIM_FIELDS.has(k) ? "text-muted-foreground/60" : "text-muted-foreground")}
                  >
                    <span className="opacity-70">{k}=</span><span className="truncate text-foreground/80"><Highlighted text={short} re={highlight} /></span>
                  </button>
                );
              })}
              {chips.length > MAX_CHIPS && <span className="ml-1.5 text-[10px] text-muted-foreground/60">+{chips.length - MAX_CHIPS} more</span>}
            </div>
          </>
        ) : (
          <span className={cn("min-w-0 flex-1", wrap ? "whitespace-pre-wrap break-all" : "", lv.text || "text-foreground/85")}>
            <Highlighted text={e.raw} re={highlight} />
          </span>
        )}
        {actions}
      </div>
      {open && format === "pretty" && (
        <pre className="mx-3 mb-1 ml-[7.5rem] max-h-72 overflow-auto rounded-md border border-border/60 bg-background/70 p-2 text-[11px] leading-relaxed text-foreground/85">
          {e.format === "json" ? JSON.stringify(safeParse(e.raw), null, 2) : e.raw}
        </pre>
      )}
    </div>
  );
});

function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}

const PAGE = 1500;

export interface LogRowsProps {
  rows: LogRow[];
  format: "pretty" | "raw";
  wrap: boolean;
  showTime: boolean;
  multiPod: boolean;
  workload?: string;
  labels: Map<string, string>;
  highlight: RegExp | null;
  /** keep the view pinned to the newest line */
  follow: boolean;
  /** the user scrolled up while following */
  onScrolledUp: () => void;
  onResume: () => void;
  activeId?: number;
  onHide: (e: LogEntry) => void;
  onTerm: (term: string, exclude: boolean) => void;
  empty: ReactNode;
}

/** The scrolling list. Renders the newest 1,500 rows and lets you page back, so 20,000 lines stay fast. */
export const LogRows: FC<LogRowsProps> = ({ rows, format, wrap, showTime, multiPod, workload, labels, highlight, follow, onScrolledUp, onResume, activeId, onHide, onTerm, empty }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(PAGE);
  const atBottom = useRef(true);
  const [behind, setBehind] = useState(0);
  const lastLen = useRef(rows.length);

  const start = Math.max(0, rows.length - limit);
  const visible = rows.slice(start);

  // stay pinned to the newest line while following
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (follow) {
      el.scrollTop = el.scrollHeight;
      setBehind(0);
    } else if (rows.length > lastLen.current && !atBottom.current) {
      setBehind((b) => b + (rows.length - lastLen.current));
    }
    lastLen.current = rows.length;
  }, [rows, follow]);

  useEffect(() => {
    if (activeId === undefined) return;
    ref.current?.querySelector(`[data-row-id="${activeId}"]`)?.scrollIntoView({ block: "center" });
  }, [activeId]);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (atBottom.current && !bottom && follow) onScrolledUp();
    atBottom.current = bottom;
    if (bottom) setBehind(0);
  }, [follow, onScrolledUp]);

  const jump = () => {
    onResume();
    requestAnimationFrame(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; });
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} onScroll={onScroll} className="h-full overflow-auto rounded-b-lg border border-t-0 border-border bg-surface-inset py-1" role="log" aria-live="off" aria-label="Log lines">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">{empty}</div>
        ) : (
          <>
            {start > 0 && (
              <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="mx-3 my-1 w-[calc(100%-1.5rem)] rounded-md border border-dashed border-border py-1 text-center text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
                Show {Math.min(PAGE, start).toLocaleString()} earlier lines ({start.toLocaleString()} not shown)
              </button>
            )}
            {visible.map((row) =>
              row.kind === "gap" ? (
                <div key={row.id} className="select-none py-0.5 text-center font-mono text-[10px] text-muted-foreground/50">··· {row.hidden.toLocaleString()} line{row.hidden === 1 ? "" : "s"} hidden ···</div>
              ) : (
                <EntryRow
                  key={row.entry.id}
                  entry={row.entry}
                  match={row.match}
                  active={row.entry.id === activeId}
                  format={format}
                  wrap={wrap}
                  showTime={showTime}
                  multiPod={multiPod}
                  workload={workload}
                  labels={labels}
                  highlight={highlight}
                  onHide={onHide}
                  onTerm={onTerm}
                />
              ),
            )}
          </>
        )}
      </div>
      {!follow && rows.length > 0 && (
        <button type="button" onClick={jump} className="absolute bottom-3 right-5 flex items-center gap-1.5 rounded-full border border-primary/40 bg-card px-3 py-1.5 text-xs font-medium text-primary shadow-lg transition-colors hover:bg-primary/10">
          <ArrowDown className="h-3.5 w-3.5" />
          {behind > 0 ? `${behind.toLocaleString()} new · ` : ""}Jump to latest
        </button>
      )}
    </div>
  );
};
