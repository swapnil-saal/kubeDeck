import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const stop = { unified: "stop" as const, raw: "stop" };

let prompts: unknown[] = [];
let streamFails = false;

const model = new MockLanguageModelV4({
  doGenerate: async (opts: { prompt: unknown }) => {
    prompts.push(opts.prompt);
    return { content: [{ type: "text" as const, text: "OK" }], finishReason: stop, usage, warnings: [] };
  },
  doStream: async (opts: { prompt: unknown }) => {
    prompts.push(opts.prompt);
    const parts = streamFails
      ? [{ type: "stream-start" as const, warnings: [] }, { type: "error" as const, error: new Error("gateway exploded") }]
      : [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t" },
          { type: "text-delta" as const, id: "t", delta: "Hel" },
          { type: "text-delta" as const, id: "t", delta: "lo" },
          { type: "text-end" as const, id: "t" },
          { type: "finish" as const, finishReason: stop, usage },
        ];
    return { stream: new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(p)); c.close(); } }) };
  },
});

vi.mock("./provider", () => ({
  getAiConfig: () => ({}),
  resolveModel: () => "mock",
  defaultMaxOutputTokens: () => 100,
  getLanguageModel: () => ({ model, modelId: "mock-1", provider: "custom" }),
}));

import { chatCompletion, streamChatCompletion } from "./llm";

const roles = (p: unknown) => (p as { role: string }[]).map((m) => m.role);

describe("chatCompletion", () => {
  it("accepts system messages (AI SDK v7 rejects them inside `messages`)", async () => {
    prompts = [];
    const r = await chatCompletion([
      { role: "system", content: "Respond with exactly: OK" },
      { role: "user", content: "ping" },
    ]);
    expect(r).toEqual({ content: "OK", model: "mock-1" });
    expect(roles(prompts[0])).toEqual(["system", "user"]);
  });
  it("merges several system messages into one instruction block", async () => {
    prompts = [];
    await chatCompletion([
      { role: "system", content: "A" },
      { role: "system", content: "B" },
      { role: "user", content: "hi" },
    ]);
    const system = (prompts[0] as { role: string; content: string }[]).filter((m) => m.role === "system");
    expect(system).toHaveLength(1);
    expect(system[0].content).toBe("A\n\nB");
  });
  it("works with only a user message", async () => {
    const r = await chatCompletion([{ role: "user", content: "hi" }]);
    expect(r.content).toBe("OK");
  });
});

describe("streamChatCompletion", () => {
  it("streams text chunks and returns the model id", async () => {
    streamFails = false;
    const chunks: string[] = [];
    const r = await streamChatCompletion(
      [{ role: "system", content: "s" }, { role: "user", content: "hi" }],
      (t) => chunks.push(t),
    );
    expect(chunks.join("")).toBe("Hello");
    expect(r.model).toBe("mock-1");
  });
  it("surfaces provider errors instead of swallowing them", async () => {
    streamFails = true;
    await expect(streamChatCompletion([{ role: "user", content: "hi" }], () => {})).rejects.toThrow(/gateway exploded/);
    streamFails = false;
  });
});
