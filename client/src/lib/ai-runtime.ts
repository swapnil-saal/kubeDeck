import type {
  LangChainMessage,
  LangGraphMessagesEvent,
  LangGraphStreamCallback,
} from "@assistant-ui/react-langgraph";

/**
 * Persists thread IDs so MemorySaver checkpoints survive page reloads
 * within the same browser session.
 */
const THREAD_KEY = "kubedeck.ai.threadId";

export function getThreadId(): string {
  try {
    let id = sessionStorage.getItem(THREAD_KEY);
    if (!id) {
      id = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(THREAD_KEY, id);
    }
    return id;
  } catch {
    return `thread_${Date.now()}`;
  }
}

export function resetThreadId(): string {
  const id = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try { sessionStorage.setItem(THREAD_KEY, id); } catch {}
  return id;
}

interface BuildStreamOptions {
  api?: string;
  /** Build the system message that prefixes each request (e.g. context/namespace). */
  systemMessage?: () => string;
  /** Override or supply the thread id for this stream. */
  threadId?: () => string;
}

/**
 * Builds a LangGraphStreamCallback that POSTs messages to our `/api/ai/chat`
 * endpoint and yields `{ event, data }` chunks parsed from the SSE stream.
 */
export function buildKubeChatStream(
  opts: BuildStreamOptions = {},
): LangGraphStreamCallback<LangChainMessage> {
  const api = opts.api ?? "/api/ai/chat";

  return async function* stream(messages, config) {
    const systemContent = opts.systemMessage?.() ?? "";

    // If the runtime is resuming a HITL interrupt, send only the resume value.
    // assistant-ui's useLangGraphSendCommand sets config.command.resume.
    const resumeValue = (config as { command?: { resume?: string } }).command?.resume;

    const tid = opts.threadId?.() ?? getThreadId();

    const body: Record<string, unknown> = {
      threadId: tid,
      stream: true,
    };

    if (resumeValue !== undefined) {
      body.resume = resumeValue;
    } else {
      body.messages = [
        ...(systemContent ? [{ role: "system" as const, content: systemContent }] : []),
        ...messages.map((m) => ({
          role: m.type === "human" ? "user" : m.type === "ai" ? "assistant" : "system",
          content: typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content)
              ? m.content
                  .map((p: any) => (typeof p === "string" ? p : p?.text ?? ""))
                  .join("")
              : "",
        })),
      ];
    }

    const res = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: config.abortSignal,
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        msg = body.message || msg;
      } catch {}
      throw new Error(msg);
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
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as LangGraphMessagesEvent<LangChainMessage>;
          if (parsed && parsed.event) {
            yield parsed;
          }
        } catch {
          /* ignore malformed chunks */
        }
      }
    }
  };
}
