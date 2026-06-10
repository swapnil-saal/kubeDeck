import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Sparkles, RefreshCw, Loader2, MessageSquare, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Markdown } from "@/components/assistant/Markdown";

interface Props {
  resourceType: string;
  name: string;
  namespace: string;
  context: string;
  describe?: string;
  events?: string;
  logs?: string;
  /**
   * If false, the panel stays collapsed until the user expands it; AI is not
   * fetched until first expansion. Defaults to true (auto-fetch on mount).
   */
  autoRun?: boolean;
}

/**
 * Compact AI insight strip shown above the resource tabs. Auto-streams a brief
 * SRE-style diagnosis when describe/events are present, and offers a deep-link
 * to open the chat seeded with the resource's full context for follow-up.
 */
export function ResourceAiInsight({
  resourceType, name, namespace, context, describe, events, logs, autoRun = true,
}: Props) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(autoRun);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ranKeyRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);

  // Re-run when the resource's data signature changes meaningfully
  const dataKey = `${context}|${namespace}|${resourceType}|${name}|${(describe ?? "").length}|${(events ?? "").length}|${(logs ?? "").length}`;

  const run = async () => {
    if (!name) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    setContent("");
    try {
      const res = await fetch("/api/ai/troubleshoot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType, name, namespace, context, describe, events, logs }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload);
            if (j.error) { setError(j.error); break; }
            if (j.text) { full += j.text; setContent(full); }
          } catch { /* ignore */ }
        }
      }
      ranKeyRef.current = dataKey;
    } catch (err: any) {
      if (err?.name !== "AbortError") setError(err?.message || "Failed");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) return;
    if (!autoRun) return;
    if (!name) return;
    if (!describe && !events && !logs) return;
    if (ranKeyRef.current === dataKey) return;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dataKey, autoRun, name]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleDiscuss = () => {
    const prompt = `Continue investigating ${resourceType}/${name} in namespace ${namespace}. Look at logs, events, and dependent resources to identify the root cause and propose fixes.`;
    navigate(`/ai?q=${encodeURIComponent(prompt)}&context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(namespace)}`);
  };

  return (
    <div className="mx-6 mt-3 rounded-lg border border-primary/20 bg-primary/[0.03] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-primary/[0.05] transition-colors"
      >
        <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">AI Insight</span>
        <span className="text-[11px] text-muted-foreground truncate">
          {loading ? "Analyzing…" : error ? "Failed to analyze" : content ? "Diagnosis ready" : "Click to analyze this resource"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {content && !loading && (
            <button
              onClick={(e) => { e.stopPropagation(); void run(); }}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title="Re-analyze"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleDiscuss(); }}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md transition-colors"
            title="Open in chat for follow-up investigation"
          >
            <MessageSquare className="w-3 h-3" />
            Discuss in chat
          </button>
          {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-primary/15 px-4 py-3 bg-background/40">
          {loading && !content && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Loader2 className="w-3 h-3 animate-spin text-primary" />
              Streaming diagnosis…
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-2 py-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {content && (
            <div className="text-xs">
              <Markdown text={content} />
            </div>
          )}
          {!content && !loading && !error && !describe && !events && !logs && (
            <div className="text-xs text-muted-foreground italic">
              Open the Describe or Events tab — the AI will analyze them automatically next time.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
