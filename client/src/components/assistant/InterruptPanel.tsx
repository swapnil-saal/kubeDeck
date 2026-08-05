import { useState, type FC } from "react";
import {
  useLangGraphInterruptState,
  useLangGraphSendCommand,
} from "@assistant-ui/react-langgraph";
import { HelpCircle, Send, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface InterruptPayload {
  question?: string;
  options?: string[];
  kind?: string;
  command?: string;
  [k: string]: unknown;
}

/**
 * HITL panel when the agent pauses on interrupt() / ask_human / mutation confirm.
 */
export const InterruptPanel: FC = () => {
  const interrupt = useLangGraphInterruptState();
  const sendCommand = useLangGraphSendCommand();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (!interrupt) return null;

  const value = (interrupt.value ?? {}) as InterruptPayload;
  // LangGraph may wrap payload; flatten common shapes
  const payload = (value && typeof value === "object" && "value" in value
    ? (value as { value: InterruptPayload }).value
    : value) as InterruptPayload;

  const isConfirm = payload.kind === "confirm" || Array.isArray(payload.options) &&
    payload.options.some((o) => /allow/i.test(String(o)));
  const question = payload.question || "The agent is waiting for your input.";
  const command = typeof payload.command === "string" ? payload.command : "";
  const options = Array.isArray(payload.options) ? payload.options : [];

  const submit = async (answer: string) => {
    if (!answer.trim() || busy) return;
    setBusy(true);
    try {
      await sendCommand({ resume: answer });
      setText("");
    } finally {
      setBusy(false);
    }
  };

  const border = isConfirm ? "border-rose-500/35 bg-rose-500/[0.07]" : "border-amber-500/35 bg-amber-500/[0.07]";
  const iconBg = isConfirm
    ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-rose-500/25"
    : "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/25";
  const labelColor = isConfirm
    ? "text-rose-700 dark:text-rose-400"
    : "text-amber-700 dark:text-amber-400";

  return (
    <div className="mx-4 sm:mx-6 mb-2">
      <div className={cn("mx-auto max-w-[48rem] rounded-2xl border p-4 shadow-md backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-300", border)}>
        <div className="flex items-start gap-3">
          <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1", iconBg)}>
            {isConfirm ? <ShieldAlert className="w-4 h-4" /> : <HelpCircle className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className={cn("text-[10px] font-semibold uppercase tracking-[0.14em] mb-1", labelColor)}>
              {isConfirm ? "Confirm mutation" : "Your input needed"}
            </div>
            <div className="text-sm text-foreground font-medium leading-snug">{question}</div>
            {command && (
              <pre className="mt-2 rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-[11px] font-mono text-foreground/90 whitespace-pre-wrap break-all">
                kubectl {command}
              </pre>
            )}

            {options.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {options.map((opt) => {
                  const approve = /allow|approve|yes/i.test(opt);
                  const deny = /deny|no|cancel/i.test(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={busy}
                      onClick={() => void submit(opt)}
                      className={cn(
                        "px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors disabled:opacity-40",
                        approve && "border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-200",
                        deny && "border-border bg-background/80 hover:bg-muted text-foreground",
                        !approve && !deny && "border-amber-500/40 bg-background/80 hover:bg-amber-500/10 text-foreground",
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}

            {!isConfirm && (
              <form
                className="mt-3 flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit(text);
                }}
              >
                <input
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={options.length > 0 ? "Or type a custom answer…" : "Type your answer…"}
                  className="flex-1 h-10 px-3.5 rounded-xl border border-border/70 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/25 focus:border-amber-500/40"
                  disabled={busy}
                />
                <button
                  type="submit"
                  disabled={busy || !text.trim()}
                  className="h-10 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Send
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
