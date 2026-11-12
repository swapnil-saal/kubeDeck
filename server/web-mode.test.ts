import express from "express";
import type { AddressInfo } from "net";
import { request, type Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireTrustedRequest } from "./security";
import {
  auditLog, auditRecord, describeMode, loadWebConfig, needsSession, setSessionResolver, setWebConfig, validateWebConfig, webAgentRefusal,
  webExecAllowed, webFeatureOff, webGate, webReadOnly, type WebConfig, type WebUser,
} from "./web-mode";

const cfg = (over: Partial<WebConfig> = {}): WebConfig => ({
  ...loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_PUBLIC_URL: "https://kube.example.com" }), readOnly: true, ...over,
});
const web = { KUBEDECK_MODE: "web", KUBEDECK_PUBLIC_URL: "https://k.example.com" };

describe("loadWebConfig / validateWebConfig", () => {
  it("is off by default and needs no checks then", () => {
    const c = loadWebConfig({});
    expect(c.enabled).toBe(false);
    expect(validateWebConfig(c)).toEqual([]);
  });
  it("has every feature on unless the operator turns it off", () => {
    expect(loadWebConfig({ KUBEDECK_MODE: "web" })).toMatchObject({ readOnly: false, ai: true, podFiles: true });
    expect(loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_READ_ONLY: "true", KUBEDECK_AI: "off", KUBEDECK_POD_FILES: "false" }))
      .toMatchObject({ readOnly: true, ai: false, podFiles: false });
  });
  it("acts as each user, with names prefixed so a group cannot be a built-in one", () => {
    const c = loadWebConfig(web);
    expect(c).toMatchObject({ impersonate: true, impersonatePrefix: "kubedeck:", impersonateGroupPrefix: "kubedeck:" });
    expect(validateWebConfig(c)).toEqual([]);
    expect(loadWebConfig({ ...web, KUBEDECK_IMPERSONATE_PREFIX: "team:" }).impersonatePrefix).toBe("team:");
  });
  it("can be told to use the shared service account, and refuses an empty group prefix", () => {
    expect(loadWebConfig({ ...web, KUBEDECK_ACCESS: "shared" }).impersonate).toBe(false);
    expect(validateWebConfig(loadWebConfig({ ...web, KUBEDECK_IMPERSONATE_GROUP_PREFIX: "" })).join(" ")).toMatch(/GROUP_PREFIX cannot be empty/);
  });
  it("needs the public URL, and takes the hostname from it", () => {
    expect(validateWebConfig(loadWebConfig({ KUBEDECK_MODE: "web" })).join(" ")).toMatch(/KUBEDECK_PUBLIC_URL/);
    expect(loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_PUBLIC_URL: "https://KubeDeck.Example.com/x" }).hosts).toEqual(["kubedeck.example.com"]);
  });
});

describe("sessions and audit", () => {
  it("lets the app's files, sign-in and /api/mode through without a session, and nothing else", () => {
    expect(["/", "/assets/index.js", "/api/auth/sign-in/email", "/api/mode"].map(needsSession)).toEqual([false, false, false, false]);
    expect(["/api/k8s/pods", "/api/admin/users", "/api/ai/agent", "/api/modes"].map(needsSession)).toEqual([true, true, true, true]);
  });
  it("audits a write with the user's groups and the scope from the query or the body", () => {
    const req = {
      kubedeckUser: { name: "Alice", email: "alice@example.com", groups: ["shop-editors", "viewers"] },
      method: "POST", path: "/api/kubectl/exec", query: {}, body: { context: "kind", namespace: "shop", command: "kubectl scale deploy web --replicas=2" },
      socket: { remoteAddress: "10.0.0.7" },
    } as never;
    expect(auditRecord(req, 200, new Date("2026-11-12T10:00:00Z"))).toEqual({
      at: "2026-11-12T10:00:00.000Z", userEmail: "alice@example.com", userName: "Alice", groups: "shop-editors,viewers", method: "POST",
      path: "/api/kubectl/exec", status: 200, context: "kind", namespace: "shop", detail: "kubectl scale deploy web --replicas=2", ip: "10.0.0.7",
    });
  });
});

describe("webExecAllowed", () => {
  it.each([
    "get pods -n e2", "describe pod x", "logs x --tail=50", "top pods",
  ])("allows %s", (c) => expect(webExecAllowed(c).ok).toBe(true));
  it.each([
    "config view --raw", "get pods --kubeconfig=/etc/other", "get pods --token=abc", "get pods --as=system:admin", "get pods --server=https://evil",
    "get pods -s https://evil", "exec -it x -- sh", "port-forward x 80", "cp x:/etc/passwd .", "auth can-i --list",
    "-n e2 exec x -- sh", "--context=a debug x", "kubectl config view", "--namespace e2 attach x",
  ])("refuses %s", (c) => expect(webExecAllowed(c).ok).toBe(false));
});

describe("webAgentRefusal (the assistant on a shared host)", () => {
  afterEach(() => setWebConfig(loadWebConfig({})));
  it("does nothing on the desktop", () => {
    setWebConfig(loadWebConfig({}));
    expect(webAgentRefusal("config view --raw", "kubectl", "allow")).toBeNull();
  });
  it("applies the palette's limits to the kubectl tool and to every kubectl in a pipeline", () => {
    setWebConfig(cfg({ readOnly: false }));
    expect(webAgentRefusal("get pods -A", "kubectl", "allow")).toBeNull();
    expect(webAgentRefusal("kubectl get pods --no-headers | grep -s web | wc -l", "bash", "allow")).toBeNull();
    expect(webAgentRefusal("config view --raw", "kubectl", "allow")).toMatch(/^Blocked: kubectl config/);
    expect(webAgentRefusal("kubectl get pods --as=system:admin | wc -l", "bash", "allow")).toMatch(/flag is not allowed/);
    expect(webAgentRefusal("kubectl get pods -o name | xargs kubectl exec -- id", "bash", "warn")).toMatch(/kubectl exec/);
  });
  it("lets the assistant only read when the KubeDeck is read-only", () => {
    setWebConfig(cfg({ readOnly: true }));
    expect(webAgentRefusal("get pods", "kubectl", "allow")).toBeNull();
    expect(webAgentRefusal("scale deploy/web --replicas=2", "kubectl", "warn")).toMatch(/read-only/);
    setWebConfig(cfg({ readOnly: false }));
    expect(webAgentRefusal("scale deploy/web --replicas=2", "kubectl", "warn")).toBeNull();
  });
});

describe("web mode over HTTP (real middleware)", () => {
  let server: Server;
  let base = "";
  // who each test session cookie belongs to; real Better Auth sessions are tested in auth/auth.test.ts
  const USERS: Record<string, WebUser> = {
    dev: { name: "dev", email: "dev@example.com", groups: ["platform"] },
    other: { name: "other", email: "other@example.com", groups: ["other"] },
  };
  beforeEach(async () => {
    setWebConfig(cfg());
    setSessionResolver(async (req) => USERS[/session=(\w+)/.exec(req.headers.cookie ?? "")?.[1] ?? ""] ?? null);
    const app = express();
    app.get("/healthz", (_req, res) => { res.send("ok"); });
    app.use("/api", requireTrustedRequest);
    app.use(webGate);
    app.use(auditLog);
    app.use("/api", webFeatureOff);
    app.use("/api", webReadOnly);
    app.get("/api/k8s/port-forwards", (_req, res) => res.json([]));
    app.get("/api/mode", (req, res) => res.json(describeMode(req)));
    app.get("/api/k8s/pods", (_req, res) => res.json(["pod-a"]));
    app.post("/api/k8s/deployments/scale", (_req, res) => res.json({ scaled: true }));
    app.post("/api/ai/tasks/troubleshoot", (_req, res) => res.json({ ai: true }));
    app.get("/api/k8s/pods/web-1/files/list", (_req, res) => res.json({ files: [] }));
    server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    setWebConfig(loadWebConfig({}));
    setSessionResolver(null);
    await new Promise((r) => server.close(r));
  });
  // fetch() will not let a test choose the Host header, which is exactly what these tests are about
  const send = (path: string, headers: Record<string, string>, method = "GET") =>
    new Promise<{ status: number; json: () => Promise<any> }>((resolve, reject) => {
      const req = request(base + path, { method, headers }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: async () => JSON.parse(body) }));
      });
      req.on("error", reject);
      req.end();
    });
  const call = (path: string, headers: Record<string, string> = {}, method = "GET") =>
    send(path, { host: "kube.example.com", ...headers }, method);
  const ok = { cookie: "session=dev" };

  it("answers the health probe with no identity and any host", async () => {
    const r = await send("/healthz", { host: "10.1.2.3" });
    expect(r.status).toBe(200);
  });
  it("refuses a hostname that is not the public one", async () => {
    expect((await send("/api/k8s/pods", { ...ok, host: "evil.example.net" })).status).toBe(403);
  });
  it("401s without a session, and an identity header names nobody", async () => {
    expect((await call("/api/k8s/pods")).status).toBe(401);
    expect((await call("/api/k8s/pods", { "x-forwarded-email": "boss@example.com" })).status).toBe(401);
    expect(await (await call("/api/mode", { "x-forwarded-email": "boss@example.com" })).json()).toMatchObject({ auth: "builtin", user: null });
  });
  it("applies the group allow-list", async () => {
    setWebConfig(cfg({ allowedGroups: ["platform"] }));
    expect((await call("/api/k8s/pods", ok)).status).toBe(200);
    expect((await call("/api/k8s/pods", { cookie: "session=other" })).status).toBe(403);
  });
  it("serves reads to a signed-in user and reports who they are", async () => {
    expect((await call("/api/k8s/pods", ok)).status).toBe(200);
    const mode = await (await call("/api/mode", ok)).json();
    expect(mode).toMatchObject({ mode: "web", readOnly: true, user: { email: "dev@example.com" }, features: { portForward: false, settingsEdit: false, ai: true, podFiles: true } });
    setWebConfig(cfg({ ai: false, podFiles: false }));
    expect((await (await call("/api/mode", ok)).json()).features).toMatchObject({ ai: false, podFiles: false });
  });
  it("blocks writes when read-only", async () => {
    expect((await call("/api/k8s/deployments/scale", ok, "POST")).status).toBe(403);
  });
  it("allows writes once read-only is turned off", async () => {
    setWebConfig(cfg({ readOnly: false }));
    expect((await call("/api/k8s/deployments/scale", ok, "POST")).status).toBe(200);
  });
  it("serves AI and pod files by default, read-only or not (the assistant judges its own commands)", async () => {
    for (const readOnly of [true, false]) {
      setWebConfig(cfg({ readOnly }));
      expect((await call("/api/ai/tasks/troubleshoot", ok, "POST")).status).toBe(200);
      expect((await call("/api/k8s/pods/web-1/files/list?path=/", ok)).status).toBe(200);
    }
  });
  it("refuses a feature the operator turned off with its own reason", async () => {
    setWebConfig(cfg({ readOnly: false, ai: false, podFiles: false }));
    const ai = await call("/api/ai/tasks/troubleshoot", ok, "POST");
    expect(ai.status).toBe(403);
    expect((await ai.json()).message).toMatch(/AI assistant is turned off/);
    const files = await call("/api/k8s/pods/web-1/files/list?path=/", ok);
    expect(files.status).toBe(403);
    expect((await files.json()).message).toMatch(/pod files is turned off/);
  });
  it("never starts a port-forward on the server, but listing stays a read", async () => {
    setWebConfig(cfg({ readOnly: false }));
    const pf = await call("/api/k8s/pods/web-1/port-forward", ok, "POST");
    expect(pf.status).toBe(403);
    expect((await pf.json()).message).toMatch(/Port forwarding/);
    expect((await call("/api/k8s/port-forwards/abc", ok, "DELETE")).status).toBe(403);
    expect((await call("/api/k8s/port-forwards", ok)).status).toBe(200);
  });
});
