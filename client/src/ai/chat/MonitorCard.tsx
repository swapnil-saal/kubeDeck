import { useEffect, useRef, useState, useSyncExternalStore, type FC } from "react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { Eye, Pause, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StateChip } from "./chat-ui";
import {
  appendOutput, clearStream, getStream, registerCall, subscribeMonitor, targetKey, type MonitorTarget,
} from "./monitor-store";
import { resultAsText } from "./tool-state";

interface MonitorArgs {
  pod?: string;
  namespace?: string;
  container?: string;
  grep?: string;
}

const NO_NEW_LINES = "(no new lines)";

/** One panel per watched pod: every monitor_logs call on the same target appends to it. */
function MonitorPanel({ tgKey }: { tgKey: string }) {
  const stream = useSyncExternalStore(subscribeMonitor, () => getStream(tgKey), () => getStream(tgKey));
  const scrollRef = useRef<HTMLPreElement | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [stream?.lastUpdateAt, paused]);

  if (!stream) return null;

  const { target, chunks, pendingCount } = stream;
  const live = pendingCount > 0;
  const label = [
    target.pod,
    target.namespace && `-n ${target.namespace}`,
    target.container && `-c ${target.container}`,
    target.grep && `| grep "${target.grep}"`,
  ].filter(Boolean).join(" ");
  const text = chunks.filter((c) => c.text && c.text !== NO_NEW_LINES).map((c) => c.text.trimEnd()).join("\n");
  const lines = text ? text.split("\n").length : 0;

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-primary/40 bg-card">
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Eye className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">live tail</span>
            <StateChip state={live ? "running" : "done"} detail={`${lines} line${lines === 1 ? "" : "s"}`} />
          </div>
          <code className="mt-1 block truncate font-mono text-[12px] text-foreground/85" title={label}>
            <span className="select-none text-muted-foreground">$ </span>kubectl logs -f {label}
          </code>
        </div>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors",
            paused
              ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          {paused ? "Paused" : "Following"}
        </button>
        <button
          type="button"
          onClick={() => clearStream(tgKey)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          title="Clear buffer"
          aria-label="Clear buffer"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <pre
        ref={scrollRef}
        className="max-h-80 overflow-auto bg-muted/40 px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all text-foreground/90"
      >
        {text || (live ? "Waiting for log lines…" : "(no output yet)")}
      </pre>
    </div>
  );
}

/**
 * monitor_logs: the first call for a target owns the panel; later calls feed it.
 * Registration happens during render so the owner is known before the first paint.
 */
export const MonitorCard: FC<ToolCallMessagePartProps<MonitorArgs>> = ({ args, result, status, toolCallId }) => {
  const target: MonitorTarget = { pod: args?.pod, namespace: args?.namespace, container: args?.container, grep: args?.grep };
  const tgKey = targetKey(target);
  const registered = useRef(false);
  const recorded = useRef(false);
  const owner = useRef(false);
  const text = resultAsText(result);
  const complete = status.type === "complete";

  if (toolCallId && !registered.current) {
    registered.current = true;
    owner.current = registerCall(target, toolCallId).owner;
  }

  useEffect(() => {
    if (!toolCallId || !complete || recorded.current) return;
    recorded.current = true;
    appendOutput(target, toolCallId, text ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolCallId, complete, text]);

  return owner.current ? <MonitorPanel tgKey={tgKey} /> : null;
};
