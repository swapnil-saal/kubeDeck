import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Bot, User, Trash2, AlertCircle, Loader2 } from "lucide-react";
import { useTerminalStore } from "@/hooks/use-terminal-store";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

const SYSTEM_PROMPT = `You are KubeDeck AI — an expert Kubernetes assistant embedded in a desktop cluster navigator. You help users understand, troubleshoot, and manage their Kubernetes clusters.

You have access to the user's current context and namespace. When suggesting kubectl commands, format them in code blocks.

Keep responses concise, use markdown formatting, and be practical. When diagnosing issues, always suggest specific kubectl commands.`;

export function AiChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { context, namespace } = useTerminalStore();

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setError(null);

    const contextInfo = `[Current context: ${context || "default"}, namespace: ${namespace || "all"}]`;
    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setStreaming(true);

    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages([...newMessages, assistantMsg]);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const apiMessages = [
        { role: "system" as const, content: SYSTEM_PROMPT + "\n\n" + contextInfo },
        ...newMessages.map(m => ({ role: m.role, content: m.content })),
      ];

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, stream: true }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(errBody.message || `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

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
            if (json.text) {
              fullContent += json.text;
              setMessages(prev => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: fullContent };
                return copy;
              });
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message || "Failed to get response");
      setMessages(prev => prev.filter(m => m.content !== ""));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, messages, streaming, context, namespace]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    if (streaming) abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
  };

  if (!open) return null;

  return (
    <div className="fixed top-0 right-0 bottom-0 w-[420px] z-[90] flex flex-col bg-background border-l border-border shadow-2xl font-mono">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border bg-surface/80 shrink-0 app-header"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <Bot className="w-4 h-4 text-foreground/70" />
        <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-foreground flex-1">
          KubeDeck AI
        </span>
        <button onClick={handleClear} className="p-1.5 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors" title="Clear chat">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors" title="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-12">
            <Bot className="w-10 h-10 text-muted-foreground/30" />
            <div>
              <p className="text-[12px] text-foreground/70 font-medium">KubeDeck AI Assistant</p>
              <p className="text-[10px] text-muted-foreground mt-1 max-w-[280px]">
                Ask about your cluster, troubleshoot issues, or get kubectl help.
              </p>
            </div>
            <div className="space-y-1.5 w-full max-w-[300px]">
              {[
                "Why is my pod crashing?",
                "Explain the resource limits in my deployment",
                "How do I debug a CrashLoopBackOff?",
                "What's using the most CPU in my cluster?",
              ].map(q => (
                <button
                  key={q}
                  onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 50); }}
                  className="block w-full text-left text-[10px] text-foreground/50 hover:text-foreground bg-foreground/[0.02] hover:bg-foreground/[0.05] px-3 py-2 rounded border border-border/50 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-6 h-6 rounded bg-foreground/[0.05] border border-border flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3 h-3 text-foreground/60" />
              </div>
            )}
            <div className={`max-w-[85%] rounded-lg px-3 py-2.5 text-[11px] leading-relaxed ${
              msg.role === "user"
                ? "bg-foreground/8 text-foreground border border-border"
                : "bg-card border border-border text-foreground/80"
            }`}>
              {msg.role === "assistant" ? (
                <div className="prose prose-sm prose-invert max-w-none">
                  <MarkdownContent content={msg.content || (streaming && i === messages.length - 1 ? "..." : "")} />
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-6 h-6 rounded bg-foreground/8 border border-border flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-3 h-3 text-foreground/60" />
              </div>
            )}
          </div>
        ))}

        {streaming && (
          <div className="flex items-center gap-2 text-muted-foreground px-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[9px] uppercase tracking-wider">thinking...</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded bg-destructive/10 border border-destructive/20 text-[10px] text-destructive">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border bg-surface/80 px-4 py-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your cluster..."
            rows={1}
            className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:border-foreground/20 transition-colors min-h-[36px] max-h-[120px] font-mono"
            style={{ height: "auto" }}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="p-2 rounded-lg bg-foreground/8 hover:bg-foreground/12 border border-border text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
            title="Send (Enter)"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[8px] text-muted-foreground/40 mt-1.5 text-center">
          Shift+Enter for newline · Responses from configured LLM
        </p>
      </div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  if (!content) return null;

  const parts = content.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|#{1,3}\s.+)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const inner = part.slice(3, -3);
          const newlineIdx = inner.indexOf("\n");
          const code = newlineIdx > -1 ? inner.slice(newlineIdx + 1) : inner;
          return (
            <pre key={i} className="bg-surface-inset border border-border rounded px-3 py-2 my-2 overflow-auto text-[10px]">
              <code className="text-foreground/70">{code}</code>
            </pre>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i} className="bg-foreground/[0.06] px-1 py-0.5 rounded text-[10px] text-foreground/80">{part.slice(1, -1)}</code>;
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-bold text-foreground/90">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("*") && part.endsWith("*") && !part.startsWith("**")) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        if (part.match(/^#{1,3}\s/)) {
          const level = part.match(/^(#{1,3})\s/)![1].length;
          const text = part.replace(/^#{1,3}\s/, "");
          const Tag = `h${level + 1}` as keyof JSX.IntrinsicElements;
          return <Tag key={i} className="font-bold text-foreground/90 mt-3 mb-1">{text}</Tag>;
        }
        return <span key={i} className="whitespace-pre-wrap">{part}</span>;
      })}
    </>
  );
}
