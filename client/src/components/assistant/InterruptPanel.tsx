import { useState, type FC } from "react";
import {
  useLangGraphInterruptState,
  useLangGraphSendCommand,
} from "@assistant-ui/react-langgraph";
import { HelpCircle, Send, Loader2 } from "lucide-react";

interface InterruptPayload {
  question?: string;
  options?: string[];
  [k: string]: unknown;
}

/**
 * HITL panel when the agent pauses on interrupt() / ask_human.
 */
export const InterruptPanel: FC = () => {
  const interrupt = useLangGraphInterruptState();
  const sendCommand = useLangGraphSendCommand();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (!interrupt) return null;

  const value = (interrupt.value ?? {}) as InterruptPayload;
  const question = value.question || "The agent is waiting for your input.";
  const options = Array.isArray(value.options) ? value.options : [];

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

  return (
    <div className="mx-4 sm:mx-6 mb-2">
      <div className="mx-auto max-w-[48rem] rounded-2xl border border-amber-500/35 bg-amber-500/[0.07] p-4 shadow-md backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/25">
            <HelpCircle className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400 mb-1">
              Your input needed
            </div>
            <div className="text-sm text-foreground font-medium leading-snug">{question}</div>

            {options.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    disabled={busy}
                    onClick={() => void submit(opt)}
                    className="px-3 py-1.5 rounded-xl border border-amber-500/40 bg-background/80 hover:bg-amber-500/10 text-xs font-medium text-foreground transition-colors disabled:opacity-40"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

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
          </div>
        </div>
      </div>
    </div>
  );
};
