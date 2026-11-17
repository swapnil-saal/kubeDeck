import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
let settingsDir: string;
let settingsFile: string;
const realHome = process.env.HOME;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kd-settings-"));
  settingsDir = path.join(home, ".kubedeck");
  settingsFile = path.join(settingsDir, "settings.json");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  vi.resetModules(); // settings.ts reads the home directory at import time
});

afterEach(() => {
  process.env.HOME = realHome;
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const load = () => import("@server/settings");
const write = (content: string) => {
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(settingsFile, content);
};

describe("loadSettings", () => {
  it("returns defaults when there is no file", async () => {
    const { loadSettings } = await load();
    const s = loadSettings();
    expect(s.kubeconfigPaths.length).toBeGreaterThan(0);
    expect(s.ai?.provider).toBe("openai");
  });

  it("reads a valid file", async () => {
    write(JSON.stringify({ kubeconfigPaths: ["/a/config"] }));
    const { loadSettings } = await load();
    expect(loadSettings().kubeconfigPaths).toEqual(["/a/config"]);
  });

  it("falls back to the default kubeconfig for an empty list, and offers the old AI block for the one-time move", async () => {
    write(JSON.stringify({ kubeconfigPaths: [], ai: { provider: "anthropic", apiKey: "secret", model: "claude-x" } }));
    const { loadSettings, legacyAi } = await load();
    expect(loadSettings().kubeconfigPaths.length).toBeGreaterThan(0);
    expect(legacyAi()).toEqual({ provider: "anthropic", apiKey: "secret", model: "claude-x" });
  });

  it("backs up an unreadable file instead of silently losing it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    write('{"kubeconfigPaths": ["/x"], "ai": {"apiKey": "precious"');
    const { loadSettings } = await load();
    const s = loadSettings();
    expect(s.ai?.provider).toBe("openai"); // defaults
    const backups = fs.readdirSync(settingsDir).filter((f) => f.startsWith("settings.json.corrupt-"));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(settingsDir, backups[0]), "utf-8")).toContain("precious");
    // repeated loads (one per request) must not pile up backups
    loadSettings();
    loadSettings();
    expect(fs.readdirSync(settingsDir).filter((f) => f.startsWith("settings.json.corrupt-"))).toHaveLength(1);
  });
});

describe("saveSettings", () => {
  it.skipIf(process.platform === "win32")("keeps the file private to the user (it holds the API key)", async () => {
    write("{}");
    fs.chmodSync(settingsFile, 0o644);
    const { saveSettings, loadSettings } = await load();
    saveSettings(loadSettings());
    expect(fs.statSync(settingsFile).mode & 0o777).toBe(0o600);
  });
});

describe("AI provider settings", () => {
  it("reads the plugin's values and falls back to openai for an unknown provider", async () => {
    const { aiSettingsFrom } = await import("@server/settings");
    expect(aiSettingsFrom({ provider: "Anthropic", apiKey: "k", model: "m", fastModel: "f" }))
      .toEqual({ provider: "anthropic", apiKey: "k", model: "m", fastModel: "f", baseUrl: "" });
    expect(aiSettingsFrom({ provider: "nope" }).provider).toBe("openai");
  });
  it("counts a key, ollama, or a custom endpoint as configured", async () => {
    const { aiConfigured } = await import("@server/settings");
    const base = { model: "", baseUrl: "", apiKey: "" };
    expect(aiConfigured({ ...base, provider: "openai" })).toBe(false);
    expect(aiConfigured({ ...base, provider: "openai", apiKey: "k" })).toBe(true);
    expect(aiConfigured({ ...base, provider: "ollama" })).toBe(true);
    expect(aiConfigured({ ...base, provider: "custom" })).toBe(false);
    expect(aiConfigured({ ...base, provider: "custom", baseUrl: "http://gw:8787" })).toBe(true);
  });
});
