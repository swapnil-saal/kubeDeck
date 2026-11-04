import express from "express";
import type { AddressInfo } from "net";
import { request, type Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireTrustedRequest } from "./security";
import {
  auditLog, checkRequest, describeMode, loadWebConfig, setWebConfig, userFromHeaders, validateWebConfig, webExecAllowed, webFeatureOff,
  webGate, webReadOnly, type WebConfig,
} from "./web-mode";

const SECRET = "s3cret-s3cret-s3cret";
const cfg = (over: Partial<WebConfig> = {}): WebConfig => ({
  enabled: true, readOnly: true, hosts: ["kube.example.com"], proxySecret: SECRET, trustProxyNetwork: false, allowedGroups: [], ...over,
});
const ok = { "x-kubedeck-proxy-secret": SECRET, "x-forwarded-email": "dev@example.com", "x-forwarded-preferred-username": "dev" };

describe("loadWebConfig / validateWebConfig", () => {
  it("is off by default and needs no checks then", () => {
    const c = loadWebConfig({});
    expect(c.enabled).toBe(false);
    expect(validateWebConfig(c)).toEqual([]);
  });
  it("is read-only unless explicitly turned off", () => {
    expect(loadWebConfig({ KUBEDECK_MODE: "web" }).readOnly).toBe(true);
    expect(loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_READ_ONLY: "false" }).readOnly).toBe(false);
  });
  it("refuses to start with no way to authenticate, no host, or a weak secret", () => {
    expect(validateWebConfig(loadWebConfig({ KUBEDECK_MODE: "web" })).length).toBe(2);
    const weak = validateWebConfig(loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_PUBLIC_URL: "https://k.example.com", KUBEDECK_PROXY_SECRET: "short" }));
    expect(weak.join(" ")).toMatch(/16 characters/);
    expect(validateWebConfig(loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_PUBLIC_URL: "https://k.example.com", KUBEDECK_TRUST_PROXY_NETWORK: "1" }))).toEqual([]);
  });
  it("takes the public hostname from the URL", () => {
    expect(loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_PUBLIC_URL: "https://E2-K8S.saal.ai/x" }).hosts).toEqual(["e2-k8s.saal.ai"]);
  });
});

describe("checkRequest", () => {
  it("accepts a request with the proxy secret and an identity", () => {
    const r = checkRequest(ok, cfg());
    expect(r.ok && r.user).toMatchObject({ email: "dev@example.com", name: "dev" });
  });
  it("rejects identity headers sent without the proxy secret (spoofing)", () => {
    const { "x-kubedeck-proxy-secret": _, ...spoofed } = ok;
    expect(checkRequest(spoofed, cfg())).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ ...ok, "x-kubedeck-proxy-secret": "wrong-wrong-wrong-wrong" }, cfg())).toMatchObject({ ok: false, status: 403 });
  });
  it("returns 401 when the proxy vouches but no user is present", () => {
    expect(checkRequest({ "x-kubedeck-proxy-secret": SECRET }, cfg())).toMatchObject({ ok: false, status: 401 });
  });
  it("trusts headers as-is only when the operator declared network trust and set no secret", () => {
    const c = cfg({ proxySecret: "", trustProxyNetwork: true });
    expect(checkRequest({ "x-forwarded-email": "a@b.c" }, c).ok).toBe(true);
    expect(checkRequest({ "x-forwarded-email": "a@b.c" }, cfg({ proxySecret: "", trustProxyNetwork: false })).ok).toBe(false);
  });
  it("applies the group allow-list", () => {
    const c = cfg({ allowedGroups: ["platform"] });
    expect(checkRequest({ ...ok, "x-forwarded-groups": "role:platform,other" }, c).ok).toBe(true);
    expect(checkRequest({ ...ok, "x-forwarded-groups": "other" }, c)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest(ok, c)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("userFromHeaders", () => {
  it("reads oauth2-proxy and auth-request header styles", () => {
    expect(userFromHeaders({ "x-auth-request-user": "u", "x-auth-request-email": "u@x.y", "x-auth-request-groups": "g1,g2" })).toEqual({ name: "u", email: "u@x.y", groups: ["g1", "g2"] });
    expect(userFromHeaders({})).toBeNull();
  });
});

describe("webExecAllowed", () => {
  it.each([
    "get pods -n e2", "describe pod x", "logs x --tail=50", "top pods",
  ])("allows %s", (c) => expect(webExecAllowed(c).ok).toBe(true));
  it.each([
    "config view --raw", "get pods --kubeconfig=/etc/other", "get pods --token=abc", "get pods --as=system:admin", "get pods --server=https://evil",
    "get pods -s https://evil", "exec -it x -- sh", "port-forward x 80", "cp x:/etc/passwd .", "auth can-i --list",
  ])("refuses %s", (c) => expect(webExecAllowed(c).ok).toBe(false));
});

describe("web mode over HTTP (real middleware)", () => {
  let server: Server;
  let base = "";
  beforeEach(async () => {
    setWebConfig(cfg());
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
    server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    setWebConfig(loadWebConfig({}));
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

  it("answers the health probe with no identity and any host", async () => {
    const r = await send("/healthz", { host: "10.1.2.3" });
    expect(r.status).toBe(200);
  });
  it("refuses a hostname that is not the public one", async () => {
    expect((await send("/api/k8s/pods", { ...ok, host: "evil.example.net" })).status).toBe(403);
  });
  it("401s without identity and 403s without the proxy secret", async () => {
    expect((await call("/api/k8s/pods", { "x-kubedeck-proxy-secret": SECRET })).status).toBe(401);
    expect((await call("/api/k8s/pods", { "x-forwarded-email": "a@b.c" })).status).toBe(403);
  });
  it("serves reads to a signed-in user and reports who they are", async () => {
    expect((await call("/api/k8s/pods", ok)).status).toBe(200);
    const mode = await (await call("/api/mode", ok)).json();
    expect(mode).toMatchObject({ mode: "web", readOnly: true, user: { email: "dev@example.com" }, features: { portForward: false, settingsEdit: false, ai: false, podFiles: false } });
  });
  it("blocks writes when read-only", async () => {
    expect((await call("/api/k8s/deployments/scale", ok, "POST")).status).toBe(403);
  });
  it("allows writes once read-only is turned off", async () => {
    setWebConfig(cfg({ readOnly: false }));
    expect((await call("/api/k8s/deployments/scale", ok, "POST")).status).toBe(200);
  });
  it("refuses the desktop-only features with their own reason, even when writes are allowed", async () => {
    for (const readOnly of [true, false]) {
      setWebConfig(cfg({ readOnly }));
      const ai = await call("/api/ai/tasks/troubleshoot", ok, "POST");
      expect(ai.status).toBe(403);
      expect((await ai.json()).message).toMatch(/AI assistant is turned off/);
      const files = await call("/api/k8s/pods/web-1/files/list?path=/", ok);
      expect(files.status).toBe(403);
      expect((await files.json()).message).toMatch(/pod files/);
      const pf = await call("/api/k8s/pods/web-1/port-forward", ok, "POST");
      expect(pf.status).toBe(403);
      expect((await pf.json()).message).toMatch(/Port forwarding/);
      expect((await call("/api/k8s/port-forwards/abc", ok, "DELETE")).status).toBe(403);
    }
    // listing forwards is still a plain read
    expect((await call("/api/k8s/port-forwards", ok)).status).toBe(200);
  });
});
