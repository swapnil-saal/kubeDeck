import { useState, type FC } from "react";
import { Check, Copy, Play, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { StateChip, useCopy } from "./chat-ui";
import { TOOL_STATE_UI, type ToolDescription, type ToolState } from "./tool-state";

/** DOM id of a call's approval panel, so the status bar can scroll to it. */
export const approvalAnchorId = (toolCallId: string) => `tool-approval-${toolCallId}`;

/** Non-empty lines in a tool's output. */
export function lineCount(text: string | undefined): number {
  return text ? text.split("\n").filter((l) => l.trim()).length : 0;
}

/** Why a call did not run, in one line. */
export function refusalReason(state: ToolState, text: string | undefined, reason: string | undefined): string {
  if (state === "denied") return "You denied this command, so it was not run.";
  const detail = (text || reason || "").replace(/^blocked:\s*/i, "").trim();
  return detail || "KubeDeck does not let the assistant run this command.";
}

/** Run once / Deny for a command that changes the cluster. Nothing runs until the user clicks. */
export const ApprovalPanel: FC<{
  toolCallId: string;
  commandLine: string;
  onRespond: (approved: boolean) => void;
}> = ({ toolCallId, commandLine, onRespond }) => {
  const [busy, setBusy] = useState(false);
  const answer = (approved: boolean) => {
    if (busy) return;
    setBusy(true);
    onRespond(approved);
  };
  return (
    <div
      id={approvalAnchorId(toolCallId)}
      role="alertdialog"
      aria-label="Approve command"
      className="scroll-mt-24 rounded-xl border border-amber-500/60 bg-amber-500/[0.08] px-3.5 py-3"
    >
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">This command changes your cluster</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            The agent wants to run it with your kubeconfig. Nothing happens until you choose.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-amber-500/30 bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground">
            <span className="select-none text-muted-foreground">$ </span>
            {commandLine}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => answer(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Run once
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => answer(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Deny
            </button>
            {busy && <span className="text-[11px] text-muted-foreground">Sending your decision…</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Everything about one step, shown under the timeline strip: the full command,
 * then the refusal reason, the error, or the output.
 */
export const StepDetail: FC<{
  id: string;
  labelledBy: string;
  description: ToolDescription;
  state: ToolState;
  text: string | undefined;
  reason: string | undefined;
  onClose: () => void;
}> = ({ id, labelledBy, description, state, text, reason, onClose }) => {
  const { copied, copy } = useCopy(text ?? "");
  const commandLine = `${description.kubectl ? "kubectl " : ""}${description.command}`;
  const refused = state === "denied" || state === "blocked";
  const failed = state === "error";
  const lines = lineCount(text);
  const ui = TOOL_STATE_UI[state];

  return (
    <div id={id} role="region" aria-labelledby={labelledBy} className={cn("overflow-hidden rounded-xl border bg-card", ui.border)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-foreground">{description.label}</span>
        <StateChip state={state} detail={state === "done" && lines > 0 ? `${lines} line${lines === 1 ? "" : "s"}` : undefined} />
        <span className="flex-1" />
        {text && !refused && (
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Copy output"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Close step details"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <pre className="overflow-x-auto border-b border-border bg-muted/30 px-3.5 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all text-foreground">
        <span className="select-none text-muted-foreground">$ </span>
        {commandLine || "…"}
      </pre>

      {refused ? (
        <p className={cn("px-3.5 py-2.5 text-xs leading-relaxed", ui.text)}>{refusalReason(state, text, reason)}</p>
      ) : (
        <pre
          className={cn(
            "max-h-72 overflow-auto px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all",
            failed ? "text-red-700 dark:text-red-300" : "text-foreground/90",
            !text && "italic text-muted-foreground",
          )}
        >
          {text ?? (state === "running" ? "Waiting for output…" : state === "approval" ? "Not run yet." : "(no output)")}
        </pre>
      )}
    </div>
  );
};
