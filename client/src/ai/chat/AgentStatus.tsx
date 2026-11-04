import { useEffect, useMemo, useState, type FC } from "react";
import { useAuiState } from "@assistant-ui/react";
import { AnimatePresence, m as motion } from "framer-motion";
import { ArrowDown, HelpCircle, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { approvalAnchorId } from "./StepDetail";
import { questionAnchorId } from "./AskHumanCard";
import { describeToolCall, toolState, type ToolCallLike } from "./tool-state";

interface PartLike extends ToolCallLike {
  type: string;
  toolCallId?: string;
  status?: { type: string };
}

interface MessageLike {
  role: string;
  status?: { type: string };
  content?: readonly PartLike[];
}

type Status =
  | { kind: "approval"; command: string; anchor: string }
  | { kind: "question"; question: string; anchor: string }
  | { kind: "tool"; label: string; command: string; step: number }
  | { kind: "thinking"; step: number }
  | { kind: "writing"; step: number };

/** What the agent is doing right now, read from the last assistant message. */
function currentStatus(messages: readonly MessageLike[], running: boolean): Status | null {
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  const parts = last?.content ?? [];
  const tools = parts.filter((p) => p.type === "tool-call");

  for (const p of tools) {
    const state = toolState(p, false);
    if (state === "approval" && p.toolCallId) {
      const d = describeToolCall(p.toolName, p.args);
      return { kind: "approval", command: `${d.kubectl ? "kubectl " : ""}${d.command}`, anchor: approvalAnchorId(p.toolCallId) };
    }
    if (state === "question" && p.toolCallId) {
      return { kind: "question", question: describeToolCall(p.toolName, p.args).command, anchor: questionAnchorId(p.toolCallId) };
    }
  }
  if (!running) return null;

  const step = tools.length;
  const pending = [...tools].reverse().find((p) => p.result === undefined);
  if (pending) {
    const d = describeToolCall(pending.toolName, pending.args);
    return { kind: "tool", label: d.label, command: `${d.kubectl ? "kubectl " : ""}${d.command}`, step };
  }
  const tail = parts[parts.length - 1];
  if (tail?.type === "text") return { kind: "writing", step };
  return { kind: "thinking", step };
}

/** Seconds since `active` became true; resets when it turns false. */
function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);
  return seconds;
}

const scrollTo = (anchor: string) =>
  document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "center" });

/**
 * A live line above the composer: what the agent is doing, or that it is waiting for you.
 * Approvals and questions get a button that jumps to the card that needs an answer.
 */
export const AgentStatus: FC = () => {
  // The selector returns a string, so streaming tokens that don't change the status cause no re-render.
  const statusKey = useAuiState((s) =>
    JSON.stringify(currentStatus(s.thread.messages as readonly MessageLike[], s.thread.isRunning)),
  );
  const running = useAuiState((s) => s.thread.isRunning);
  const status = useMemo(() => JSON.parse(statusKey) as Status | null, [statusKey]);
  const elapsed = useElapsed(running);
  const waiting = status?.kind === "approval" || status?.kind === "question";

  return (
    <AnimatePresence initial={false}>
      {status && (
        <motion.div
          key={status.kind}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.15 }}
          role="status"
          aria-live="polite"
          className={cn(
            "mb-2 flex min-h-9 items-center gap-2.5 rounded-xl border px-3 py-1.5 text-xs",
            waiting
              ? "border-amber-500/60 bg-amber-500/10 text-amber-900 dark:text-amber-100"
              : "border-primary/30 bg-card text-foreground",
          )}
        >
          {status.kind === "approval" && <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />}
          {status.kind === "question" && <HelpCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />}
          {status.kind === "thinking" && <Sparkles className="h-4 w-4 shrink-0 text-primary motion-safe:animate-pulse" />}
          {(status.kind === "tool" || status.kind === "writing") && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}

          <span className="min-w-0 flex-1 truncate">
            {status.kind === "approval" && (
              <>
                <b className="font-semibold">Waiting for your approval</b>
                <span className="opacity-80"> · </span>
                <code className="font-mono">{status.command}</code>
              </>
            )}
            {status.kind === "question" && (
              <>
                <b className="font-semibold">The assistant asked you something</b>
                <span className="opacity-80"> · {status.question}</span>
              </>
            )}
            {status.kind === "tool" && (
              <>
                <b className="font-semibold">Running {status.label}</b>
                <span className="text-muted-foreground"> · </span>
                <code className="font-mono text-foreground/80">{status.command}</code>
              </>
            )}
            {status.kind === "thinking" && <b className="font-semibold">Thinking{status.step > 0 ? " about the results" : ""}…</b>}
            {status.kind === "writing" && <b className="font-semibold">Writing the answer…</b>}
          </span>

          {!waiting && (
            <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
              {"step" in status && status.step > 0 && `${status.step} call${status.step === 1 ? "" : "s"} · `}
              {elapsed}s
            </span>
          )}
          {waiting && (
            <button
              type="button"
              onClick={() => scrollTo(status.anchor)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-black transition-colors hover:bg-amber-400"
            >
              <ArrowDown className="h-3 w-3" />
              {status.kind === "approval" ? "Review" : "Answer"}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
