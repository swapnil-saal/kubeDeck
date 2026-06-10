import { useState, type FC } from "react";
import {
  useLangGraphInterruptState,
  useLangGraphSendCommand,
} from "@assistant-ui/react-langgraph";
import { HelpCircle, Send } from "lucide-react";

interface InterruptPayload {
  question?: string;
  options?: string[];
  [k: string]: unknown;
}

/**
 * Renders a HITL prompt when the agent has paused on `interrupt()`.
 * Reads the interrupt state from assistant-ui's langgraph runtime; submits
 * the answer via `useLangGraphSendCommand({ resume })`.
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
    <div className="mx-4 my-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-1.5 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <HelpCircle className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1">
            Agent needs your input
          </div>
          <div className="text-sm text-foreground font-medium">{question}</div>

          {options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {options.map((opt) => (
                <button
                  key={opt}
                  disabled={busy}
                  onClick={() => submit(opt)}
                  className="px-3 py-1.5 rounded-lg border border-amber-500/40 bg-background hover:bg-amber-500/10 text-xs font-medium text-foreground transition-colors disabled:opacity-40"
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
              placeholder={options.length > 0 ? "Or type a custom answer..." : "Type your answer..."}
              className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500/40"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="h-9 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3 h-3" />
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
