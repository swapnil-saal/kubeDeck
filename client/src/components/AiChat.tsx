import { useState, useRef, useEffect, useCallback } from "react";
import {
  X, Trash2, AlertCircle, Loader2,
  Square, RotateCcw, Copy, Check, ChevronDown,
  CheckCircle2, ArrowUp, GripVertical,
  Zap, Search, Bug, HelpCircle, Bot,
  ChevronRight, Terminal, Activity,
} from "lucide-react";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useSettings } from "@/hooks/use-settings";

interface ExecBlock {
  command: string;
  output?: string;
  exitCode?: number;
  running?: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: string;
  model?: string;
  timestamp: number;
  execs?: ExecBlock[];
  thinking?: string;
  iterations?: number;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const MIN_WIDTH = 380;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 480;

export function AiChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamContentRef = useRef("");
  const resizingRef = useRef(false);
  const { context, namespace } = useTerminalStore();
  const { data: settings } = useSettings();

  const providerLabel = settings?.ai?.provider || "openai";
  const modelLabel = settings?.ai?.model || "gpt-4o-mini";

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 80);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const handleSend = useCallback(async (retryContent?: string) => {
    const text = retryContent || input.trim();
    if (!text || streaming) return;

    if (!retryContent) setInput("");
    setError(null);
    setAutoScroll(true);

    const contextInfo = `[Context: ${context || "default"}, Namespace: ${namespace || "all"}]`;
    const userMsg: Message = {
      id: generateId(), role: "user", content: text, timestamp: Date.now(),
    };

    const newMessages = retryContent ? messages : [...messages, userMsg];
    if (!retryContent) setMessages(newMessages);

    const assistantId = generateId();
    setMessages([...newMessages, { id: assistantId, role: "assistant", content: "", timestamp: Date.now() }]);
    setStreaming(true);
    streamContentRef.current = "";

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const apiMessages = [
        { role: "system" as const, content: contextInfo },
        ...newMessages.map(m => ({ role: m.role, content: m.content })),
      ];

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, stream: true }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try { const errBody = await res.json(); errMsg = errBody.message || errMsg; } catch {}
        throw new Error(errMsg);
      }
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          try {
            const json = JSON.parse(payload);
            if (json.error) throw new Error(json.error);

            if (json.exec_start) {
              setMessages(prev => {
                const copy = [...prev];
                const idx = copy.findIndex(m => m.id === assistantId);
                if (idx !== -1) {
                  copy[idx] = { ...copy[idx], execs: [...(copy[idx].execs || []), { command: json.exec_start, running: true }] };
                }
                return copy;
              });
            }
            if (json.exec_result !== undefined) {
              setMessages(prev => {
                const copy = [...prev];
                const idx = copy.findIndex(m => m.id === assistantId);
                if (idx !== -1 && copy[idx].execs?.length) {
                  const execs = [...copy[idx].execs!];
                  execs[execs.length - 1] = { ...execs[execs.length - 1], output: json.exec_result, exitCode: json.exit_code ?? 0, running: false };
                  copy[idx] = { ...copy[idx], execs };
                }
                return copy;
              });
            }
            if (json.thinking) {
              setMessages(prev => {
                const copy = [...prev];
                const idx = copy.findIndex(m => m.id === assistantId);
                if (idx !== -1) {
                  const existing = copy[idx].thinking || "";
                  copy[idx] = { ...copy[idx], thinking: existing ? existing + "\n" + json.thinking : json.thinking };
                }
                return copy;
              });
            }
            if (json.text) {
              streamContentRef.current += json.text;
              const captured = streamContentRef.current;
              setMessages(prev => {
                const copy = [...prev];
                const idx = copy.findIndex(m => m.id === assistantId);
                if (idx !== -1) copy[idx] = { ...copy[idx], content: captured };
                return copy;
              });
            }
            if (json.done && json.model) {
              setMessages(prev => {
                const copy = [...prev];
                const idx = copy.findIndex(m => m.id === assistantId);
                if (idx !== -1) copy[idx] = { ...copy[idx], model: json.model, iterations: json.iterations };
                return copy;
              });
            }
          } catch (e: any) {
            if (e.message && !e.message.includes("JSON")) throw e;
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        if (streamContentRef.current) {
          setMessages(prev => {
            const copy = [...prev];
            const idx = copy.findIndex(m => m.id === assistantId);
            if (idx !== -1) copy[idx] = { ...copy[idx], content: streamContentRef.current + "\n\n*(stopped)*" };
            return copy;
          });
        } else {
          setMessages(prev => prev.filter(m => m.id !== assistantId));
        }
        return;
      }
      const errorMsg = err.message || "Failed to get response";
      setMessages(prev => {
        const copy = [...prev];
        const idx = copy.findIndex(m => m.id === assistantId);
        if (idx !== -1) copy[idx] = { ...copy[idx], content: streamContentRef.current || "", error: errorMsg };
        return copy;
      });
      setError(errorMsg);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, messages, streaming, context, namespace]);

  const handleRetry = useCallback((msgIdx: number) => {
    const userMsgs = messages.filter(m => m.role === "user");
    const lastUserMsg = userMsgs[userMsgs.length - 1];
    if (!lastUserMsg) return;
    setMessages(messages.slice(0, msgIdx));
    setError(null);
    setTimeout(() => handleSend(lastUserMsg.content), 50);
  }, [messages, handleSend]);

  const handleCopy = useCallback((content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleClear = () => { handleStop(); setMessages([]); setError(null); };

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startW = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      setWidth(Math.min(Math.max(startW + (startX - ev.clientX), MIN_WIDTH), MAX_WIDTH));
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [width]);

  if (!open) return null;

  const hasMessages = messages.length > 0;
  const suggestions = [
    { icon: Bug, text: "Why is my pod in CrashLoopBackOff?", cmd: "diagnose" },
    { icon: Search, text: "Show pods with high restart counts", cmd: "inspect" },
    { icon: Zap, text: "How do I scale a deployment?", cmd: "scale" },
    { icon: HelpCircle, text: "Explain Kubernetes resource limits", cmd: "explain" },
  ];

  return (
    <div className="fixed top-0 right-0 bottom-0 z-[90] flex animate-in slide-in-from-right duration-200" style={{ width }}>
      {/* Resize handle */}
      <div
        onMouseDown={onResizeStart}
        className="w-1 h-full cursor-col-resize group/resize shrink-0 relative"
      >
        <div className="absolute inset-y-0 left-0 w-px bg-border group-hover/resize:bg-primary transition-colors" />
      </div>

      {/* Panel */}
      <div className="flex-1 flex flex-col bg-background border-l border-border min-w-0 overflow-hidden">
        {/* Header — matches AppHeader style */}
        <div className="shrink-0 app-header" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <div className="flex items-center h-14 px-4 border-b border-border bg-card/95 backdrop-blur-xl">
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <span className="text-[13px] font-semibold text-foreground">AI Assistant</span>
              <span className="text-[10px] text-muted-foreground truncate ml-1">{providerLabel}/{modelLabel}</span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/5 border border-primary/15 rounded-lg text-[10px] text-muted-foreground mr-2">
              <div className="relative">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-primary animate-ping opacity-30" />
              </div>
              <span>{context || "default"}</span>
              <span className="text-muted-foreground/30">/</span>
              <span>{namespace || "all"}</span>
            </div>

            <div className="flex items-center gap-0.5">
              <button
                onClick={handleClear}
                disabled={!hasMessages}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-15 disabled:cursor-not-allowed transition-colors"
                title="Clear"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Close (⌘⇧I)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto min-h-0">
          {!hasMessages && !error && (
            <div className="flex flex-col h-full px-5 py-8">
              <div className="flex-1 flex flex-col items-center justify-center gap-4">
                <div className="p-3 rounded-2xl bg-primary/10">
                  <Terminal className="w-6 h-6 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground mb-1">KubeDeck AI</p>
                  <p className="text-xs text-muted-foreground max-w-[280px] leading-relaxed">
                    Ask anything about your cluster. I'll run commands, analyze output, and troubleshoot automatically.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 mt-auto">
                <p className="text-[10px] font-medium text-muted-foreground px-1 mb-2">Suggestions</p>
                {suggestions.map(({ icon: Icon, text, cmd }) => (
                  <button
                    key={text}
                    onClick={() => { setInput(text); setTimeout(() => inputRef.current?.focus(), 50); }}
                    className="group/sg flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl border border-border bg-muted/30 hover:bg-primary/5 hover:border-primary/20 transition-all"
                  >
                    <Icon className="w-3.5 h-3.5 text-muted-foreground group-hover/sg:text-primary transition-colors shrink-0" />
                    <span className="text-[11px] text-muted-foreground group-hover/sg:text-foreground transition-colors flex-1">{text}</span>
                    <span className="text-[9px] font-mono text-muted-foreground/40">{cmd}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasMessages && (
            <div className="py-2">
              {messages.map((msg, i) => (
                <MessageBlock
                  key={msg.id}
                  msg={msg}
                  streaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
                  copiedId={copiedId}
                  onCopy={handleCopy}
                  onRetry={() => handleRetry(i)}
                />
              ))}
            </div>
          )}

          {!autoScroll && hasMessages && (
            <button
              onClick={scrollToBottom}
              className="sticky bottom-3 left-1/2 -translate-x-1/2 z-10 p-1 rounded bg-card border border-border shadow-lg hover:bg-foreground/5 transition-all"
            >
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Error banner */}
        {error && !streaming && (
          <div className="mx-3 mb-2 flex items-start gap-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-[10px] text-destructive font-mono">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="p-0.5 hover:bg-destructive/10 rounded">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-border bg-card px-3 py-2.5 shrink-0">
          <div className="relative">
            <div className="absolute left-3 top-2.5 text-muted-foreground/30">
              <ChevronRight className="w-3.5 h-3.5" />
            </div>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your cluster..."
              rows={1}
              disabled={streaming}
              className="w-full bg-background border border-border rounded-md pl-8 pr-10 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/30 transition-all min-h-[36px] max-h-[120px] disabled:opacity-40"
              style={{ height: "auto" }}
              onInput={e => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
            />
            <div className="absolute right-1.5 bottom-1">
              {streaming ? (
                <button onClick={handleStop} className="p-1.5 rounded bg-destructive/20 hover:bg-destructive/30 text-destructive transition-all" title="Stop">
                  <Square className="w-3 h-3" />
                </button>
              ) : (
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  className="p-1.5 rounded bg-foreground/10 hover:bg-foreground/15 text-foreground disabled:opacity-15 transition-all"
                  title="Send (Enter)"
                >
                  <ArrowUp className="w-3 h-3" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between mt-1 px-1">
            <span className="text-[7px] font-mono uppercase tracking-wider text-muted-foreground/30">shift+enter newline</span>
            <span className="text-[7px] font-mono uppercase tracking-wider text-muted-foreground/30">⌘⇧I</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Message Block ───────────────────────────────

function MessageBlock({
  msg, streaming, copiedId, onCopy, onRetry,
}: {
  msg: Message;
  streaming: boolean;
  copiedId: string | null;
  onCopy: (content: string, id: string) => void;
  onRetry: () => void;
}) {
  const isUser = msg.role === "user";
  const hasContent = !!msg.content;
  const hasError = !!msg.error;
  const hasExecs = !!msg.execs?.length;
  const anyExecRunning = msg.execs?.some(e => e.running);
  const isWaitingForLLM = !hasContent && !hasError && !anyExecRunning && !hasExecs && streaming;

  if (isUser) {
    return (
      <div className="px-4 py-2.5 border-b border-border/40">
        <div className="flex items-start gap-2">
          <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted-foreground/60 mt-0.5 shrink-0 w-8">YOU</span>
          <p className="text-[11px] text-foreground leading-relaxed whitespace-pre-wrap flex-1">{msg.content}</p>
          <span className="text-[8px] font-mono text-muted-foreground/30 shrink-0 mt-0.5">{formatTime(msg.timestamp)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-border/40">
      {/* AI label + status bar */}
      <div className="flex items-center gap-2 px-4 py-1.5 bg-foreground/[0.02]">
        <Bot className="w-3 h-3 text-primary/70" />
        <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-primary/70">AI</span>

        {streaming && (
          <div className="flex items-center gap-1.5 ml-1">
            <PulsingDot />
            <span className="text-[8px] font-mono text-primary/50 animate-pulse">
              {anyExecRunning ? "EXECUTING" : hasExecs && !hasContent ? "ANALYZING" : hasContent ? "STREAMING" : "THINKING"}
            </span>
          </div>
        )}

        {!streaming && msg.iterations && msg.iterations > 1 && (
          <span className="text-[8px] font-mono text-muted-foreground/50 ml-1">{msg.iterations} steps</span>
        )}

        {msg.model && !streaming && (
          <span className="text-[8px] font-mono text-muted-foreground/30 ml-auto truncate max-w-[120px]">{msg.model}</span>
        )}
        {!streaming && (
          <span className="text-[8px] font-mono text-muted-foreground/30 ml-auto shrink-0">{formatTime(msg.timestamp)}</span>
        )}
      </div>

      <div className="px-4 py-2">
        {/* Thinking */}
        {msg.thinking && <ThinkingBlock text={msg.thinking} />}

        {/* Execution blocks */}
        {hasExecs && (
          <div className="space-y-2 my-1.5">
            {msg.execs!.map((exec, i) => <ExecBlockView key={i} exec={exec} />)}
          </div>
        )}

        {/* Waiting indicators */}
        {isWaitingForLLM && (
          <div className="flex items-center gap-2 py-2 text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[9px] font-mono">Connecting to {msg.model || "LLM"}...</span>
          </div>
        )}

        {hasExecs && !anyExecRunning && !hasContent && !hasError && streaming && (
          <div className="flex items-center gap-2 py-2 text-muted-foreground">
            <Activity className="w-3 h-3 animate-pulse" />
            <span className="text-[9px] font-mono">Analyzing command output...</span>
          </div>
        )}

        {/* Main content */}
        {hasContent && (
          <div className="text-[11px] leading-relaxed text-foreground/85 py-1">
            <MarkdownContent content={msg.content} />
            {streaming && (
              <span className="inline-block w-[2px] h-[13px] bg-primary ml-0.5 animate-pulse align-text-bottom" />
            )}
          </div>
        )}

        {/* Error */}
        {hasError && (
          <div className="flex items-center gap-2 py-2 text-destructive text-[10px] font-mono">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span>{msg.error}</span>
          </div>
        )}

        {/* Action bar */}
        {!streaming && (hasContent || hasError) && (
          <div className="flex items-center gap-2 pt-1 -mb-0.5">
            {hasContent && (
              <button
                onClick={() => onCopy(msg.content, msg.id)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-mono text-muted-foreground/40 hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                {copiedId === msg.id
                  ? <><Check className="w-2.5 h-2.5 text-emerald-500" /><span className="text-emerald-500">COPIED</span></>
                  : <><Copy className="w-2.5 h-2.5" /><span>COPY</span></>
                }
              </button>
            )}
            {hasError && (
              <button onClick={onRetry} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-mono text-destructive/60 hover:text-destructive hover:bg-destructive/5 transition-colors">
                <RotateCcw className="w-2.5 h-2.5" />
                <span>RETRY</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pulsing Dot ─────────────────────────────────

function PulsingDot() {
  return (
    <div className="relative">
      <div className="w-1.5 h-1.5 rounded-full bg-primary/70" />
      <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-primary/70 animate-ping" />
    </div>
  );
}

// ─── Thinking Block ──────────────────────────────

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const preview = lines[0]?.slice(0, 100) || "";

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="flex items-start gap-2 py-1.5 text-left w-full group/think"
    >
      <Activity className="w-3 h-3 text-muted-foreground/40 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted-foreground/40">REASONING</span>
        {expanded ? (
          <p className="text-[9px] text-muted-foreground/60 leading-relaxed whitespace-pre-wrap mt-0.5">{text}</p>
        ) : (
          <p className="text-[9px] text-muted-foreground/60 truncate mt-0.5">{preview}{lines.length > 1 ? "..." : ""}</p>
        )}
      </div>
      <ChevronDown className={`w-2.5 h-2.5 text-muted-foreground/30 shrink-0 mt-0.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
    </button>
  );
}

// ─── Exec Block ──────────────────────────────────

function ExecBlockView({ exec }: { exec: ExecBlock }) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(exec.output || exec.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const outputLines = exec.output?.split("\n") || [];
  const lineCount = outputLines.length;
  const isLong = lineCount > 15;
  const displayLines = expanded || !isLong ? outputLines.slice(0, expanded ? undefined : 12) : outputLines.slice(0, 12);

  return (
    <div className="rounded-md border border-border overflow-hidden bg-surface-inset">
      {/* Command line */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 bg-foreground/[0.03] border-b border-border/60 cursor-pointer"
        onClick={() => exec.output && setExpanded(!expanded)}
      >
        {exec.running ? (
          <Loader2 className="w-3 h-3 animate-spin text-primary/70 shrink-0" />
        ) : exec.exitCode === 0 ? (
          <CheckCircle2 className="w-3 h-3 text-emerald-500/80 shrink-0" />
        ) : (
          <AlertCircle className="w-3 h-3 text-destructive/80 shrink-0" />
        )}

        <span className="text-primary/50 text-[10px] font-mono shrink-0">$</span>
        <code className="text-[10px] font-mono text-foreground/75 truncate flex-1">{exec.command}</code>

        {exec.exitCode !== undefined && exec.exitCode !== 0 && !exec.running && (
          <span className="text-[8px] font-mono text-destructive/60 shrink-0">exit:{exec.exitCode}</span>
        )}

        {exec.output && (
          <button onClick={handleCopy} className="p-0.5 rounded hover:bg-foreground/5 text-muted-foreground/30 hover:text-foreground transition-colors shrink-0">
            {copied ? <Check className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
          </button>
        )}

        {exec.output && isLong && (
          <ChevronDown className={`w-3 h-3 text-muted-foreground/30 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </div>

      {/* Running */}
      {exec.running && !exec.output && (
        <div className="px-3 py-2 flex items-center gap-2 text-muted-foreground/50">
          <PulsingDot />
          <span className="text-[9px] font-mono animate-pulse">executing...</span>
        </div>
      )}

      {/* Output */}
      {exec.output && (
        <pre className="px-3 py-2 text-[9px] font-mono leading-relaxed text-foreground/60 overflow-x-auto max-h-[350px] overflow-y-auto whitespace-pre-wrap break-all">
          {displayLines.join("\n")}
          {isLong && !expanded && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              className="block w-full text-[8px] text-muted-foreground/40 hover:text-foreground mt-1 font-mono"
            >
              ↓ {lineCount - 12} more lines
            </button>
          )}
        </pre>
      )}
    </div>
  );
}

// ─── Markdown Renderer ───────────────────────────

function MarkdownContent({ content }: { content: string }) {
  if (!content) return null;

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      i++;
      const code = codeLines.join("\n");
      elements.push(
        <div key={elements.length} className="relative group/code my-2">
          <div className="flex items-center justify-between px-3 py-1 bg-foreground/[0.03] border border-border rounded-t-md">
            <span className="text-[7px] font-mono uppercase tracking-wider text-muted-foreground/40">{lang || "code"}</span>
            <button
              onClick={() => navigator.clipboard.writeText(code)}
              className="p-0.5 rounded opacity-0 group-hover/code:opacity-100 hover:bg-foreground/5 text-muted-foreground/30 hover:text-foreground transition-all"
            >
              <Copy className="w-2.5 h-2.5" />
            </button>
          </div>
          <pre className="bg-surface-inset border border-t-0 border-border rounded-b-md px-3 py-2 overflow-x-auto text-[10px] leading-relaxed">
            <code className="text-foreground/75 font-mono">{code}</code>
          </pre>
        </div>
      );
      continue;
    }

    if (!line.trim()) { elements.push(<div key={elements.length} className="h-1.5" />); i++; continue; }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls = level <= 2
        ? "text-[12px] font-bold text-foreground mt-3 mb-1"
        : "text-[11px] font-semibold text-foreground mt-2 mb-0.5";
      elements.push(<div key={elements.length} className={cls}>{renderInline(headingMatch[2])}</div>);
      i++; continue;
    }

    const ulMatch = line.match(/^(\s*)[*-]\s+(.+)/);
    if (ulMatch) {
      const indent = Math.floor(ulMatch[1].length / 2);
      elements.push(
        <div key={elements.length} className="flex gap-2 py-0.5" style={{ paddingLeft: indent * 14 }}>
          <span className="text-muted-foreground/50 shrink-0 text-[10px]">•</span>
          <span>{renderInline(ulMatch[2])}</span>
        </div>
      );
      i++; continue;
    }

    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (olMatch) {
      const num = line.match(/^(\s*)(\d+)\./)![2];
      const indent = Math.floor(olMatch[1].length / 2);
      elements.push(
        <div key={elements.length} className="flex gap-2 py-0.5" style={{ paddingLeft: indent * 14 }}>
          <span className="text-muted-foreground/50 shrink-0 font-mono text-[10px]">{num}.</span>
          <span>{renderInline(olMatch[2])}</span>
        </div>
      );
      i++; continue;
    }

    if (line.match(/^---+$/)) { elements.push(<hr key={elements.length} className="border-border/40 my-2" />); i++; continue; }

    elements.push(<p key={elements.length} className="leading-relaxed py-0.5">{renderInline(line)}</p>);
    i++;
  }

  return <div>{elements}</div>;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const seg = match[0];
    if (seg.startsWith("`") && seg.endsWith("`")) {
      parts.push(<code key={parts.length} className="bg-foreground/[0.06] px-1 py-[1px] rounded-sm text-[10px] font-mono text-foreground/90">{seg.slice(1, -1)}</code>);
    } else if (seg.startsWith("**") && seg.endsWith("**")) {
      parts.push(<strong key={parts.length} className="font-semibold text-foreground">{seg.slice(2, -2)}</strong>);
    } else if (seg.startsWith("*") && seg.endsWith("*")) {
      parts.push(<em key={parts.length} className="text-foreground/80">{seg.slice(1, -1)}</em>);
    } else if (match[2] && match[3]) {
      parts.push(<a key={parts.length} href={match[3]} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">{match[2]}</a>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
