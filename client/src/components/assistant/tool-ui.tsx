import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  Terminal, Loader2, ChevronRight, ChevronDown, CheckCircle2, XCircle,
  GitBranch, Activity, Bot, Eye, HelpCircle, Trash2,
} from "lucide-react";
import {
  appendOutput, clearStream, getStream, registerCall, subscribeMonitor, targetKey,
  type MonitorTarget,
} from "@/lib/monitor-store";

interface ExecArgs { command: string }

function ExecBlock({
  label, icon: Icon, command, status, result,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  command: string;
  status: "running" | "complete" | "incomplete";
  result?: string;
}) {
  const [open, setOpen] = useState(true);
  const isRunning = status === "running";
  const isError = status === "complete" && (result || "").toLowerCase().match(/error|failed|denied|forbidden/);

  return (
    <div className="my-2 rounded-md border border-border bg-muted/30 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />}
        <Icon className="w-3.5 h-3.5 shrink-0 text-primary" />
        <span className="font-medium text-foreground">{label}</span>
        <code className="font-mono text-[11px] text-muted-foreground truncate flex-1 text-left">
          {command}
        </code>
        {isRunning && <Loader2 className="w-3 h-3 shrink-0 text-primary animate-spin" />}
        {!isRunning && (isError
          ? <XCircle className="w-3 h-3 shrink-0 text-destructive" />
          : <CheckCircle2 className="w-3 h-3 shrink-0 text-green-500" />)}
      </button>
      {open && (
        <div className="border-t border-border bg-background/50">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
            {isRunning ? "Running…" : isError ? "Output (error)" : "Output"}
          </div>
          <pre className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all text-foreground/90 max-h-72 overflow-auto">
            {result ?? (isRunning ? "…" : "(no output)")}
          </pre>
        </div>
      )}
    </div>
  );
}

export const KubectlToolUI = makeAssistantToolUI<ExecArgs, string>({
  toolName: "kubectl",
  render: ({ args, result, status }) => (
    <ExecBlock
      label="kubectl"
      icon={Terminal}
      command={args?.command ?? ""}
      status={status.type === "running" ? "running" : status.type === "complete" ? "complete" : "incomplete"}
      result={typeof result === "string" ? result : result ? JSON.stringify(result) : undefined}
    />
  ),
});

export const BashToolUI = makeAssistantToolUI<ExecArgs, string>({
  toolName: "bash",
  render: ({ args, result, status }) => (
    <ExecBlock
      label="bash"
      icon={Activity}
      command={args?.command ?? ""}
      status={status.type === "running" ? "running" : status.type === "complete" ? "complete" : "incomplete"}
      result={typeof result === "string" ? result : result ? JSON.stringify(result) : undefined}
    />
  ),
});

interface TaskArgs {
  description?: string;
  subagent_type?: string;
  prompt?: string;
}

export const TaskToolUI = makeAssistantToolUI<TaskArgs, string>({
  toolName: "task",
  render: ({ args, result, status }) => {
    const [open, setOpen] = useState(true);
    const isRunning = status.type === "running";
    const goal = args?.description || args?.prompt || "Investigation";
    const agent = args?.subagent_type || "kubernetes-investigator";
    return (
      <div className="my-2 rounded-md border border-primary/30 bg-primary/5 overflow-hidden">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-primary/10 transition-colors"
        >
          {open ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />}
          <GitBranch className="w-3.5 h-3.5 shrink-0 text-primary" />
          <span className="font-medium text-foreground">Sub-agent</span>
          <span className="font-mono text-[11px] text-muted-foreground">{agent}</span>
          <span className="text-muted-foreground/70 truncate flex-1 text-left">— {goal}</span>
          {isRunning
            ? <Loader2 className="w-3 h-3 shrink-0 text-primary animate-spin" />
            : <CheckCircle2 className="w-3 h-3 shrink-0 text-green-500" />}
        </button>
        {open && (
          <div className="border-t border-primary/20 bg-background/50">
            {args?.prompt && (
              <div className="px-3 py-2 text-[11px] text-muted-foreground border-b border-border/50">
                <span className="font-medium text-foreground">Goal: </span>
                {args.prompt}
              </div>
            )}
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
              {isRunning ? "Investigating…" : "Findings"}
            </div>
            <pre className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words text-foreground/90 max-h-80 overflow-auto">
              {typeof result === "string" ? result : result ? JSON.stringify(result, null, 2) : (isRunning ? "…" : "(no findings)")}
            </pre>
          </div>
        )}
      </div>
    );
  },
});

// ── Continuous-monitoring tool (tail logs since last call) ──────────────
//
// Every `monitor_logs` tool call appends to a shared per-target stream so
// the UI shows ONE scrollable container per pod, not one card per call.

interface MonitorArgs {
  pod: string;
  namespace?: string;
  container?: string;
  grep?: string;
  sinceSeconds?: number;
}

function MonitorPanel({ tgKey }: { tgKey: string }) {
  const stream = useSyncExternalStore(
    subscribeMonitor,
    () => getStream(tgKey),
    () => getStream(tgKey),
  );
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
    target.namespace && `ns=${target.namespace}`,
    target.container && `c=${target.container}`,
    target.grep && `~ "${target.grep}"`,
  ].filter(Boolean).join(" · ");
  const lineCount = chunks.reduce((n, c) => n + (c.text === "(no new lines)" ? 0 : c.text.split("\n").length), 0);

  const fullText = chunks
    .filter((c) => c.text && c.text !== "(no new lines)")
    .map((c) => c.text.trimEnd())
    .join("\n");

  return (
    <div className="my-2 rounded-md border border-primary/30 bg-muted/30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 text-xs border-b border-border/60">
        <Eye className="w-3.5 h-3.5 shrink-0 text-primary" />
        <span className="font-medium text-foreground">Live tail</span>
        <code className="font-mono text-[11px] text-muted-foreground truncate flex-1">{label}</code>
        <span className="text-[10px] text-muted-foreground/80 tabular-nums">{lineCount} line{lineCount === 1 ? "" : "s"}</span>
        {live
          ? <Loader2 className="w-3 h-3 shrink-0 text-primary animate-spin" />
          : <CheckCircle2 className="w-3 h-3 shrink-0 text-green-500" />}
        <button
          onClick={() => setPaused((p) => !p)}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
            paused
              ? "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/60"
          }`}
          title={paused ? "Resume auto-scroll" : "Pause auto-scroll"}
        >
          {paused ? "Paused" : "Auto-scroll"}
        </button>
        <button
          onClick={() => clearStream(tgKey)}
          className="text-muted-foreground hover:text-destructive transition-colors"
          title="Clear log buffer"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <pre
        ref={scrollRef}
        className="bg-background/60 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all text-foreground/90 max-h-80 overflow-auto p-3"
      >
        {fullText || (live ? "Waiting for log lines…" : "(no output yet)")}
      </pre>
    </div>
  );
}

/**
 * Hook that registers this tool call against the shared stream and reports
 * back whether this call instance is the "owner" that should render the
 * panel (the first call for the target wins; later calls render nothing).
 */
function useMonitorRegistration(
  callId: string | undefined,
  target: MonitorTarget,
  resultText: string | undefined,
  isComplete: boolean,
): { tgKey: string; isOwner: boolean } {
  const tgKey = targetKey(target);
  const registeredRef = useRef(false);
  const recordedRef = useRef(false);
  const ownerRef = useRef(false);

  if (callId && !registeredRef.current) {
    registeredRef.current = true;
    const { owner } = registerCall(target, callId);
    ownerRef.current = owner;
  }

  useEffect(() => {
    if (!callId || !isComplete || recordedRef.current) return;
    recordedRef.current = true;
    appendOutput(target, callId, resultText ?? "");
    // intentionally exclude `target` from deps — its identity changes per
    // render but the values are stable for a given tool call
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, isComplete, resultText]);

  return { tgKey, isOwner: ownerRef.current };
}

export const MonitorLogsToolUI = makeAssistantToolUI<MonitorArgs, string>({
  toolName: "monitor_logs",
  render: ({ args, result, status, toolCallId }) => {
    const target: MonitorTarget = {
      pod: args?.pod,
      namespace: args?.namespace,
      container: args?.container,
      grep: args?.grep,
    };
    const resultText = typeof result === "string" ? result : result ? JSON.stringify(result) : undefined;
    const isComplete = status.type === "complete";
    const { tgKey, isOwner } = useMonitorRegistration(toolCallId, target, resultText, isComplete);

    // Only the first tool call for this target renders the live panel.
    // Subsequent calls write into the same stream silently.
    if (!isOwner) return null;
    return <MonitorPanel tgKey={tgKey} />;
  },
});

// ── Human-in-the-loop tool: pure display, the actual prompt is handled
// by InterruptPanel via useLangGraphInterruptState. This UI is shown for
// completeness when the tool call appears in the message stream.

interface AskHumanArgs {
  question: string;
  options?: string[];
}

export const AskHumanToolUI = makeAssistantToolUI<AskHumanArgs, string>({
  toolName: "ask_human",
  render: ({ args, result, status }) => {
    const answered = status.type === "complete";
    return (
      <div className="my-2 rounded-md border border-amber-500/30 bg-amber-500/5 overflow-hidden">
        <div className="flex items-start gap-2 px-3 py-2 text-xs">
          <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">{args?.question}</div>
            {args?.options && args.options.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {args.options.map((o) => (
                  <span key={o} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">{o}</span>
                ))}
              </div>
            )}
            {answered && typeof result === "string" && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">You: </span>{result.replace(/^User answered:\s*/, "")}
              </div>
            )}
          </div>
          {!answered && <Loader2 className="w-3 h-3 shrink-0 text-amber-500 animate-spin" />}
          {answered && <CheckCircle2 className="w-3 h-3 shrink-0 text-green-500" />}
        </div>
      </div>
    );
  },
});

export function ToolUIRegistry() {
  return (
    <>
      <KubectlToolUI />
      <BashToolUI />
      <TaskToolUI />
      <MonitorLogsToolUI />
      <AskHumanToolUI />
    </>
  );
}

export { Bot };
