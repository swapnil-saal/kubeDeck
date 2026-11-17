import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, describe, expect, it } from "vitest";
import { asKubeDeck, asUser, asUserChoices, bindIdentity, contextOf, hasNoAccess, NO_ACCESS, setClusterGrants, visibleClusters } from "@server/identity";

const user = { name: "dev", email: "dev@example.com", groups: ["sre", "platform"] };

afterEach(() => setClusterGrants(null));

describe("contextOf", () => {
  it("reads the last --context, as kubectl does, and stops at the exec separator", () => {
    expect(contextOf(["get", "pods", "--context=a", "--context", "b"])).toBe("b");
    expect(contextOf(["exec", "web", "--context=a", "--", "kubectl", "--context=evil"])).toBe("a");
    expect(contextOf(["get", "pods"])).toBe("");
  });
});

describe("asUser on the desktop", () => {
  it("adds nothing: the person's own kubeconfig decides", () => {
    expect(asUser("kubectl", ["get", "pods", "--context=kind"])).toEqual(["get", "pods", "--context=kind"]);
    expect(visibleClusters()).toBeNull();
  });
  it("leaves other programs alone", () => {
    expect(asUser("grep", ["-c", "Running"])).toEqual(["-c", "Running"]);
  });
});

describe("asUser in web mode", () => {
  let server: Server;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  it("fails closed outside a request: no access, never KubeDeck's own", () => {
    setClusterGrants(() => [{ as: "credentials", kubeconfig: "/tmp/x" }]);
    expect(asUser("kubectl", ["get", "pods", "--context=kind"])).toEqual(["get", "pods", "--context=kind", ...NO_ACCESS]);
    expect(hasNoAccess(asUser("kubectl", ["get", "pods", "--context=kind"]))).toBe(true);
  });

  it("lets KubeDeck name its own connection, adding no person", () => {
    setClusterGrants(() => []);
    expect(asKubeDeck(() => asUser("kubectl", ["auth", "whoami", "--kubeconfig=/c", "--context=kind"]))).toEqual(["auth", "whoami", "--kubeconfig=/c", "--context=kind"]);
  });

  it("reaches kubectl calls made after awaits, tries each grant, and keeps flags before the exec separator", async () => {
    setClusterGrants(
      (_p, ctx) => (ctx === "kind" ? [
        { as: "serviceaccount", kubeconfig: "/clusters/kind", namespace: "shop", serviceAccount: "viewer" },
        { as: "credentials", kubeconfig: "/groups/ops-kind" },
      ] : []),
      () => ["kind"],
    );
    const app = express();
    app.use((req, _res, next) => { req.kubedeckUser = user; next(); });
    app.use(express.json());
    app.use(bindIdentity);
    app.post("/x", async (_req, res) => {
      await new Promise((r) => setTimeout(r, 5));
      res.json({
        choices: asUserChoices("kubectl", ["get", "pods", "--context=kind"]),
        exec: asUser("kubectl", ["exec", "web", "--context=kind", "--", "ls", "/"]),
        xargs: asUser("xargs", ["kubectl", "describe", "--context=kind"]),
        other: asUser("kubectl", ["get", "pods", "--context=prod"]),
        visible: visibleClusters(),
      });
    });
    server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: 1 }),
    });
    const body = await res.json();
    const sa = ["--kubeconfig=/clusters/kind", "--as=system:serviceaccount:shop:viewer"];
    expect(body.choices).toEqual([
      ["get", "pods", "--context=kind", ...sa],
      ["get", "pods", "--context=kind", "--kubeconfig=/groups/ops-kind"],
    ]);
    expect(body.exec).toEqual(["exec", "web", "--context=kind", ...sa, "--", "ls", "/"]);
    expect(body.xargs).toEqual(["kubectl", "describe", "--context=kind", ...sa]);
    expect(body.other).toEqual(["get", "pods", "--context=prod", ...NO_ACCESS]);
    expect(body.visible).toEqual(["kind"]);
  });
});
