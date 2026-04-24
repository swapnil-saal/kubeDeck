import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  X, Trash2, AlertCircle, Loader2,
  Square, RotateCcw, Copy, Check, ChevronDown,
  CheckCircle2, ArrowUp,
  Zap, Search, Bug, HelpCircle, Bot,
  ChevronRight, Terminal, Activity,
  Brain, GitBranch, Clock, Sparkles,
} from "lucide-react";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useSettings } from "@/hooks/use-settings";
import { AppHeader } from "@/components/AppHeader";

interface ExecBlock {
  command: string;
  output?: string;
  exitCode?: number;
  running?: boolean;
}

interface SubAgentBlock {
  id: string;
  goal: string;
  result?: string;
  running: boolean;
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
  subAgents?: SubAgentBlock[];
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function AiChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamContentRef = useRef("");
  const { context, namespace } = useTerminalStore();
  const { data: settings } = useSettings();

  const providerLabel = settings?.ai?.provider || "openai";
  const modelLabel = settings?.ai?.model || "gpt-4o-mini";

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

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
            if (json.sub_agent_start) {
              setMessages(prev => {
                const copy = [...prev];
                const idx = copy.findIndex(m => m.id === assistantId);
                if (idx !== -1) {
                  const agents = [...(copy[idx].subAgents || []), { id: json.id, goal: json.sub_agent_start, running: true }];
                  copy[idx] = { ...copy[idx], subAgents: agents };
                }
                return copy;
              });
            }
            if (json.sub_agent_done) {
              setMessages(prev => {
                const copy = [...prev];
                const idx = copy.findIndex(m => m.id === assistantId);
                if (idx !== -1 && copy[idx].subAgents?.length) {
                  const agents = copy[idx].subAgents!.map(a =>
                    a.id === json.id ? { ...a, result: json.result, running: false } : a
                  );
                  copy[idx] = { ...copy[idx], subAgents: agents };
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

  const hasMessages = messages.length > 0;
  const suggestions = [
    { icon: Bug, text: "Why is my pod in CrashLoopBackOff?", label: "diagnose" },
    { icon: Search, text: "Show pods with high restart counts", label: "inspect" },
    { icon: Zap, text: "Give me a full cluster health report", label: "health" },
    { icon: HelpCircle, text: "Compare resource usage across namespaces", label: "analyze" },
    { icon: GitBranch, text: "Check all deployments' rollout status", label: "rollout" },
    { icon: Sparkles, text: "Find misconfigured services", label: "audit" },
  ];

  const messageCount = useMemo(() => messages.filter(m => m.role === "user").length, [messages]);

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden text-foreground">
      <AppHeader
        breadcrumbs={[{ label: "AI Assistant" }]}
        showSelectors={true}
        rightSlot={
          <div className="flex items-center gap-2">
            {messageCount > 0 && (
              <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                {messageCount} message{messageCount !== 1 ? "s" : ""}
              </span>
            )}
            <button
              onClick={handleClear}
              disabled={!hasMessages}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition-all"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          </div>
        }
      />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto min-h-0">
          {/* Empty state */}
          {!hasMessages && !error && (
            <div className="flex flex-col h-full">
              <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6">
                <div className="p-4 rounded-2xl bg-primary/10">
                  <Bot className="w-8 h-8 text-primary" />
                </div>
                <div className="text-center max-w-lg">
                  <h1 className="text-xl font-semibold text-foreground mb-2">KubeDeck AI</h1>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Ask anything about your cluster. I run commands, analyze output, decompose complex tasks into parallel sub-agents, and troubleshoot automatically.
                  </p>
                </div>

                <div className="flex items-center gap-3 mt-1">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/5 border border-primary/15 rounded-lg text-xs text-muted-foreground">
                    <div className="relative">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-primary animate-ping opacity-30" />
                    </div>
                    <span className="font-medium">{context || "default"}</span>
                    <span className="text-muted-foreground/30">/</span>
                    <span className="font-medium">{namespace || "all"}</span>
                  </div>
                  <div className="px-3 py-1.5 bg-muted/50 border border-border rounded-lg text-xs text-muted-foreground">
                    {providerLabel} · <span className="font-mono">{modelLabel}</span>
                  </div>
                </div>
              </div>

              <div className="max-w-2xl w-full mx-auto px-6 pb-6">
                <p className="text-[11px] font-medium text-muted-foreground mb-3">Try asking</p>
                <div className="grid grid-cols-2 gap-2">
                  {suggestions.map(({ icon: Icon, text, label }) => (
                    <button
                      key={text}
                      onClick={() => { setInput(text); setTimeout(() => inputRef.current?.focus(), 50); }}
                      className="group flex items-start gap-3 text-left px-4 py-3 rounded-xl border border-border bg-card hover:bg-primary/5 hover:border-primary/20 transition-all"
                    >
                      <Icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <span className="text-[12px] text-foreground/80 group-hover:text-foreground transition-colors block leading-snug">{text}</span>
                        <span className="text-[10px] font-mono text-muted-foreground/40 mt-0.5 block">{label}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Messages */}
          {hasMessages && (
            <div className="max-w-3xl mx-auto w-full px-6 py-4">
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
              className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10 p-2 rounded-full bg-card border border-border shadow-lg hover:bg-muted transition-all"
            >
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Error banner */}
        {error && !streaming && (
          <div className="max-w-3xl mx-auto w-full px-6">
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive mb-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="p-1 hover:bg-destructive/10 rounded-lg">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-border bg-card/80 backdrop-blur-sm px-6 py-4 shrink-0">
          <div className="max-w-3xl mx-auto">
            <div className="relative rounded-xl border border-border bg-background shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your cluster..."
                rows={1}
                disabled={streaming}
                className="w-full bg-transparent px-4 pt-3.5 pb-10 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none min-h-[52px] max-h-[200px] disabled:opacity-40"
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 200) + "px";
                }}
              />
              <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground/40">
                    <kbd className="font-mono">Enter</kbd> send · <kbd className="font-mono">Shift+Enter</kbd> newline
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {streaming ? (
                    <button onClick={handleStop} className="p-2 rounded-lg bg-destructive/15 hover:bg-destructive/25 text-destructive transition-all" title="Stop">
                      <Square className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSend()}
                      disabled={!input.trim()}
                      className="p-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-20 disabled:bg-muted transition-all shadow-sm"
                      title="Send (Enter)"
                    >
                      <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              </div>
            </div>
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
  const hasSubAgents = !!msg.subAgents?.length;
  const anyExecRunning = msg.execs?.some(e => e.running);
  const anySubAgentRunning = msg.subAgents?.some(a => a.running);
  const isWaitingForLLM = !hasContent && !hasError && !anyExecRunning && !hasExecs && !hasSubAgents && streaming;

  if (isUser) {
    return (
      <div className="flex gap-3 mb-6">
        <div className="w-7 h-7 rounded-full bg-foreground/10 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-[10px] font-bold text-foreground/60">Y</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[12px] font-semibold text-foreground">You</span>
            <span className="text-[10px] text-muted-foreground/40">{formatTime(msg.timestamp)}</span>
          </div>
          <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 mb-6">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[12px] font-semibold text-foreground">AI</span>
          {streaming && (
            <div className="flex items-center gap-1.5">
              <PulsingDot />
              <span className="text-[10px] font-medium text-primary/70 animate-pulse">
                {anySubAgentRunning ? "Sub-agents working" : anyExecRunning ? "Executing" : hasExecs && !hasContent ? "Analyzing" : hasContent ? "Writing" : "Thinking"}
              </span>
            </div>
          )}
          {!streaming && msg.iterations && msg.iterations > 1 && (
            <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {msg.iterations} steps
            </span>
          )}
          {msg.model && !streaming && (
            <span className="text-[10px] font-mono text-muted-foreground/30 ml-auto truncate max-w-[160px]">{msg.model}</span>
          )}
          {!streaming && (
            <span className="text-[10px] text-muted-foreground/40 ml-auto">{formatTime(msg.timestamp)}</span>
          )}
        </div>

        {/* Thinking */}
        {msg.thinking && <ThinkingBlock text={msg.thinking} isStreaming={streaming} />}

        {/* Sub-agents */}
        {hasSubAgents && (
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-2">
              <GitBranch className="w-3.5 h-3.5 text-primary/50" />
              <span className="text-[11px] font-semibold text-foreground/70">Parallel Sub-Agents</span>
            </div>
            <div className="grid gap-2">
              {msg.subAgents!.map(agent => (
                <SubAgentView key={agent.id} agent={agent} />
              ))}
            </div>
          </div>
        )}

        {/* Execution blocks */}
        {hasExecs && (
          <div className="space-y-2 mb-3">
            {msg.execs!.map((exec, i) => <ExecBlockView key={i} exec={exec} />)}
          </div>
        )}

        {/* Waiting indicators */}
        {isWaitingForLLM && (
          <div className="flex items-center gap-2.5 py-3 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[12px]">Connecting to {msg.model || "LLM"}...</span>
          </div>
        )}

        {hasExecs && !anyExecRunning && !hasContent && !hasError && streaming && !hasSubAgents && (
          <div className="flex items-center gap-2.5 py-2 text-muted-foreground">
            <Activity className="w-4 h-4 animate-pulse" />
            <span className="text-[12px]">Analyzing command output...</span>
          </div>
        )}

        {/* Main content */}
        {hasContent && (
          <div className="text-[13px] leading-[1.7] text-foreground/90">
            <MarkdownContent content={msg.content} />
            {streaming && (
              <span className="inline-block w-[2px] h-[15px] bg-primary ml-0.5 animate-pulse align-text-bottom" />
            )}
          </div>
        )}

        {/* Error */}
        {hasError && (
          <div className="flex items-center gap-2.5 py-2 px-3 rounded-lg bg-destructive/10 border border-destructive/15 text-destructive text-[12px]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{msg.error}</span>
          </div>
        )}

        {/* Action bar */}
        {!streaming && (hasContent || hasError) && (
          <div className="flex items-center gap-1 mt-2">
            {hasContent && (
              <button
                onClick={() => onCopy(msg.content, msg.id)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
              >
                {copiedId === msg.id
                  ? <><Check className="w-3 h-3 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
                  : <><Copy className="w-3 h-3" /><span>Copy</span></>
                }
              </button>
            )}
            {hasError && (
              <button onClick={onRetry} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-destructive/60 hover:text-destructive hover:bg-destructive/5 transition-colors">
                <RotateCcw className="w-3 h-3" />
                <span>Retry</span>
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
      <div className="w-2 h-2 rounded-full bg-primary" />
      <div className="absolute inset-0 w-2 h-2 rounded-full bg-primary animate-ping opacity-40" />
    </div>
  );
}

// ─── Thinking Block ──────────────────────────────

function ThinkingBlock({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const previewLength = 150;
  const preview = text.slice(0, previewLength);
  const isLong = text.length > previewLength;

  return (
    <div className="mb-3 rounded-xl border border-primary/10 bg-primary/[0.03] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-2.5 px-3.5 py-2.5 w-full text-left group"
      >
        <Brain className={`w-4 h-4 text-primary/50 shrink-0 mt-0.5 ${isStreaming && !expanded ? "animate-pulse" : ""}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[11px] font-semibold text-primary/60">Chain of Thought</span>
            {isStreaming && <span className="text-[10px] text-primary/40 animate-pulse">thinking...</span>}
          </div>
          {expanded ? (
            <p className="text-[12px] text-foreground/60 leading-relaxed whitespace-pre-wrap">{text}</p>
          ) : (
            <p className="text-[12px] text-foreground/50 leading-relaxed">
              {preview}{isLong ? "..." : ""}
            </p>
          )}
        </div>
        {isLong && (
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 shrink-0 mt-1 transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </button>
    </div>
  );
}

// ─── Sub-Agent View ─────────────────────────────

function SubAgentView({ agent }: { agent: SubAgentBlock }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
      <button
        onClick={() => agent.result && setExpanded(!expanded)}
        className="flex items-center gap-2.5 px-3.5 py-2.5 w-full text-left"
      >
        {agent.running ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-semibold text-foreground/70 block">{agent.id}</span>
          <span className="text-[11px] text-muted-foreground truncate block">{agent.goal}</span>
        </div>
        {agent.result && (
          <ChevronDown className={`w-3 h-3 text-muted-foreground/30 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </button>
      {expanded && agent.result && (
        <div className="px-3.5 pb-3 border-t border-border/50">
          <pre className="text-[11px] text-foreground/60 whitespace-pre-wrap leading-relaxed mt-2">{agent.result}</pre>
        </div>
      )}
    </div>
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
    <div className="rounded-lg border border-border overflow-hidden bg-card">
      <div
        className="flex items-center gap-2 px-3.5 py-2 bg-muted/40 border-b border-border/60 cursor-pointer"
        onClick={() => exec.output && setExpanded(!expanded)}
      >
        {exec.running ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
        ) : exec.exitCode === 0 ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        ) : (
          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
        )}

        <span className="text-primary/60 text-[12px] font-mono shrink-0">$</span>
        <code className="text-[12px] font-mono text-foreground/75 truncate flex-1">{exec.command}</code>

        {exec.exitCode !== undefined && exec.exitCode !== 0 && !exec.running && (
          <span className="text-[10px] font-mono text-destructive/60 shrink-0">exit:{exec.exitCode}</span>
        )}

        {exec.output && (
          <button onClick={handleCopy} className="p-1 rounded-md hover:bg-muted text-muted-foreground/30 hover:text-foreground transition-colors shrink-0">
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>
        )}

        {exec.output && isLong && (
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </div>

      {exec.running && !exec.output && (
        <div className="px-3.5 py-2.5 flex items-center gap-2 text-muted-foreground">
          <PulsingDot />
          <span className="text-[11px] font-mono animate-pulse">executing...</span>
        </div>
      )}

      {exec.output && (
        <pre className="px-3.5 py-2.5 text-[11px] font-mono leading-relaxed text-foreground/60 overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all">
          {displayLines.join("\n")}
          {isLong && !expanded && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              className="block w-full text-[10px] text-primary/50 hover:text-primary mt-2 font-mono text-left"
            >
              ↓ Show {lineCount - 12} more lines
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
        <div key={elements.length} className="relative group/code my-3">
          <div className="flex items-center justify-between px-4 py-1.5 bg-muted/60 border border-border rounded-t-lg">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50">{lang || "code"}</span>
            <button
              onClick={() => navigator.clipboard.writeText(code)}
              className="p-1 rounded-md opacity-0 group-hover/code:opacity-100 hover:bg-muted text-muted-foreground/40 hover:text-foreground transition-all"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <pre className="bg-card border border-t-0 border-border rounded-b-lg px-4 py-3 overflow-x-auto text-[12px] leading-relaxed">
            <code className="text-foreground/80 font-mono">{code}</code>
          </pre>
        </div>
      );
      continue;
    }

    if (!line.trim()) { elements.push(<div key={elements.length} className="h-2" />); i++; continue; }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls = level === 1
        ? "text-[16px] font-bold text-foreground mt-5 mb-2"
        : level === 2
        ? "text-[14px] font-bold text-foreground mt-4 mb-1.5"
        : "text-[13px] font-semibold text-foreground mt-3 mb-1";
      elements.push(<div key={elements.length} className={cls}>{renderInline(headingMatch[2])}</div>);
      i++; continue;
    }

    const ulMatch = line.match(/^(\s*)[*-]\s+(.+)/);
    if (ulMatch) {
      const indent = Math.floor(ulMatch[1].length / 2);
      elements.push(
        <div key={elements.length} className="flex gap-2.5 py-0.5" style={{ paddingLeft: indent * 16 }}>
          <span className="text-primary/50 shrink-0 mt-[3px]">•</span>
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
        <div key={elements.length} className="flex gap-2.5 py-0.5" style={{ paddingLeft: indent * 16 }}>
          <span className="text-primary/50 shrink-0 font-mono text-[12px] mt-[1px] min-w-[16px]">{num}.</span>
          <span>{renderInline(olMatch[2])}</span>
        </div>
      );
      i++; continue;
    }

    if (line.match(/^---+$/)) { elements.push(<hr key={elements.length} className="border-border/40 my-3" />); i++; continue; }

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
      parts.push(<code key={parts.length} className="bg-primary/[0.08] text-foreground/90 px-1.5 py-[2px] rounded-md text-[12px] font-mono">{seg.slice(1, -1)}</code>);
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
