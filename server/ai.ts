import { loadSettings, type AiProviderSettings } from "./settings";
import http from "http";
import https from "https";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const DEFAULT_PROVIDERS: Record<string, { baseUrl: string; defaultModel: string; defaultFastModel: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", defaultFastModel: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com", defaultModel: "claude-3-5-haiku-20241022", defaultFastModel: "claude-3-5-haiku-20241022" },
  ollama: { baseUrl: "http://localhost:11434", defaultModel: "llama3.2", defaultFastModel: "qwen3.5:0.8b" },
  custom: { baseUrl: "", defaultModel: "", defaultFastModel: "" },
};

function getAiConfig(): AiProviderSettings {
  const settings = loadSettings();
  return settings.ai || { provider: "openai", apiKey: "", model: "gpt-4o-mini", baseUrl: "" };
}

function resolveModel(config: AiProviderSettings, useFastModel?: boolean): string {
  if (useFastModel) {
    return config.fastModel || DEFAULT_PROVIDERS[config.provider]?.defaultFastModel || config.model || DEFAULT_PROVIDERS[config.provider]?.defaultModel || "gpt-4o-mini";
  }
  return config.model || DEFAULT_PROVIDERS[config.provider]?.defaultModel || "gpt-4o-mini";
}

function httpRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string; timeout?: number },
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method,
        headers: options.headers,
        timeout: options.timeout ?? 30000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ statusCode: res.statusCode || 500, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on("error", (err) => reject(err));
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.write(options.body);
    req.end();
  });
}

function httpStreamRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string },
  onData: (chunk: string) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method,
        headers: options.headers,
        timeout: 60000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => reject(new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 300)}`)));
          return;
        }
        res.setEncoding("utf-8");
        res.on("data", onData);
        res.on("end", () => resolve(res.statusCode || 200));
        res.on("error", reject);
      },
    );
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED") {
        reject(new Error(`Connection refused. Is the server running at ${parsed.hostname}:${parsed.port}?`));
      } else {
        reject(err);
      }
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.write(options.body);
    req.end();
  });
}

export async function chatCompletion(messages: ChatMessage[], opts?: { useFastModel?: boolean }): Promise<{ content: string; model: string }> {
  const config = getAiConfig();
  if (!config.apiKey && config.provider !== "ollama") {
    throw new Error(`No API key configured for ${config.provider}. Go to Settings → AI to add one.`);
  }
  const model = resolveModel(config, opts?.useFastModel);

  if (config.provider === "ollama") {
    const url = config.baseUrl || DEFAULT_PROVIDERS.ollama.baseUrl;
    console.log(`[ai] ollama non-stream → ${url}/api/chat model=${model}`);
    const res = await httpRequest(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
    });
    if (res.statusCode >= 400) throw new Error(`Ollama error (${res.statusCode}): ${res.body.slice(0, 200)}`);
    const data = JSON.parse(res.body);
    return { content: data.message?.content || "", model: data.model || model };
  }

  if (config.provider === "anthropic") {
    const systemMsg = messages.find(m => m.role === "system")?.content || "";
    const userMessages = messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content }));
    const res = await httpRequest("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 2048, ...(systemMsg ? { system: systemMsg } : {}), messages: userMessages }),
    });
    if (res.statusCode >= 400) throw new Error(`Anthropic error (${res.statusCode}): ${res.body.slice(0, 200)}`);
    const data = JSON.parse(res.body);
    return { content: data.content?.[0]?.text || "", model: data.model || model };
  }

  // OpenAI-compatible
  const baseUrl = config.baseUrl || DEFAULT_PROVIDERS[config.provider]?.baseUrl || DEFAULT_PROVIDERS.openai.baseUrl;
  const res = await httpRequest(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2048 }),
  });
  if (res.statusCode >= 400) throw new Error(`LLM error (${res.statusCode}): ${res.body.slice(0, 200)}`);
  const data = JSON.parse(res.body);
  return { content: data.choices?.[0]?.message?.content || "", model: data.model || model };
}

// ═══════════════════════════════════════════════════
//  TOOL-CALLING SUPPORT
// ═══════════════════════════════════════════════════

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCallResult {
  content?: string;
  toolCalls?: ToolCall[];
  model: string;
}

export async function chatCompletionWithTools(
  messages: AgentMessage[],
  tools: ToolDefinition[],
): Promise<ToolCallResult> {
  const config = getAiConfig();
  if (!config.apiKey && config.provider !== "ollama") {
    throw new Error(`No API key configured for ${config.provider}. Go to Settings → AI to add one.`);
  }
  const model = config.model || DEFAULT_PROVIDERS[config.provider]?.defaultModel || "gpt-4o-mini";

  if (config.provider === "anthropic") {
    return anthropicWithTools(config, model, messages, tools);
  }
  if (config.provider === "ollama") {
    return ollamaWithTools(config, model, messages, tools);
  }
  return openaiWithTools(config, model, messages, tools);
}

async function openaiWithTools(
  config: AiProviderSettings, model: string,
  messages: AgentMessage[], tools: ToolDefinition[],
): Promise<ToolCallResult> {
  const baseUrl = config.baseUrl || DEFAULT_PROVIDERS[config.provider]?.baseUrl || DEFAULT_PROVIDERS.openai.baseUrl;

  const oaiMessages = messages.map(m => {
    if (m.role === "tool") {
      return { role: "tool" as const, tool_call_id: m.toolCallId, content: m.content || "" };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    return { role: m.role, content: m.content || "" };
  });

  const oaiTools = tools.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  console.log(`[ai] openai tool-call → ${baseUrl}/chat/completions model=${model}`);
  const res = await httpRequest(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({ model, messages: oaiMessages, tools: oaiTools, tool_choice: "auto", temperature: 0.3, max_tokens: 4096 }),
    timeout: 60000,
  });
  if (res.statusCode >= 400) throw new Error(`LLM error (${res.statusCode}): ${res.body.slice(0, 300)}`);
  const data = JSON.parse(res.body);
  const choice = data.choices?.[0]?.message;
  if (!choice) throw new Error("No response from LLM");

  const result: ToolCallResult = { model: data.model || model };
  if (choice.content) result.content = choice.content;
  if (choice.tool_calls?.length) {
    result.toolCalls = choice.tool_calls.map((tc: any) => {
      let args: Record<string, any> = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); }
      catch { args = { command: tc.function.arguments || "" }; }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });
  }
  return result;
}

async function anthropicWithTools(
  config: AiProviderSettings, model: string,
  messages: AgentMessage[], tools: ToolDefinition[],
): Promise<ToolCallResult> {
  const systemMsg = messages.find(m => m.role === "system")?.content || "";

  const claudeMessages: any[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;

    if (m.role === "assistant" && m.toolCalls?.length) {
      const content: any[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
      claudeMessages.push({ role: "assistant", content });
    } else if (m.role === "tool") {
      const last = claudeMessages[claudeMessages.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result") {
        last.content.push({ type: "tool_result", tool_use_id: m.toolCallId, content: m.content || "" });
      } else {
        claudeMessages.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content || "" }],
        });
      }
    } else {
      claudeMessages.push({ role: m.role, content: m.content || "" });
    }
  }

  const claudeTools = tools.map(t => ({
    name: t.name, description: t.description, input_schema: t.parameters,
  }));

  console.log(`[ai] anthropic tool-call → model=${model}`);
  const res = await httpRequest("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, max_tokens: 4096,
      tool_choice: { type: "auto" },
      ...(systemMsg ? { system: systemMsg } : {}),
      messages: claudeMessages,
      tools: claudeTools,
    }),
    timeout: 60000,
  });
  if (res.statusCode >= 400) throw new Error(`Anthropic error (${res.statusCode}): ${res.body.slice(0, 300)}`);
  const data = JSON.parse(res.body);

  const result: ToolCallResult = { model: data.model || model };
  const textBlocks = (data.content || []).filter((b: any) => b.type === "text");
  const toolBlocks = (data.content || []).filter((b: any) => b.type === "tool_use");

  if (textBlocks.length) result.content = textBlocks.map((b: any) => b.text).join("");
  if (toolBlocks.length) {
    result.toolCalls = toolBlocks.map((b: any) => ({
      id: b.id, name: b.name, arguments: b.input || {},
    }));
  }
  return result;
}

async function ollamaWithTools(
  config: AiProviderSettings, model: string,
  messages: AgentMessage[], tools: ToolDefinition[],
): Promise<ToolCallResult> {
  const url = config.baseUrl || DEFAULT_PROVIDERS.ollama.baseUrl;

  const oaiMessages = messages.map(m => {
    if (m.role === "tool") {
      return { role: "tool" as const, content: m.content || "" };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: m.content || "",
        tool_calls: m.toolCalls.map(tc => ({
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    return { role: m.role, content: m.content || "" };
  });

  const oaiTools = tools.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  console.log(`[ai] ollama tool-call → ${url}/api/chat model=${model}`);
  const res = await httpRequest(`${url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: oaiMessages, tools: oaiTools, stream: false }),
    timeout: 60000,
  });
  if (res.statusCode >= 400) throw new Error(`Ollama error (${res.statusCode}): ${res.body.slice(0, 300)}`);
  const data = JSON.parse(res.body);
  const msg = data.message;
  if (!msg) throw new Error("No response from Ollama");

  const result: ToolCallResult = { model: data.model || model };
  if (msg.content) result.content = msg.content;
  if (msg.tool_calls?.length) {
    result.toolCalls = msg.tool_calls.map((tc: any, i: number) => {
      let args: Record<string, any>;
      if (typeof tc.function.arguments === "string") {
        try { args = JSON.parse(tc.function.arguments); }
        catch { args = { command: tc.function.arguments }; }
      } else {
        args = tc.function.arguments || {};
      }
      return { id: `ollama_${Date.now()}_${i}`, name: tc.function.name, arguments: args };
    });
  }
  return result;
}

export async function streamChatCompletion(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
): Promise<{ model: string }> {
  const config = getAiConfig();
  if (!config.apiKey && config.provider !== "ollama") {
    throw new Error(`No API key configured for ${config.provider}. Go to Settings → AI to add one.`);
  }
  const model = config.model || DEFAULT_PROVIDERS[config.provider]?.defaultModel || "gpt-4o-mini";

  if (config.provider === "ollama") {
    const url = config.baseUrl || DEFAULT_PROVIDERS.ollama.baseUrl;
    console.log(`[ai] ollama stream → ${url}/api/chat model=${model}`);
    let buffer = "";
    await httpStreamRequest(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
    }, (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.message?.content) onChunk(json.message.content);
          if (json.error) throw new Error(json.error);
        } catch (e: any) {
          if (e.message && !e.message.includes("JSON")) throw e;
        }
      }
    });
    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer);
        if (json.message?.content) onChunk(json.message.content);
      } catch {}
    }
    return { model };
  }

  if (config.provider === "anthropic") {
    const systemMsg = messages.find(m => m.role === "system")?.content || "";
    const userMessages = messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content }));
    console.log(`[ai] anthropic stream → model=${model}`);
    let buffer = "";
    await httpStreamRequest("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 2048, stream: true, ...(systemMsg ? { system: systemMsg } : {}), messages: userMessages }),
    }, (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const json = JSON.parse(line.slice(6));
          if (json.type === "content_block_delta" && json.delta?.text) onChunk(json.delta.text);
        } catch {}
      }
    });
    return { model };
  }

  // OpenAI-compatible streaming
  const baseUrl = config.baseUrl || DEFAULT_PROVIDERS[config.provider]?.baseUrl || DEFAULT_PROVIDERS.openai.baseUrl;
  console.log(`[ai] openai stream → ${baseUrl}/chat/completions model=${model}`);
  let buffer = "";
  await httpStreamRequest(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2048, stream: true }),
  }, (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ") && !line.includes("[DONE]")) {
        try {
          const json = JSON.parse(line.slice(6));
          const text = json.choices?.[0]?.delta?.content;
          if (text) onChunk(text);
        } catch {}
      }
    }
  });
  return { model };
}
