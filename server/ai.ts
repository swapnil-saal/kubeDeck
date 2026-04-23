import { loadSettings, type AiProviderSettings } from "./settings";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  content: string;
  model: string;
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

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<ChatResponse> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2048 }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM API error (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json() as any;
  return {
    content: data.choices?.[0]?.message?.content || "",
    model: data.model || model,
  };
}

async function callAnthropic(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<ChatResponse> {
  const systemMsg = messages.find(m => m.role === "system")?.content || "";
  const userMessages = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role,
    content: m.content,
  }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      ...(systemMsg ? { system: systemMsg } : {}),
      messages: userMessages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json() as any;
  return {
    content: data.content?.[0]?.text || "",
    model: data.model || model,
  };
}

async function callOllama(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
): Promise<ChatResponse> {
  const url = baseUrl || "http://localhost:11434";
  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama error (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json() as any;
  return {
    content: data.message?.content || "",
    model: data.model || model,
  };
}

export async function chatCompletion(messages: ChatMessage[]): Promise<ChatResponse> {
  const config = getAiConfig();

  if (!config.apiKey && config.provider !== "ollama") {
    throw new Error(`No API key configured for ${config.provider}. Go to Settings → AI to add one.`);
  }

  const model = config.model || DEFAULT_PROVIDERS[config.provider]?.defaultModel || "gpt-4o-mini";

  switch (config.provider) {
    case "anthropic":
      return callAnthropic(config.apiKey, model, messages);
    case "ollama":
      return callOllama(config.baseUrl, model, messages);
    case "custom": {
      if (!config.baseUrl) throw new Error("Custom provider requires a base URL. Go to Settings → AI.");
      return callOpenAICompatible(config.baseUrl, config.apiKey, model, messages);
    }
    case "openai":
    default: {
      const baseUrl = config.baseUrl || DEFAULT_PROVIDERS.openai.baseUrl;
      return callOpenAICompatible(baseUrl, config.apiKey, model, messages);
    }
  }
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
    const url = config.baseUrl || "http://localhost:11434";
    const res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split("\n").filter(Boolean)) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) onChunk(json.message.content);
        } catch {}
      }
    }
    return { model };
  }

  if (config.provider === "anthropic") {
    const systemMsg = messages.find(m => m.role === "system")?.content || "";
    const userMessages = messages.filter(m => m.role !== "system").map(m => ({
      role: m.role, content: m.content,
    }));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model, max_tokens: 2048, stream: true,
        ...(systemMsg ? { system: systemMsg } : {}),
        messages: userMessages,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic error: ${res.status}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const json = JSON.parse(line.slice(6));
            if (json.type === "content_block_delta" && json.delta?.text) {
              onChunk(json.delta.text);
            }
          } catch {}
        }
      }
    }
    return { model };
  }

  // OpenAI-compatible streaming
  const baseUrl = config.baseUrl || DEFAULT_PROVIDERS[config.provider]?.baseUrl || DEFAULT_PROVIDERS.openai.baseUrl;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2048, stream: true }),
  });
  if (!res.ok) throw new Error(`LLM API error: ${res.status}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
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
  }
  return { model };
}
