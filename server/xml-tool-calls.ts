import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { randomUUID } from "crypto";

/**
 * OpenAI-compatible gateways (vLLM + Qwen, etc.) often ignore native
 * `message.tool_calls` and instead emit tool invocations as text.
 *
 * LangChain only executes structured tool_calls, so without this parser
 * the agent treats the XML as a final answer and never runs tools.
 */

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  type: "tool_call";
}

// Standard XML blocks
const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
// Qwen / Hermes: <function=name>{...}</function> or <function name="x">
const FUNCTION_XML_RE =
  /<function(?:=|\s+name=)["']?([A-Za-z0-9_.-]+)["']?\s*>([\s\S]*?)<\/function>/gi;
// Qwen hermes markers: ✿function✿name\n✿arguments✿{...}
const HERMES_RE =
  /✿function✿\s*([A-Za-z0-9_.-]+)\s*(?:\n|\r\n)?✿arguments✿\s*([\s\S]*?)(?=✿function✿|$)/gi;
// Bare JSON tool call line often used by local models
const BARE_JSON_CALL_RE =
  /^\s*\{\s*"name"\s*:\s*"([A-Za-z0-9_.-]+)"\s*,\s*"(?:arguments|parameters|args)"\s*:\s*(\{[\s\S]*\}|\[[\s\S]*\]|"[^"]*")\s*\}\s*$/m;

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === "string" ? part : part?.text || ""))
      .join("");
  }
  return "";
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { input: parsed };
    } catch {
      // Keyword=value lines: command=get pods
      if (trimmed.includes("=") && !trimmed.startsWith("{")) {
        const out: Record<string, unknown> = {};
        for (const line of trimmed.split(/\n|;/)) {
          const m = line.trim().match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
          if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
        if (Object.keys(out).length) return out;
      }
      // Heuristic: if tool is kubectl-like, treat free text as command
      return { command: trimmed, input: trimmed };
    }
  }
  return { input: raw };
}

function makeCall(name: string, args: Record<string, unknown>, id?: string): ParsedToolCall {
  return {
    id: id && id.length > 0 ? id : `call_${randomUUID()}`,
    name,
    args,
    type: "tool_call",
  };
}

function parseOneToolCallBlock(inner: string): ParsedToolCall | null {
  const trimmed = inner.trim();
  if (!trimmed) return null;

  // Primary format: {"name":"...","arguments":{...}}
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object" && typeof obj.name === "string") {
      return makeCall(
        obj.name,
        parseArguments(obj.arguments ?? obj.parameters ?? obj.args ?? {}),
        typeof obj.id === "string" ? obj.id : undefined,
      );
    }
  } catch {
    /* fall through */
  }

  // name on first line, JSON / key=value on remaining
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 1 && /^[A-Za-z0-9_.-]+$/.test(lines[0])) {
    const name = lines[0];
    const argsRaw = lines.slice(1).join("\n").trim();
    return makeCall(name, argsRaw ? parseArguments(argsRaw) : {});
  }

  // invoke tool kubectl with command is get pods
  const invokeMatch = trimmed.match(
    /(?:invoke|call|run)\s+(?:tool\s+)?([A-Za-z0-9_.-]+)\s+(?:with\s+)?([\s\S]+)/i,
  );
  if (invokeMatch) {
    return makeCall(invokeMatch[1], parseArguments(invokeMatch[2]));
  }

  return null;
}

/**
 * Extract tool call blocks from assistant text.
 * Returns cleaned content (tool XML stripped) and structured tool_calls.
 */
export function parseXmlToolCalls(content: string): {
  cleaned: string;
  toolCalls: ParsedToolCall[];
} {
  if (!content) return { cleaned: content, toolCalls: [] };

  const toolCalls: ParsedToolCall[] = [];
  let cleaned = content;

  cleaned = cleaned.replace(TOOL_CALL_RE, (_match, inner: string) => {
    const parsed = parseOneToolCallBlock(inner);
    if (parsed) toolCalls.push(parsed);
    return "";
  });

  cleaned = cleaned.replace(FUNCTION_XML_RE, (_m, name: string, body: string) => {
    toolCalls.push(makeCall(name, parseArguments(body)));
    return "";
  });

  cleaned = cleaned.replace(HERMES_RE, (_m, name: string, argsBody: string) => {
    toolCalls.push(makeCall(name, parseArguments(argsBody)));
    return "";
  });

  // Only try bare JSON if nothing else matched and the whole text looks like one call
  if (toolCalls.length === 0) {
    const bare = content.match(BARE_JSON_CALL_RE);
    if (bare) {
      toolCalls.push(makeCall(bare[1], parseArguments(bare[2])));
      cleaned = cleaned.replace(bare[0], "");
    }
  }

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return { cleaned, toolCalls };
}

/**
 * If an AIMessage has no native tool_calls but its content embeds tool-call
 * markup, return a new AIMessage with structured tool_calls filled in.
 */
export function hydrateToolCallsFromContent(message: BaseMessage): BaseMessage {
  if (!(message instanceof AIMessage) && (message as any)?.type !== "ai") {
    return message;
  }

  const anyM = message as any;
  if (Array.isArray(anyM.tool_calls) && anyM.tool_calls.length > 0) {
    // Normalize args to objects (some SDKs leave stringified JSON)
    const normalized = anyM.tool_calls.map((tc: any, i: number) => ({
      id: tc.id || `call_${i}`,
      name: tc.name,
      args: parseArguments(tc.args ?? tc.arguments ?? {}),
      type: "tool_call" as const,
    }));
    const needsRewrite = anyM.tool_calls.some(
      (tc: any) => typeof tc.args === "string",
    );
    if (!needsRewrite) return message;
    return new AIMessage({
      content: anyM.content,
      tool_calls: normalized,
      id: anyM.id,
      additional_kwargs: anyM.additional_kwargs,
      response_metadata: anyM.response_metadata,
    });
  }

  const text = extractText(anyM.content);
  const { cleaned, toolCalls } = parseXmlToolCalls(text);
  if (toolCalls.length === 0) return message;

  return new AIMessage({
    content: cleaned,
    tool_calls: toolCalls,
    id: anyM.id,
    additional_kwargs: anyM.additional_kwargs,
    response_metadata: {
      ...(anyM.response_metadata || {}),
      xml_tool_calls_parsed: true,
    },
  });
}

/**
 * Agent middleware: after each model call, convert XML / text tool-call markup
 * into native LangChain tool_calls so the tool node actually runs.
 */
export const xmlToolCallMiddleware = createMiddleware({
  name: "xmlToolCallParser",
  wrapModelCall: async (request, handler) => {
    const response = await handler(request);
    return hydrateToolCallsFromContent(response) as typeof response;
  },
});
