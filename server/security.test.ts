import type { IncomingMessage } from "http";
import { afterEach, describe, expect, it } from "vitest";
import { isTrustedRequest } from "./security";

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
