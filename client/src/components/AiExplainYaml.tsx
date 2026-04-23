import { useState, useRef, useCallback } from "react";
import { Bot, X, Loader2, AlertCircle } from "lucide-react";

interface Props {
  yaml: string;
  resourceType: string;
}

export function AiExplainButton({ yaml, resourceType }: Props) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    setOpen(true);
    setContent("");
    setError(null);
    setLoading(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const res = await fetch("/api/ai/explain-yaml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml, resourceType }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.error) { setError(json.error); break; }
            if (json.text) { full += json.text; setContent(full); }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message || "Explain failed");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [yaml, resourceType]);

  const handleClose = () => {
    abortRef.current?.abort();
    setOpen(false);
    setContent("");
    setError(null);
    setLoading(false);
  };

  return (
    <>
      <button
        onClick={run}
        disabled={!yaml}
        className="flex items-center gap-1 px-2 py-1 rounded border border-border text-[9px] uppercase font-bold tracking-wider text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] hover:border-foreground/15 transition-colors disabled:opacity-30"
        title="AI Explain this YAML"
      >
        <Bot className="w-3 h-3" />
        Explain
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh]" onClick={handleClose}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden font-mono" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 h-10 border-b border-border bg-foreground/[0.02]">
              <Bot className="w-3.5 h-3.5 text-foreground/60" />
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground flex-1">
                AI YAML Explanation
              </span>
              <button onClick={handleClose} className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-auto p-5 text-[11px] leading-relaxed text-foreground/80">
              {loading && !content && (
                <div className="flex items-center gap-3 text-muted-foreground py-8 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Analyzing YAML...</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded bg-destructive/10 border border-destructive/20 text-[10px] text-destructive mb-3">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {content && <ExplainMarkdown content={content} />}

              {loading && content && (
                <div className="flex items-center gap-2 text-muted-foreground mt-3">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span className="text-[9px] uppercase tracking-wider">streaming...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ExplainMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: JSX.Element[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${codeKey++}`} className="bg-surface-inset border border-border rounded px-3 py-2 my-2 overflow-auto text-[10px]">
            <code className="text-foreground/70">{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else { inCodeBlock = true; }
      continue;
    }
    if (inCodeBlock) { codeLines.push(line); continue; }

    if (line.match(/^###\s/)) {
      elements.push(<h4 key={i} className="font-bold text-foreground/90 mt-4 mb-1">{renderInline(line.replace(/^###\s/, ""))}</h4>);
    } else if (line.match(/^##\s/)) {
      elements.push(<h3 key={i} className="font-bold text-foreground/90 mt-4 mb-1 text-[12px]">{renderInline(line.replace(/^##\s/, ""))}</h3>);
    } else if (line.match(/^#\s/)) {
      elements.push(<h2 key={i} className="font-bold text-foreground mt-4 mb-1 text-[13px]">{renderInline(line.replace(/^#\s/, ""))}</h2>);
    } else if (line.match(/^\d+\.\s/) || line.match(/^[-*]\s/)) {
      elements.push(<p key={i} className="pl-4 my-0.5">{renderInline(line)}</p>);
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="my-0.5">{renderInline(line)}</p>);
    }
  }
  return <>{elements}</>;
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="font-bold text-foreground/90">{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="bg-foreground/[0.06] px-1 py-0.5 rounded text-[10px] text-foreground/80">{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}
