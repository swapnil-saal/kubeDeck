import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type Database } from "../db";
import { databaseStore, getPlugin, listPlugins, startPlugins, stopPlugins, updatePlugin } from "../plugins";
import { currentAiSettings } from "../settings";
import { migrateAiSettings } from "./ai-plugin";

const ENV = { KUBEDECK_AUTH_SECRET: "x".repeat(40) };
let d: Database;

async function start(env: NodeJS.ProcessEnv = ENV) {
  d = await openDatabase({ type: "sqlite", target: ":memory:" });
  await migrate(d);
  await startPlugins(databaseStore(d), env);
}
afterEach(async () => {
  await stopPlugins();
  await d?.close();
});

describe("the AI provider as a setting an admin changes", () => {
  it("is saved, encrypted, and used at once; never listed with the optional plugins", async () => {
    await start();
    expect(currentAiSettings()).toMatchObject({ provider: "openai", apiKey: "" });
    await updatePlugin("ai", { values: { provider: "anthropic", apiKey: "sk-123", model: "claude-x" } }, "admin@example.com");
    expect(currentAiSettings()).toEqual({ provider: "anthropic", apiKey: "sk-123", model: "claude-x", fastModel: undefined, baseUrl: "" });
    const stored = (await databaseStore(d).all()).find((p) => p.id === "ai");
    expect(JSON.stringify(stored?.values)).not.toContain("sk-123");
    expect((await listPlugins(true)).some((p) => p.id === "ai")).toBe(false);
    expect(await getPlugin("ai", true)).toMatchObject({ values: { apiKey: "", provider: "anthropic" }, secretsSet: ["apiKey"], status: { state: "ok" } });
  });

  it("lets the environment pin only what it sets", async () => {
    await start({ ...ENV, KUBEDECK_AI_PROVIDER: "custom", KUBEDECK_AI_BASE_URL: "http://gw:8787/v1" });
    await updatePlugin("ai", { values: { provider: "openai", model: "qwen" } }, "a");
    expect(currentAiSettings()).toMatchObject({ provider: "custom", baseUrl: "http://gw:8787/v1", model: "qwen" });
    expect((await getPlugin("ai", true)).envPinned.sort()).toEqual(["baseUrl", "provider"]);
  });

  it("says what is missing", async () => {
    await start();
    expect((await getPlugin("ai", true)).status).toEqual({ state: "unconfigured", message: "Add an API key." });
  });

  it("takes the desktop's old settings once, never over a saved choice", async () => {
    await start();
    const store = databaseStore(d);
    await migrateAiSettings(store, { provider: "ollama", baseUrl: "http://localhost:11434", model: "llama3.2", apiKey: "" });
    expect(currentAiSettings()).toMatchObject({ provider: "ollama", model: "llama3.2" });
    await updatePlugin("ai", { values: { model: "mistral" } }, "a");
    await migrateAiSettings(store, { provider: "openai", model: "gpt" });
    expect(currentAiSettings()).toMatchObject({ provider: "ollama", model: "mistral" });
  });
});
