/**
 * The audit log fed by `action.done` events, and the desktop app's audit log: the real middleware in
 * desktop configuration, a real (in-memory) SQLite database. Nothing here talks to a cluster.
 */
import express, { type Express } from "express";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openAppDatabase, openDatabase, type Database } from "../db";
import { emit, settled, type ActionDone } from "../events";
import { asUser, bindIdentity, setImpersonation } from "../identity";
import { auditLog, describeMode, loadWebConfig, localUser, setWebConfig, webGate } from "../web-mode";
import { listAudit, startAudit } from "./index";
import { registerAuditRoutes } from "./routes";

const memory = async () => {
  const d = await openDatabase({ type: "sqlite", target: ":memory:" });
  await migrate(d);
  return d;
};

const record = (over: Partial<ActionDone> = {}): ActionDone => ({
  at: "2026-11-12T10:00:00.000Z", userEmail: "alice@example.com", userName: "Alice", groups: "viewers", method: "POST",
  path: "/api/k8s/deployments/web/scale", status: 200, context: "kind", namespace: "shop", detail: "", ip: "127.0.0.1", ...over,
});

async function listen(app: Express): Promise<{ server: Server; base: string }> {
  const server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe("audit through events", () => {
  it("stores every action.done while started, and nothing after it stops", async () => {
    const d = await memory();
    const stop = startAudit(d);
    emit("action.done", record());
    await settled();
    stop();
    emit("action.done", record({ path: "/api/k8s/pods/web-1", method: "DELETE" }));
    await settled();
    const { entries } = await listAudit(d);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ userEmail: "alice@example.com", method: "POST", path: "/api/k8s/deployments/web/scale", context: "kind" });
    await d.close();
  });
});

describe("desktop: one local user, writes audited, no impersonation", () => {
  let d: Database;
  let server: Server;
  let base = "";
  let stop: () => void;

  beforeAll(async () => {
    setWebConfig(loadWebConfig({}));
    setImpersonation(null);
    d = await memory();
    stop = startAudit(d);
    const app = express();
    app.use(webGate);
    app.use(auditLog);
    app.get("/api/mode", (req, res) => { res.json(describeMode(req, { audit: true })); });
    app.use(express.json());
    app.use(bindIdentity);
    registerAuditRoutes(app, d);
    // what kubectl would be run with: no --as on the desktop
    app.post("/api/k8s/deployments/web/scale", (_req, res) => { res.json({ args: asUser("kubectl", ["scale", "deploy/web"]) }); });
    // as in index.ts: an unknown API path answered from a router mounted on "/api"
    app.use("/api", (_req, res) => { res.status(404).json({ message: "Not found" }); });
    ({ server, base } = await listen(app));
  });

  afterAll(async () => {
    stop();
    await new Promise((r) => server.close(r));
    await d.close();
  });

  it("is the person logged in to this computer, an admin, never asked to sign in", async () => {
    const mode = await (await fetch(`${base}/api/mode`)).json();
    expect(mode).toMatchObject({
      mode: "desktop",
      user: { name: localUser().name, email: "", groups: [], role: "admin" },
      features: { users: false, audit: true, settingsEdit: true },
    });
    expect(localUser().name).toBe(os.userInfo().username);
  });

  it("records a write with the local user and lets them read the audit log", async () => {
    const log = vi.spyOn(console, "log");
    const res = await fetch(`${base}/api/k8s/deployments/web/scale?context=kind&namespace=shop`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ replicas: 2 }),
    });
    expect((await res.json()).args).toEqual(["scale", "deploy/web"]);
    await vi.waitFor(async () => {
      await settled();
      expect((await listAudit(d)).entries).toHaveLength(1);
    });
    const list = await (await fetch(`${base}/api/admin/audit?limit=5`)).json();
    expect(list.entries[0]).toMatchObject({
      userName: localUser().name, userEmail: "", method: "POST", path: "/api/k8s/deployments/web/scale", status: 200, context: "kind", namespace: "shop",
    });
    // the JSON line on stdout is for a cluster's log pipeline: web mode only
    expect(log.mock.calls.some((c) => String(c[0]).includes('"audit":true'))).toBe(false);
    log.mockRestore();
  });

  it("records the full path of a write answered under a mounted router", async () => {
    expect((await fetch(`${base}/api/k8s/nothing-here`, { method: "DELETE" })).status).toBe(404);
    await vi.waitFor(async () => {
      await settled();
      expect((await listAudit(d)).entries[0]).toMatchObject({ method: "DELETE", path: "/api/k8s/nothing-here", status: 404 });
    });
  });
});

describe("desktop without a database", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("starts without an audit log, with one warning, when the database cannot open", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // a directory cannot be made inside /dev/null
    const target = { type: "sqlite" as const, target: path.join("/dev/null", "kubedeck.db") };
    expect(await openAppDatabase({ required: false, target })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/no audit log: could not open the database/);
    await expect(openAppDatabase({ required: true, target })).rejects.toThrow(/cannot create \/dev\/null for the SQLite database .*KUBEDECK_DATABASE_URL/);
  });

  it("tells the browser there is no audit log, and the route says why", async () => {
    setWebConfig(loadWebConfig({}));
    const app = express();
    app.use(webGate);
    app.get("/api/mode", (req, res) => { res.json(describeMode(req, { audit: false })); });
    registerAuditRoutes(app, null);
    const { server, base } = await listen(app);
    try {
      expect((await (await fetch(`${base}/api/mode`)).json()).features).toMatchObject({ users: false, audit: false });
      const res = await fetch(`${base}/api/admin/audit`);
      expect(res.status).toBe(503);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
