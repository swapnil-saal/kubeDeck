import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, describe, expect, it } from "vitest";
import { asUser, bindIdentity, identityFor, impersonationFlags, setImpersonation } from "./identity";

const cfg = { impersonate: true, impersonateUser: "email" as const, impersonatePrefix: "oidc:", impersonateGroupPrefix: "oidc:" };
const user = { name: "dev", email: "dev@example.com", groups: ["sre", "platform"] };

afterEach(() => setImpersonation(null));

describe("identityFor", () => {
  it("maps the proxy's user to a Kubernetes identity with the configured claim and prefixes", () => {
    expect(identityFor(user, cfg)).toEqual({ user: "oidc:dev@example.com", groups: ["oidc:sre", "oidc:platform"] });
    expect(identityFor(user, { ...cfg, impersonateUser: "name", impersonatePrefix: "", impersonateGroupPrefix: "" }).user).toBe("dev");
  });
});

describe("asUser", () => {
  it("adds nothing when impersonation is off", () => {
    expect(asUser("kubectl", ["get", "pods"])).toEqual(["get", "pods"]);
  });
  it("fails closed outside a request: anonymous, never the service account", () => {
    setImpersonation(cfg);
    expect(impersonationFlags()).toEqual(["--as=system:anonymous"]);
  });
  it("leaves other programs alone", () => {
    setImpersonation(cfg);
    expect(asUser("grep", ["-c", "Running"])).toEqual(["-c", "Running"]);
  });
});

describe("bindIdentity through Express (JSON body, async handler)", () => {
  let server: Server;
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it("reaches kubectl calls made after awaits, and puts flags before the exec separator", async () => {
    setImpersonation(cfg);
    const app = express();
    app.use((req, _res, next) => { req.kubedeckUser = user; next(); });
    app.use(express.json());
    app.use(bindIdentity);
    app.post("/x", async (_req, res) => {
      await new Promise((r) => setTimeout(r, 5));
      res.json({
        get: asUser("kubectl", ["get", "pods"]),
        exec: asUser("kubectl", ["exec", "web", "--", "ls", "/"]),
        xargs: asUser("xargs", ["kubectl", "describe"]),
      });
    });
    server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: 1 }),
    });
    const body = await res.json();
    const flags = ["--as=oidc:dev@example.com", "--as-group=oidc:sre", "--as-group=oidc:platform", "--as-group=system:authenticated"];
    expect(body.get).toEqual(["get", "pods", ...flags]);
    expect(body.exec).toEqual(["exec", "web", ...flags, "--", "ls", "/"]);
    expect(body.xargs).toEqual(["kubectl", "describe", ...flags]);
  });
});
