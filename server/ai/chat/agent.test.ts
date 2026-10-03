import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/** Scripted model: each call plays the next script entry. */
let script: Array<"scale" | "delete" | "text"> = [];
let calls = 0;

const model = new MockLanguageModelV4({
  doStream: async () => {
    const step = script[calls++] ?? "text";
    const parts =
      step === "text"
        ? [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "t" },
            { type: "text-delta" as const, id: "t", delta: "All done." },
            { type: "text-end" as const, id: "t" },
            { type: "finish" as const, finishReason: { unified: "stop" as const, raw: "stop" }, usage },
          ]
        : [
            { type: "stream-start" as const, warnings: [] },
            {
              type: "tool-call" as const,
              toolCallId: `call-${calls}`,
              toolName: "kubectl",
              input: JSON.stringify({
                command: step === "scale" ? "scale deployment kd-nonexistent -n kd-nonexistent-ns --replicas=1" : "delete pod kd-nonexistent -n kd-nonexistent-ns",
              }),
            },
            { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage },
          ];
    return { stream: new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(p)); c.close(); } }) };
  },
});

vi.mock("../provider", () => ({
  getLanguageModel: () => ({ model, modelId: "mock", provider: "custom" }),
  defaultMaxOutputTokens: () => 100,
}));

import { streamKubeAgent } from "./agent";

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableEnded) ac.abort(); });
    await streamKubeAgent(
      { messages: body.messages, threadId: body.threadId, context: "", namespace: "", mode: "chat" },
      res,
      ac.signal,
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function turn(text: string, threadId: string): Promise<string> {
  const res = await fetch(base, {
    method: "POST",
    body: JSON.stringify({ threadId, messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }] }),
  });
  return await res.text();
}

describe("streamKubeAgent", () => {
  it("pauses a mutating kubectl command for approval and does not run it", async () => {
    script = ["scale"]; calls = 0;
    const out = await turn("scale it", "agent-test-1");
    expect(out).toContain('"type":"tool-input-available"');
    expect(out).toContain('"type":"tool-approval-request"');
    expect(out).toContain('"signature"'); // approvals are signed so a client cannot forge them
    expect(out).not.toContain('"type":"tool-output-available"');
    expect(calls).toBe(1); // the loop stopped, waiting for the user
  });

  it("blocks a destructive command and lets the model carry on", async () => {
    script = ["delete", "text"]; calls = 0;
    const out = await turn("delete it", "agent-test-2");
    expect(out).not.toContain('"type":"tool-approval-request"');
    expect(out).toMatch(/"type":"tool-output-available"[^\n]*Blocked/);
    expect(out).toContain("All done.");
    expect(calls).toBe(2);
  });

  it("streams plain answers", async () => {
    script = ["text"]; calls = 0;
    const out = await turn("hello", "agent-test-3");
    expect(out).toContain('"type":"text-delta"');
    expect(out).toContain("[DONE]");
  });
});
