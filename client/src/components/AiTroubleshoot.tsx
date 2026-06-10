import { useEffect, useState } from "react";
import { Bot, X, Loader2, Copy, Check, AlertCircle, RefreshCcw } from "lucide-react";
import { Markdown } from "./assistant/Markdown";
import { useStreamingAi } from "@/hooks/use-streaming-ai";

interface TroubleshootProps {
  resourceType: string;
  name: string;
  namespace: string;
  context: string;
  describe?: string;
  events?: string;
  logs?: string;
}

export function AiTroubleshootButton(props: TroubleshootProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { content, loading, error, run, reset } = useStreamingAi();

  useEffect(() => {
    if (!open) return;
    void run("/api/ai/troubleshoot", props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    reset();
    setOpen(false);
  };

  const handleRegenerate = () => {
    void run("/api/ai/troubleshoot", props);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/20 text-[11px] font-medium text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
        title="AI Troubleshoot"
      >
        <Bot className="w-3.5 h-3.5" />
        <span>AI Diagnose</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh]" onClick={handleClose}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 h-12 border-b border-border">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Bot className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="text-sm font-semibold text-foreground flex-1 truncate">
                AI Diagnosis — {props.resourceType}/{props.name}
              </span>
              {!loading && content && (
                <button
                  onClick={handleRegenerate}
                  className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors"
                  title="Regenerate"
                >
                  <RefreshCcw className="w-3.5 h-3.5" />
                </button>
              )}
              {content && (
                <button
                  onClick={handleCopy}
                  className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy"
                >
                  {copied ? <Check className="w-3 h-3 text-foreground/60" /> : <Copy className="w-3 h-3" />}
                </button>
              )}
              <button
                onClick={handleClose}
                className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors"
                title="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-auto p-5">
              {loading && !content && (
                <div className="flex items-center gap-3 text-muted-foreground py-8 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs">Analyzing resource...</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded bg-destructive/10 border border-destructive/20 text-xs text-destructive mb-3">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {content && <Markdown text={content} />}

              {loading && content && (
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
