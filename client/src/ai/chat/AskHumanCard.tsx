import { useState, type FC } from "react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { CheckCircle2, HelpCircle, Loader2, Send } from "lucide-react";

interface AskHumanArgs {
  question?: string;
  options?: string[];
}

/** DOM id of an open question, so the status bar can scroll to it. */
export const questionAnchorId = (toolCallId: string) => `tool-question-${toolCallId}`;

/** ask_human: the agent paused to ask something. The answer becomes the tool's result. */
export const AskHumanCard: FC<ToolCallMessagePartProps<AskHumanArgs, string>> = ({ args, result, addResult, toolCallId }) => {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const answered = result !== undefined;
  const options = args?.options ?? [];

  const submit = (answer: string) => {
    const a = answer.trim();
    if (!a || sent || answered) return;
    setSent(true);
    addResult(a);
  };

  if (answered) {
    return (
      <div className="my-2 flex items-start gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-xs">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0">
          <p className="text-muted-foreground">{args?.question}</p>
          <p className="mt-1 font-medium text-foreground">
            <span className="text-muted-foreground">You: </span>
            {typeof result === "string" ? result : JSON.stringify(result)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      id={questionAnchorId(toolCallId)}
      role="group"
      aria-label="Question from the assistant"
      className="my-2 scroll-mt-24 overflow-hidden rounded-xl border border-amber-500/60 bg-amber-500/[0.07] ring-2 ring-amber-500/20"
    >
      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-800 dark:text-amber-200">
            The assistant needs your input
          </p>
          <p className="mt-1 text-sm font-medium leading-snug text-foreground">{args?.question}</p>

          {options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {options.map((o) => (
                <button
                  key={o}
                  type="button"
                  disabled={sent}
                  onClick={() => submit(o)}
                  className="rounded-lg border border-amber-500/50 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-amber-500/15 disabled:opacity-40"
                >
                  {o}
                </button>
              ))}
            </div>
          )}

          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={options.length > 0 ? "Or type your own answer…" : "Type your answer…"}
              disabled={sent}
              aria-label="Your answer"
              className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/25"
            />
            <button
              type="submit"
              disabled={sent || !text.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 text-xs font-semibold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
