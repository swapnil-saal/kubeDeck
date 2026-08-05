import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  Terminal, Loader2, ChevronRight, ChevronDown, CheckCircle2, XCircle,
  GitBranch, Activity, Eye, HelpCircle, Trash2, Copy, Check,
} from "lucide-react";
import {
  appendOutput, clearStream, getStream, registerCall, subscribeMonitor, targetKey,
  type MonitorTarget,
} from "@/lib/monitor-store";
import { cn } from "@/lib/utils";

interface ExecArgs { command: string }

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };
  return { copied, copy };
}

function ExecBlock({
  label, icon: Icon, command, status, result,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  command: string;
  status: "running" | "complete" | "incomplete";
  result?: string;
}) {
  // Closed by default; open while running so live output is visible, then collapse when done.
  const isRunning = status === "running";
  const [open, setOpen] = useState(false);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (isRunning) {
      setOpen(true);
      wasRunning.current = true;
    } else if (wasRunning.current) {
      setOpen(false);
      wasRunning.current = false;
    }
  }, [isRunning]);

  const isError = status === "complete" && !!((result || "").toLowerCase().match(/error|failed|denied|forbidden|notfound|not found/));
  const display = result ?? (isRunning ? "" : "(no output)");
  const { copied, copy } = useCopy(display || command);
  const lineCount = display ? display.split("\n").filter(Boolean).length : 0;

  return (
    <div
      className={cn(
        "my-2.5 overflow-hidden rounded-xl border shadow-sm",
        "bg-card/60 backdrop-blur-sm transition-colors",
        isRunning && "border-primary/30 ring-1 ring-primary/10",
        isError && "border-destructive/30",
        !isRunning && !isError && "border-border/60",
      )}
    >
      <div className="flex items-center gap-0 min-w-0">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-xs hover:bg-muted/40 transition-colors"
        >
          {open
            ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
              isError ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="font-semibold text-foreground shrink-0">{label}</span>
          <code className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-muted-foreground">
            {command || "…"}
          </code>
          {!isRunning && lineCount > 0 && (
            <span className="hidden sm:inline text-[10px] tabular-nums text-muted-foreground/70 shrink-0">
              {lineCount} line{lineCount === 1 ? "" : "s"}
            </span>
          )}
          {isRunning && <Loader2 className="h-3.5 w-3.5 shrink-0 text-primary animate-spin" />}
          {!isRunning && (isError
            ? <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />)}
        </button>
        {display && !isRunning && (
          <button
            type="button"
            onClick={() => void copy()}
            className="shrink-0 px-2.5 py-2.5 text-muted-foreground hover:text-foreground transition-colors"
            title="Copy output"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-border/50">
          <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {isRunning ? "Running" : isError ? "Error output" : "Output"}
            </span>
            {isRunning && (
              <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                <span className="h-1 w-1 rounded-full bg-primary animate-pulse" />
                live
              </span>
            )}
          </div>
          <pre
            className={cn(
              "p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all max-h-80 overflow-auto",
              "bg-[hsl(var(--background))] text-foreground/90",
              isRunning && !result && "text-muted-foreground italic",
            )}
          >
            {result ?? (isRunning ? "Waiting for command output…" : "(no output)")}
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

interface K8sListArgs {
  resource?: string;
  name?: string;
  allNamespaces?: boolean;
  labelSelector?: string;
  fieldSelector?: string;
  wide?: boolean;
}

function formatListCommand(a: K8sListArgs): string {
  const parts = [`get ${a.resource || "?"}`];
  if (a.name) parts.push(a.name);
  if (a.allNamespaces) parts.push("-A");
  if (a.wide) parts.push("-o wide");
  if (a.labelSelector) parts.push(`-l ${a.labelSelector}`);
  if (a.fieldSelector) parts.push(`--field-selector=${a.fieldSelector}`);
  return parts.join(" ");
}

export const K8sListToolUI = makeAssistantToolUI<K8sListArgs, string>({
  toolName: "k8s_list",
  render: ({ args, result, status }) => (
    <ExecBlock
      label="list"
      icon={GitBranch}
      command={formatListCommand(args || {})}
      status={status.type === "running" ? "running" : status.type === "complete" ? "complete" : "incomplete"}
      result={typeof result === "string" ? result : result ? JSON.stringify(result) : undefined}
    />
  ),
});

interface K8sDescribeArgs { resource?: string; name?: string; namespace?: string }

export const K8sDescribeToolUI = makeAssistantToolUI<K8sDescribeArgs, string>({
  toolName: "k8s_describe",
  render: ({ args, result, status }) => (
    <ExecBlock
      label="describe"
      icon={Eye}
      command={`describe ${args?.resource || "?"} ${args?.name || ""}${args?.namespace ? ` -n ${args.namespace}` : ""}`.trim()}
      status={status.type === "running" ? "running" : status.type === "complete" ? "complete" : "incomplete"}
      result={typeof result === "string" ? result : result ? JSON.stringify(result) : undefined}
    />
  ),
});

interface K8sLogsArgs {
  name?: string;
  namespace?: string;
  container?: string;
  tail?: number;
  previous?: boolean;
  since?: string;
}

export const K8sLogsToolUI = makeAssistantToolUI<K8sLogsArgs, string>({
  toolName: "k8s_logs",
  render: ({ args, result, status }) => {
    const a = args || {};
    const bits = [`logs ${a.name || "?"}`, `--tail=${a.tail ?? 100}`];
    if (a.namespace) bits.push(`-n ${a.namespace}`);
    if (a.container) bits.push(`-c ${a.container}`);
    if (a.previous) bits.push("--previous");
    if (a.since) bits.push(`--since=${a.since}`);
    return (
      <ExecBlock
        label="logs"
        icon={Activity}
        command={bits.join(" ")}
        status={status.type === "running" ? "running" : status.type === "complete" ? "complete" : "incomplete"}
        result={typeof result === "string" ? result : result ? JSON.stringify(result) : undefined}
      />
    );
  },
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
      <div className="my-2.5 overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.04] shadow-sm">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs hover:bg-primary/[0.06] transition-colors"
        >
          {open
            ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <GitBranch className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Sub-agent</span>
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                {agent}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{goal}</div>
          </div>
          {isRunning
            ? <Loader2 className="h-3.5 w-3.5 shrink-0 text-primary animate-spin" />
            : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
        </button>
        {open && (
          <div className="border-t border-primary/15">
            {args?.prompt && (
              <div className="px-3 py-2 text-[11px] text-muted-foreground border-b border-border/40">
                <span className="font-medium text-foreground">Goal · </span>
                {args.prompt}
              </div>
            )}
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground bg-muted/20">
              {isRunning ? "Investigating…" : "Findings"}
            </div>
            <pre className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words text-foreground/90 max-h-80 overflow-auto bg-[hsl(var(--background))]">
              {typeof result === "string"
                ? result
                : result
                  ? JSON.stringify(result, null, 2)
                  : (isRunning ? "Specialist is working…" : "(no findings)")}
            </pre>
          </div>
        )}
      </div>
    );
  },
});

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
  const lineCount = chunks.reduce(
    (n, c) => n + (c.text === "(no new lines)" ? 0 : c.text.split("\n").length),
    0,
  );

  const fullText = chunks
    .filter((c) => c.text && c.text !== "(no new lines)")
    .map((c) => c.text.trimEnd())
    .join("\n");

  return (
    <div className="my-2.5 overflow-hidden rounded-xl border border-primary/30 bg-card/60 shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2.5 text-xs border-b border-border/50">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Eye className="h-3.5 w-3.5" />
        </span>
        <span className="font-semibold text-foreground">Live tail</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{label}</code>
        <span className="text-[10px] tabular-nums text-muted-foreground">{lineCount}</span>
        {live
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 text-primary animate-spin" />
          : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded-md border transition-colors",
            paused
              ? "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {paused ? "Paused" : "Follow"}
        </button>
        <button
          type="button"
          onClick={() => clearStream(tgKey)}
          className="text-muted-foreground hover:text-destructive transition-colors"
          title="Clear buffer"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <pre
        ref={scrollRef}
        className="bg-[hsl(var(--background))] text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all text-foreground/90 max-h-80 overflow-auto p-3"
      >
        {fullText || (live ? "Waiting for log lines…" : "(no output yet)")}
      </pre>
    </div>
  );
}

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
    if (!isOwner) return null;
    return <MonitorPanel tgKey={tgKey} />;
  },
});

interface AskHumanArgs {
  question: string;
  options?: string[];
}

export const AskHumanToolUI = makeAssistantToolUI<AskHumanArgs, string>({
  toolName: "ask_human",
  render: ({ args, result, status }) => {
    const answered = status.type === "complete";
    return (
      <div className="my-2.5 overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/[0.06] shadow-sm">
        <div className="flex items-start gap-2.5 px-3 py-2.5 text-xs">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400 mb-1">
              Waiting for you
            </div>
            <div className="font-medium text-sm text-foreground leading-snug">{args?.question}</div>
            {args?.options && args.options.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {args.options.map((o) => (
                  <span
                    key={o}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-200 ring-1 ring-amber-500/20"
                  >
                    {o}
                  </span>
                ))}
              </div>
            )}
            {answered && typeof result === "string" && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">You · </span>
                {result.replace(/^User answered:\s*/, "")}
              </div>
            )}
          </div>
          {!answered && <Loader2 className="h-3.5 w-3.5 shrink-0 text-amber-500 animate-spin" />}
          {answered && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
        </div>
      </div>
    );
  },
});

export function ToolUIRegistry() {
  return (
    <>
      <K8sListToolUI />
      <K8sDescribeToolUI />
      <K8sLogsToolUI />
      <KubectlToolUI />
      <BashToolUI />
      <TaskToolUI />
      <MonitorLogsToolUI />
      <AskHumanToolUI />
    </>
  );
}
