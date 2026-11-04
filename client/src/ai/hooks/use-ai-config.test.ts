import { describe, expect, it } from "vitest";
import { isFastModelName } from "./use-ai-config";

describe("isFastModelName", () => {
  it.each(["haiku", "claude-haiku-5-5", "gpt-4o-mini", "gemini-2.0-flash", "qwen3.5:0.8b", "llama3:8b", "phi-3-mini"])(
    "treats %s as fast",
    (m) => expect(isFastModelName(m)).toBe(true),
  );
  it.each(["claude-sonnet-5-5", "gpt-4o", "gemini-pro", "llama3:70b", "mistral", ""])(
    "treats %s as a full model",
    (m) => expect(isFastModelName(m)).toBe(false),
  );
});
