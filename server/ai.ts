import { loadSettings, type AiProviderSettings } from "./settings";
import http from "http";
import https from "https";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const DEFAULT_PROVIDERS: Record<string, { baseUrl: string; defaultModel: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com", defaultModel: "claude-3-5-haiku-20241022" },
  ollama: { baseUrl: "http://localhost:11434", defaultModel: "llama3.2" },
  custom: { baseUrl: "", defaultModel: "" },
};

function getAiConfig(): AiProviderSettings {
  const settings = loadSettings();
  return settings.ai || { provider: "openai", apiKey: "", model: "gpt-4o-mini", baseUrl: "" };
}

function httpRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string },
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
        timeout: 30000,
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

export async function chatCompletion(messages: ChatMessage[]): Promise<{ content: string; model: string }> {
  const config = getAiConfig();
  if (!config.apiKey && config.provider !== "ollama") {
    throw new Error(`No API key configured for ${config.provider}. Go to Settings → AI to add one.`);
  }
  const model = config.model || DEFAULT_PROVIDERS[config.provider]?.defaultModel || "gpt-4o-mini";

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
