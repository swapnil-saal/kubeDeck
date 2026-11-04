import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AlertCircle, Check, Copy, Loader2, MessageSquare, RefreshCw, Sparkles, X } from "lucide-react";
import { Markdown } from "@/ai/chat/Markdown";
import { useAiTask } from "@/ai/hooks/use-ai-task";
import { useResourceDescribe, useResourceEvents } from "@/hooks/use-k8s";

interface Props {
  resourceType: string;
  name: string;
  namespace: string;
  context: string;
  onClose: () => void;
}

const iconButton = "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";

/**
 * The resource page's AI diagnosis. Opened by the user (never on page load): it reads the
 * resource's describe output and events itself, whichever tab is open, and streams a diagnosis.
 */
export function ResourceAiInsight({ resourceType, name, namespace, context, onClose }: Props) {
  const [, navigate] = useLocation();
  const describe = useResourceDescribe(resourceType, name, context, namespace);
  const events = useResourceEvents(resourceType, name, context, namespace);
  const task = useAiTask("troubleshoot");
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  const gathering = describe.isLoading || events.isLoading;
  const run = () =>
    void task.run({
      resourceType, name, namespace, context,
      describe: describe.data?.content,
      events: events.data?.content,
    });

  // start once the resource's own data has arrived (or failed: the model still gets what there is)
  useEffect(() => {
    if (started.current || gathering) return;
    started.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gathering]);

  const discuss = () => {
    const prompt = `Continue investigating ${resourceType}/${name} in namespace ${namespace}. Look at logs, events, and dependent resources to identify the root cause and propose fixes.`;
    navigate(`/ai?prompt=${encodeURIComponent(prompt)}&context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(namespace)}`);
  };

  return (
    <section aria-label="AI diagnosis" className="mt-3 overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.04]">
      <header className="flex items-center gap-2 border-b border-primary/15 px-4 py-2">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <h2 className="text-[13px] font-semibold text-foreground">AI diagnosis</h2>
        <span className="truncate text-xs text-muted-foreground">
          {gathering ? "Reading the resource…" : task.loading ? "Analyzing…" : task.error ? "Couldn't finish" : "Based on describe output and events"}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {!task.loading && task.text && (
            <>
              <button type="button" onClick={run} className={iconButton} title="Analyze again" aria-label="Analyze again"><RefreshCw className="h-3.5 w-3.5" /></button>
              <button
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(task.text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
                className={iconButton}
                title="Copy"
                aria-label="Copy the diagnosis"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={discuss}
            className="flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
            title="Continue in Ask Deck"
          >
            <MessageSquare className="h-3 w-3" />Discuss in chat
          </button>
          <button type="button" onClick={() => { task.stop(); onClose(); }} className={iconButton} title="Close" aria-label="Close the diagnosis"><X className="h-3.5 w-3.5" /></button>
        </div>
      </header>
      <div className="max-h-[45vh] overflow-y-auto px-4 py-3 text-sm">
        {(gathering || (task.loading && !task.text)) && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />{gathering ? "Reading describe output and events…" : "Streaming the diagnosis…"}</p>
        )}
        {task.error && (
          <p className="flex items-start gap-2 text-xs text-destructive"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{task.error}</p>
        )}
        {task.text && <Markdown text={task.text} />}
      </div>
    </section>
  );
}
