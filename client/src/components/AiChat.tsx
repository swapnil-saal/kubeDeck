import { useState, useRef, useEffect, useCallback } from "react";
import {
  X, Send, Bot, User, Trash2, AlertCircle, Loader2,
  Square, RotateCcw, Copy, Check, ChevronDown, Sparkles,
  Terminal, Play, CheckCircle2,
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
  exec?: ExecBlock;
}

const SYSTEM_PROMPT = `You are KubeDeck AI — an expert Kubernetes assistant embedded in a desktop cluster navigator. You help users understand, troubleshoot, and manage their Kubernetes clusters.

You have access to the user's current context and namespace. When suggesting kubectl commands, format them in markdown code blocks with \`bash\` language tag.

Rules:
- Be concise and practical
- Use markdown formatting (headers, bold, code blocks, lists)
- When diagnosing issues, suggest specific kubectl commands
- If unsure, say so — don't hallucinate
- Structure complex answers with headers`;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function AiChat({ open, onClose }: { open: boolean; onClose: () => void }) {
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

    const newMessages = retryContent
      ? messages
      : [...messages, userMsg];

    if (!retryContent) setMessages(newMessages);

    const assistantId = generateId();
    const assistantMsg: Message = {
      id: assistantId, role: "assistant", content: "", timestamp: Date.now(),
    };
    setMessages([...newMessages, assistantMsg]);
    setStreaming(true);
    streamContentRef.current = "";

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
        let errMsg = `HTTP ${res.status}`;
        try {
          const errBody = await res.json();
          errMsg = errBody.message || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      if (!res.body) throw new Error("No response body — streaming not supported");

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
                if (idx !== -1) copy[idx] = { ...copy[idx], exec: { command: json.exec_start, running: true } };
                return copy;
              });
            }
            if (json.exec_result !== undefined) {
              setMessages(prev => {
                const copy = [...prev];
                const idx = copy.findIndex(m => m.id === assistantId);
                if (idx !== -1) {
                  copy[idx] = {
                    ...copy[idx],
                    exec: {
                      ...copy[idx].exec!,
                      output: json.exec_result,
                      exitCode: json.exit_code ?? 0,
                      running: false,
                    },
                  };
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
                if (idx !== -1) copy[idx] = { ...copy[idx], model: json.model };
                return copy;
              });
            }
          } catch (e: any) {
            if (e.message && !e.message.includes("JSON")) throw e;
          }
        }
      }

      if (!streamContentRef.current) {
        throw new Error("Empty response from LLM. Check your AI settings or API key.");
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
        if (idx !== -1) {
          if (streamContentRef.current) {
            copy[idx] = { ...copy[idx], content: streamContentRef.current, error: errorMsg };
          } else {
            copy[idx] = { ...copy[idx], content: "", error: errorMsg };
          }
        }
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
    const trimmed = messages.slice(0, msgIdx);
    setMessages(trimmed);
    setError(null);
    setTimeout(() => handleSend(lastUserMsg.content), 50);
  }, [messages, handleSend]);

  const handleCopy = useCallback((content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    handleStop();
    setMessages([]);
    setError(null);
  };

  const handleSuggestion = (q: string) => {
    setInput(q);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  if (!open) return null;

  const hasMessages = messages.length > 0;

  return (
    <div className="fixed top-0 right-0 bottom-0 w-[420px] z-[90] flex flex-col bg-background border-l border-border shadow-2xl">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 h-12 border-b border-border bg-card/80 backdrop-blur-sm shrink-0 app-header"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-6 h-6 rounded-md bg-foreground/[0.06] border border-border flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-foreground/70" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[11px] font-semibold text-foreground truncate">
              KubeDeck AI
            </span>
            <span className="text-[8px] text-muted-foreground/60 font-mono truncate">
              {providerLabel}/{modelLabel}
            </span>
          </div>
        </div>
        <button
          onClick={handleClear}
          disabled={!hasMessages}
          className="p-1.5 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title="Clear chat"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors"
          title="Close (⌘⇧I)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto min-h-0"
      >
        {!hasMessages && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-5 px-6 py-12">
            <div className="w-12 h-12 rounded-xl bg-foreground/[0.04] border border-border/50 flex items-center justify-center">
              <Bot className="w-6 h-6 text-muted-foreground/40" />
            </div>
            <div>
              <p className="text-[13px] text-foreground/80 font-medium">
                Ask anything about your cluster
              </p>
              <p className="text-[10px] text-muted-foreground/50 mt-1.5 max-w-[280px] leading-relaxed">
                Troubleshoot pods, explain configs, generate kubectl commands, and more.
              </p>
            </div>
            <div className="space-y-1.5 w-full max-w-[320px]">
              {[
                "Why is my pod in CrashLoopBackOff?",
                "Show me pods with high restart counts",
                "How do I scale a deployment?",
                "Explain Kubernetes resource limits",
              ].map(q => (
                <button
                  key={q}
                  onClick={() => handleSuggestion(q)}
                  className="block w-full text-left text-[10px] text-muted-foreground/70 hover:text-foreground bg-card hover:bg-foreground/[0.04] px-3 py-2.5 rounded-lg border border-border/40 hover:border-border transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {hasMessages && (
          <div className="px-3 py-4 space-y-1">
            {messages.map((msg, i) => (
              <ChatBubble
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

        {/* Scroll-to-bottom anchor */}
        {!autoScroll && hasMessages && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 p-1.5 rounded-full bg-card border border-border shadow-lg hover:bg-foreground/5 transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Global error banner */}
      {error && !streaming && (
        <div className="mx-3 mb-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/8 border border-destructive/20 text-[10px] text-destructive">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1 leading-relaxed">{error}</span>
          <button
            onClick={() => setError(null)}
            className="p-0.5 hover:bg-destructive/10 rounded"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border bg-card/50 px-3 py-2.5 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your cluster..."
            rows={1}
            disabled={streaming}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:ring-1 focus:ring-foreground/10 focus:border-foreground/20 transition-all min-h-[36px] max-h-[120px] disabled:opacity-50"
            style={{ height: "auto" }}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
          />
          {streaming ? (
            <button
              onClick={handleStop}
              className="p-2 rounded-lg bg-destructive/10 hover:bg-destructive/20 border border-destructive/20 text-destructive transition-colors shrink-0"
              title="Stop generating"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="p-2 rounded-lg bg-foreground/[0.06] hover:bg-foreground/10 border border-border text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors shrink-0"
              title="Send (Enter)"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <p className="text-[8px] text-muted-foreground/30 mt-1.5 text-center">
          Shift+Enter for newline · ⌘⇧I to toggle
        </p>
      </div>
    </div>
  );
}

function ChatBubble({
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
  const hasExec = !!msg.exec;
  const isWaitingForExec = hasExec && msg.exec!.running && !hasContent;
  const isWaitingForLLM = !hasContent && !hasError && !isWaitingForExec && streaming;

  return (
    <div className={`group flex gap-2.5 py-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 mt-0.5 ${
        isUser
          ? "bg-foreground/[0.06] border-border"
          : "bg-foreground/[0.03] border-border/60"
      }`}>
        {isUser
          ? <User className="w-3 h-3 text-foreground/50" />
          : <Bot className="w-3 h-3 text-foreground/50" />
        }
      </div>

      <div className={`flex flex-col gap-1.5 max-w-[90%] min-w-0 ${isUser ? "items-end" : "items-start"}`}>
        {/* Execution block */}
        {hasExec && (
          <ExecBlockView exec={msg.exec!} />
        )}

        {/* Main text bubble */}
        {(hasContent || hasError || isWaitingForLLM) && (
          <div className={`rounded-xl px-3 py-2.5 text-[11px] leading-relaxed ${
            isUser
              ? "bg-foreground/[0.07] text-foreground border border-border/60"
              : "bg-card text-foreground/85 border border-border/40"
          }`}>
            {isUser ? (
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            ) : hasContent ? (
              <MarkdownContent content={msg.content} />
            ) : hasError ? (
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>{msg.error}</span>
              </div>
            ) : isWaitingForLLM ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground/60 text-[10px]">Thinking...</span>
              </div>
            ) : null}

            {streaming && hasContent && (
              <span className="inline-block w-[2px] h-[14px] bg-foreground/40 ml-0.5 animate-pulse align-text-bottom" />
            )}
          </div>
        )}

        {/* Waiting for exec (no text bubble yet) */}
        {isWaitingForExec && !hasContent && !hasError && (
          <div className="flex items-center gap-2 px-2 py-1 text-muted-foreground/60">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[9px]">Executing command...</span>
          </div>
        )}

        {/* Action bar for assistant messages */}
        {!isUser && hasContent && !streaming && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onCopy(msg.content, msg.id)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              {copiedId === msg.id
                ? <><Check className="w-2.5 h-2.5 text-emerald-500" /><span>Copied</span></>
                : <><Copy className="w-2.5 h-2.5" /><span>Copy</span></>
              }
            </button>
            {msg.model && (
              <span className="text-[8px] text-muted-foreground/40 font-mono px-1">{msg.model}</span>
            )}
          </div>
        )}

        {/* Error with retry */}
        {hasError && !streaming && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] text-destructive/80 hover:text-destructive hover:bg-destructive/5 transition-colors"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Retry</span>
          </button>
        )}
      </div>
    </div>
  );
}

function ExecBlockView({ exec }: { exec: ExecBlock }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(exec.output || exec.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const outputLines = exec.output?.split("\n") || [];
  const lineCount = outputLines.length;
  const isLong = lineCount > 12;
  const displayLines = expanded ? outputLines : outputLines.slice(0, 10);

  return (
    <div className="w-full rounded-lg border border-border/60 bg-foreground/[0.02] overflow-hidden">
      {/* Command header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-foreground/[0.03]">
        {exec.running ? (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        ) : exec.exitCode === 0 ? (
          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
        ) : (
          <AlertCircle className="w-3 h-3 text-destructive" />
        )}
        <code className="text-[10px] font-mono text-foreground/70 flex-1 truncate">{exec.command}</code>
        {exec.output && (
          <button onClick={handleCopy} className="p-0.5 rounded hover:bg-foreground/5 text-muted-foreground/50 hover:text-foreground transition-colors">
            {copied ? <Check className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
          </button>
        )}
      </div>

      {/* Output */}
      {exec.running && !exec.output && (
        <div className="px-3 py-3 flex items-center gap-2 text-muted-foreground/50">
          <Play className="w-3 h-3" />
          <span className="text-[9px] font-mono">Running...</span>
        </div>
      )}

      {exec.output && (
        <div className="relative">
          <pre className="px-3 py-2 text-[9px] font-mono leading-relaxed text-foreground/60 overflow-x-auto max-h-[300px] overflow-y-auto">
            {displayLines.join("\n")}
          </pre>
          {isLong && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="w-full px-3 py-1.5 text-[8px] text-center text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.03] border-t border-border/30 transition-colors font-mono"
            >
              Show all {lineCount} lines
            </button>
          )}
          {isLong && expanded && (
            <button
              onClick={() => setExpanded(false)}
              className="w-full px-3 py-1.5 text-[8px] text-center text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.03] border-t border-border/30 transition-colors font-mono"
            >
              Collapse
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  if (!content) return null;

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const code = codeLines.join("\n");
      elements.push(
        <div key={elements.length} className="relative group/code my-2">
          {lang && (
            <div className="absolute top-0 left-0 px-2 py-0.5 text-[7px] uppercase tracking-wider text-muted-foreground/40 font-mono">
              {lang}
            </div>
          )}
          <pre className="bg-foreground/[0.04] border border-border/50 rounded-md px-3 py-2.5 pt-5 overflow-x-auto text-[10px] leading-relaxed">
            <code className="text-foreground/75 font-mono">{code}</code>
          </pre>
          <button
            onClick={() => navigator.clipboard.writeText(code)}
            className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover/code:opacity-100 bg-background/80 border border-border/50 hover:bg-foreground/5 transition-all"
            title="Copy code"
          >
            <Copy className="w-2.5 h-2.5 text-muted-foreground" />
          </button>
        </div>
      );
      continue;
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={elements.length} className="h-2" />);
      i++;
      continue;
    }

    // Headers
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const sizes: Record<number, string> = {
        1: "text-[13px] font-bold",
        2: "text-[12px] font-bold",
        3: "text-[11px] font-semibold",
        4: "text-[11px] font-semibold",
      };
      elements.push(
        <div key={elements.length} className={`${sizes[level]} text-foreground/90 mt-3 mb-1`}>
          {renderInline(text)}
        </div>
      );
      i++;
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[*-]\s+(.+)/);
    if (ulMatch) {
      const indent = Math.floor((ulMatch[1].length) / 2);
      elements.push(
        <div key={elements.length} className="flex gap-2" style={{ paddingLeft: indent * 12 }}>
          <span className="text-muted-foreground/50 shrink-0 mt-[1px]">•</span>
          <span>{renderInline(ulMatch[2])}</span>
        </div>
      );
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (olMatch) {
      const num = line.match(/^(\s*)(\d+)\./)![2];
      const indent = Math.floor((olMatch[1].length) / 2);
      elements.push(
        <div key={elements.length} className="flex gap-2" style={{ paddingLeft: indent * 12 }}>
          <span className="text-muted-foreground/50 shrink-0 font-mono text-[10px] mt-[1px]">{num}.</span>
          <span>{renderInline(olMatch[2])}</span>
        </div>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      elements.push(<hr key={elements.length} className="border-border/30 my-2" />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={elements.length} className="leading-relaxed">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const seg = match[0];
    if (seg.startsWith("`") && seg.endsWith("`")) {
      parts.push(
        <code key={parts.length} className="bg-foreground/[0.06] px-1 py-[1px] rounded text-[10px] font-mono text-foreground/80">
          {seg.slice(1, -1)}
        </code>
      );
    } else if (seg.startsWith("**") && seg.endsWith("**")) {
      parts.push(<strong key={parts.length} className="font-semibold text-foreground/90">{seg.slice(2, -2)}</strong>);
    } else if (seg.startsWith("*") && seg.endsWith("*")) {
      parts.push(<em key={parts.length}>{seg.slice(1, -1)}</em>);
    } else if (match[2] && match[3]) {
      parts.push(
        <a key={parts.length} href={match[3]} target="_blank" rel="noopener noreferrer" className="text-foreground/70 underline underline-offset-2 hover:text-foreground">
          {match[2]}
        </a>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
