import { beforeEach, describe, expect, it, vi } from "vitest";

let ai: Record<string, unknown> = {};
vi.mock("../settings", () => ({ loadSettings: () => ({ kubeconfigPaths: [], ai }) }));

const load = () => import("./provider");

beforeEach(() => { ai = {}; });

describe("resolveModel", () => {
  it("uses the configured model, then provider defaults", async () => {
    const { resolveModel } = await load();
    expect(resolveModel({ provider: "openai", apiKey: "k", model: "gpt-x", baseUrl: "" })).toBe("gpt-x");
    expect(resolveModel({ provider: "openai", apiKey: "k", model: "", baseUrl: "" })).toBe("gpt-4o-mini");
  });
  it("prefers the fast model when asked, falling back to the main model", async () => {
    const { resolveModel } = await load();
    const base = { provider: "custom" as const, apiKey: "", baseUrl: "http://x/v1" };
    expect(resolveModel({ ...base, model: "big", fastModel: "small" }, true)).toBe("small");
    expect(resolveModel({ ...base, model: "big" }, true)).toBe("big");
  });
});

describe("getLanguageModel", () => {
  it("requires an API key for hosted providers", async () => {
    ai = { provider: "openai", apiKey: "", model: "gpt-4o-mini", baseUrl: "" };
    const { getLanguageModel } = await load();
    expect(() => getLanguageModel()).toThrow(/No API key configured for openai/);
  });
  it("requires a base URL for custom gateways but not a key", async () => {
    const { getLanguageModel } = await load();
    ai = { provider: "custom", apiKey: "", model: "m", baseUrl: "" };
    expect(() => getLanguageModel()).toThrow(/base URL/);
    ai = { provider: "custom", apiKey: "", model: "m", baseUrl: "http://gw.local/v1/" };
    const r = getLanguageModel();
    expect(r.modelId).toBe("m");
    expect(r.provider).toBe("custom");
  });
  it("builds ollama, anthropic and openai models", async () => {
    const { getLanguageModel } = await load();
    ai = { provider: "ollama", apiKey: "", model: "llama3.2", baseUrl: "http://localhost:11434" };
    expect(getLanguageModel().modelId).toBe("llama3.2");
    ai = { provider: "anthropic", apiKey: "k", model: "claude-x", baseUrl: "" };
    expect(getLanguageModel().modelId).toBe("claude-x");
    ai = { provider: "openai", apiKey: "k", model: "gpt-x", baseUrl: "" };
    expect(getLanguageModel().modelId).toBe("gpt-x");
  });
});

describe("defaultMaxOutputTokens", () => {
  it("gives custom (reasoning) gateways more room", async () => {
    const { defaultMaxOutputTokens } = await load();
    expect(defaultMaxOutputTokens("custom")).toBeGreaterThan(defaultMaxOutputTokens("openai"));
  });
});
