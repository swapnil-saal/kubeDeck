/**
 * OpenAI-compatible gateway quirks:
 *
 * - Some models (e.g. saal-dgx on gpt3) put the assistant text in `reasoning`
 *   while leaving `content` null. LangChain only reads `content` /
 *   `reasoning_content`, so answers become blank after tool rounds.
 * - XML-style tool calls are handled separately in xml-tool-calls.ts.
 *
 * This fetch wrapper normalizes chat.completion (+ stream) payloads before
 * LangChain parses them.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function coerceMessageText(message: Record<string, unknown>): void {
  const content = message.content;
  const contentEmpty =
    content == null ||
    content === "" ||
    (Array.isArray(content) && content.length === 0);

  if (!contentEmpty) return;

  const reasoning =
    (typeof message.reasoning === "string" && message.reasoning) ||
    (typeof message.reasoning_content === "string" && message.reasoning_content) ||
    "";

  if (reasoning) {
    message.content = reasoning;
    // Preserve original for debugging / future reasoning UIs
    if (message.reasoning_content == null && typeof message.reasoning === "string") {
      message.reasoning_content = message.reasoning;
    }
  }
}

function normalizeCompletionJson(body: unknown): unknown {
  if (!isRecord(body) || !Array.isArray(body.choices)) return body;
  for (const choice of body.choices) {
    if (!isRecord(choice)) continue;
    if (isRecord(choice.message)) coerceMessageText(choice.message);
    if (isRecord(choice.delta)) coerceMessageText(choice.delta);
  }
  return body;
}

function looksLikeChatCompletions(url: string | URL | Request): boolean {
  const u =
    typeof url === "string"
      ? url
      : url instanceof URL
        ? url.href
        : url.url;
  return /\/chat\/completions\b/.test(u);
}

/**
 * Drop-in `fetch` for ChatOpenAI `configuration.fetch`.
 * Only rewrites chat/completions responses; everything else is pass-through.
 */
export async function openaiCompatFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (!looksLikeChatCompletions(input) || !res.ok) return res;

  const contentType = res.headers.get("content-type") || "";

  // Streaming SSE
  if (contentType.includes("text/event-stream") && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer) controller.enqueue(encoder.encode(buffer));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        const out: string[] = [];
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const payload = line.slice(6).trim();
            if (payload && payload !== "[DONE]") {
              try {
                const parsed = normalizeCompletionJson(JSON.parse(payload));
                out.push(`data: ${JSON.stringify(parsed)}`);
                continue;
              } catch {
                /* keep original line */
              }
            }
          }
          out.push(line);
        }
        controller.enqueue(encoder.encode(out.join("\n") + (out.length ? "\n" : "")));
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  // Non-streaming JSON
  if (contentType.includes("application/json") || contentType.includes("text/plain")) {
    const text = await res.text();
    try {
      const fixed = JSON.stringify(normalizeCompletionJson(JSON.parse(text)));
      return new Response(fixed, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    } catch {
      return new Response(text, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
  }

  return res;
}
