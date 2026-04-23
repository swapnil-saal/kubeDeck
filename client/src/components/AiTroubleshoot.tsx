import { useState, useRef, useCallback } from "react";
import { Bot, X, Loader2, Copy, Check, AlertCircle } from "lucide-react";

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
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    setOpen(true);
    setContent("");
    setError(null);
    setLoading(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const res = await fetch("/api/ai/troubleshoot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(props),
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
      setError(err.message || "Troubleshoot failed");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [props]);

  const handleClose = () => {
    abortRef.current?.abort();
    setOpen(false);
    setContent("");
    setError(null);
    setLoading(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <button
        onClick={run}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border text-[9px] uppercase font-bold tracking-wider text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] hover:border-foreground/15 transition-colors"
        title="AI Troubleshoot"
      >
        <Bot className="w-3 h-3" />
        <span>AI Diagnose</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh]" onClick={handleClose}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden font-mono" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 h-10 border-b border-border bg-foreground/[0.02]">
              <Bot className="w-3.5 h-3.5 text-foreground/60" />
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground flex-1">
                AI Diagnosis — {props.resourceType}/{props.name}
              </span>
              {content && (
                <button onClick={handleCopy} className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors">
                  {copied ? <Check className="w-3 h-3 text-foreground/60" /> : <Copy className="w-3 h-3" />}
                </button>
              )}
              <button onClick={handleClose} className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-auto p-5">
              {loading && !content && (
                <div className="flex items-center gap-3 text-muted-foreground py-8 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-[11px]">Analyzing resource...</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded bg-destructive/10 border border-destructive/20 text-[10px] text-destructive mb-3">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {content && (
                <div className="prose prose-sm prose-invert max-w-none text-[11px] leading-relaxed text-foreground/80">
                  <SimpleMarkdown content={content} />
                </div>
              )}

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

function SimpleMarkdown({ content }: { content: string }) {
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
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.match(/^###\s/)) {
      elements.push(<h4 key={i} className="font-bold text-foreground/90 mt-4 mb-1 text-[11px]">{line.replace(/^###\s/, "")}</h4>);
    } else if (line.match(/^##\s/)) {
      elements.push(<h3 key={i} className="font-bold text-foreground/90 mt-4 mb-1 text-[12px]">{line.replace(/^##\s/, "")}</h3>);
    } else if (line.match(/^#\s/)) {
      elements.push(<h2 key={i} className="font-bold text-foreground mt-4 mb-1 text-[13px]">{line.replace(/^#\s/, "")}</h2>);
    } else if (line.match(/^\d+\.\s/)) {
      elements.push(<p key={i} className="pl-4 my-0.5"><InlineMarkdown text={line} /></p>);
    } else if (line.match(/^[-*]\s/)) {
      elements.push(<p key={i} className="pl-4 my-0.5"><InlineMarkdown text={line} /></p>);
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="my-0.5"><InlineMarkdown text={line} /></p>);
    }
  }

  return <>{elements}</>;
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-bold text-foreground/90">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i} className="bg-foreground/[0.06] px-1 py-0.5 rounded text-[10px] text-foreground/80">{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
