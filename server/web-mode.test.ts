import express from "express";
import type { AddressInfo } from "net";
import { request, type Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireTrustedRequest } from "./security";
import {
  auditLog, checkRequest, describeMode, loadWebConfig, setWebConfig, userFromHeaders, validateWebConfig, webAgentRefusal, webExecAllowed, webFeatureOff,
  webGate, webReadOnly, type WebConfig,
} from "./web-mode";

const SECRET = "s3cret-s3cret-s3cret";
const cfg = (over: Partial<WebConfig> = {}): WebConfig => ({
  enabled: true, readOnly: true, ai: true, podFiles: true, hosts: ["kube.example.com"], proxySecret: SECRET, trustProxyNetwork: false,
  allowedGroups: [], authNone: false, impersonate: false, impersonateUser: "email", impersonatePrefix: "", impersonateGroupPrefix: "", ...over,
});
const ok = { "x-kubedeck-proxy-secret": SECRET, "x-forwarded-email": "dev@example.com", "x-forwarded-preferred-username": "dev" };

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
  it("refuses to start with no way to authenticate, no host, or a weak secret", () => {
    expect(validateWebConfig(loadWebConfig({ KUBEDECK_MODE: "web" })).length).toBe(2);
    const weak = validateWebConfig(loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_PUBLIC_URL: "https://k.example.com", KUBEDECK_PROXY_SECRET: "short" }));
    expect(weak.join(" ")).toMatch(/16 characters/);
    expect(validateWebConfig(loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_PUBLIC_URL: "https://k.example.com", KUBEDECK_TRUST_PROXY_NETWORK: "1" }))).toEqual([]);
  });
  it("with KUBEDECK_AUTH=none needs no proxy setting, still needs the public URL, and refuses a group list", () => {
    const none = { KUBEDECK_MODE: "web", KUBEDECK_AUTH: "none" };
    expect(loadWebConfig(none).authNone).toBe(true);
    expect(validateWebConfig(loadWebConfig(none)).join(" ")).toMatch(/KUBEDECK_PUBLIC_URL/);
    expect(validateWebConfig(loadWebConfig({ ...none, KUBEDECK_PUBLIC_URL: "http://10.0.0.5:30080" }))).toEqual([]);
    expect(validateWebConfig(loadWebConfig({ ...none, KUBEDECK_PUBLIC_URL: "http://10.0.0.5", KUBEDECK_ALLOWED_GROUPS: "sre" })).join(" "))
      .toMatch(/ALLOWED_GROUPS needs a login proxy/);
  });
  it("reads the impersonation settings, and refuses them without a login proxy", () => {
    const c = loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_ACCESS: "impersonate", KUBEDECK_IMPERSONATE_USER: "name", KUBEDECK_IMPERSONATE_PREFIX: "oidc:" });
    expect(c).toMatchObject({ impersonate: true, impersonateUser: "name", impersonatePrefix: "oidc:", impersonateGroupPrefix: "" });
    expect(validateWebConfig(loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_AUTH: "none", KUBEDECK_ACCESS: "impersonate", KUBEDECK_PUBLIC_URL: "http://10.0.0.5" })).join(" "))
      .toMatch(/impersonate needs a login proxy/);
  });
  it("takes the public hostname from the URL", () => {
    expect(loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_PUBLIC_URL: "https://KubeDeck.Example.com/x" }).hosts).toEqual(["kubedeck.example.com"]);
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
    app.post("/api/ai/tasks/troubleshoot", (_req, res) => res.json({ ai: true }));
    app.get("/api/k8s/pods/web-1/files/list", (_req, res) => res.json({ files: [] }));
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
  it("with KUBEDECK_AUTH=none serves everyone as anonymous, ignores identity headers, and still checks the host", async () => {
    setWebConfig(cfg({ authNone: true, proxySecret: "", trustProxyNetwork: false }));
    expect((await call("/api/k8s/pods")).status).toBe(200);
    const mode = await (await call("/api/mode", { "x-forwarded-email": "boss@example.com" })).json();
    expect(mode).toMatchObject({ mode: "web", auth: "none", user: null });
    expect((await send("/api/k8s/pods", { host: "evil.example.net" })).status).toBe(403);
    // read-only still applies
    expect((await call("/api/k8s/deployments/scale", {}, "POST")).status).toBe(403);
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
