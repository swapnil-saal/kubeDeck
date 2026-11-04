import { useEffect, useState } from "react";
import { Bot, X, Loader2, Copy, Check, AlertCircle, RefreshCcw } from "lucide-react";
import type { AiTaskInputs, AiTaskName } from "@shared/ai";
import { Markdown } from "@/ai/chat/Markdown";
import { useAiTask } from "@/ai/hooks/use-ai-task";

interface AiTaskDialogProps<T extends AiTaskName> {
  task: T;
  input: AiTaskInputs[T];
  buttonLabel: string;
  buttonTitle: string;
  dialogTitle: string;
  busyText: string;
  disabled?: boolean;
}

/** A button that opens a dialog and streams one AI task's markdown answer into it. */
function AiTaskDialog<T extends AiTaskName>({
  task, input, buttonLabel, buttonTitle, dialogTitle, busyText, disabled,
}: AiTaskDialogProps<T>) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { text, loading, error, run, reset } = useAiTask(task);

  // run once per opening; closing aborts the request
  useEffect(() => {
    if (open) void run(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    reset();
    setOpen(false);
  };

  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const iconButton = "p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/20 text-[11px] font-medium text-primary bg-primary/5 hover:bg-primary/10 transition-colors disabled:opacity-30"
        title={buttonTitle}
      >
        <Bot className="w-3.5 h-3.5" />
        <span>{buttonLabel}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh]" onClick={close}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            role="dialog"
            aria-label={dialogTitle}
            className="relative w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 h-12 border-b border-border">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Bot className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="text-sm font-semibold text-foreground flex-1 truncate">{dialogTitle}</span>
              {!loading && text && (
                <button onClick={() => void run(input)} className={iconButton} title="Regenerate">
                  <RefreshCcw className="w-3.5 h-3.5" />
                </button>
              )}
              {text && (
                <button onClick={copy} className={iconButton} title="Copy">
                  {copied ? <Check className="w-3 h-3 text-foreground/60" /> : <Copy className="w-3 h-3" />}
                </button>
              )}
              <button onClick={close} className={iconButton} title="Close">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-auto p-5">
              {loading && !text && (
                <div className="flex items-center gap-3 text-muted-foreground py-8 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs">{busyText}</span>
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive mb-3">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {text && <Markdown text={text} />}
              {loading && text && (
                <div className="flex items-center gap-2 text-muted-foreground mt-3">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span className="text-[10px] uppercase tracking-wider">streaming...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** "Explain": a plain-language walk through a manifest. */
export function AiExplainButton({ yaml, resourceType }: { yaml: string; resourceType: string }) {
  return (
    <AiTaskDialog
      task="explain-yaml"
      input={{ yaml, resourceType }}
      buttonLabel="Explain"
      buttonTitle="AI Explain this YAML"
      dialogTitle="AI YAML Explanation"
      busyText="Analyzing YAML..."
      disabled={!yaml}
    />
  );
}
