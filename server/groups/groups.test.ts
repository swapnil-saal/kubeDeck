import { readFileSync, statSync } from "fs";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, type Database } from "../db";
import { asKubeDeck, asUser, bindIdentity, setClusterGrants, setImpersonation } from "../identity";
import { normalizeKubeconfig } from "./credentials";
import { adoptGroups, clusterAccessFor, createGroup, deleteGroup, databaseGroupStore, listGroups, registerGroupRoutes, reorderGroups, startGroups, stopGroups, updateGroup } from "./index";

let d: Database | undefined;
let server: Server | undefined;
const ENV = { KUBEDECK_AUTH_SECRET: "s".repeat(40) };

async function start() {
  d = await openDatabase({ type: "sqlite", target: ":memory:" });
  await migrate(d);
  await startGroups(databaseGroupStore(d), ENV);
}

/** A service account's kubeconfig for a cluster nobody listens on: saving it cannot reach a cluster. */
const kubeconfig = (user: Record<string, unknown> = { token: "secret-token-123" }, cluster: Record<string, unknown> = {}) => `
apiVersion: v1
kind: Config
clusters: [{ name: c, cluster: { server: "https://127.0.0.1:1", certificate-authority-data: Q0E=, ${Object.entries(cluster).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")} } }]
users: [{ name: u, user: ${JSON.stringify(user)} }]
contexts: [{ name: x, context: { cluster: c, user: u, namespace: monitoring } }]
current-context: x
`;
const upload = (context: string, user?: Record<string, unknown>) => ({ context, as: "credentials" as const, kubeconfig: kubeconfig(user) });

afterEach(async () => {
  stopGroups();
  setClusterGrants(null);
  setImpersonation(null);
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  await d?.close();
});

describe("groups and their cluster access", () => {
  it("are kept in the database with an id from the name, and survive a restart", async () => {
    await start();
    const g = await createGroup({ name: "Quality Team", description: "QA", access: [upload("qa")] }, "admin@example.com");
    expect(g).toMatchObject({ id: "quality-team", name: "Quality Team", access: [{ context: "qa", as: "credentials", server: "https://127.0.0.1:1", identity: "" }] });
    expect(JSON.stringify(g)).not.toContain("secret-token-123");
    stopGroups();
    await startGroups(databaseGroupStore(d!), ENV);
    expect(listGroups()).toEqual([g]);
  });

  it("let the first of a person's groups that covers a cluster decide, in the list's order", async () => {
    await start();
    await createGroup({ name: "Developers", access: [{ context: "dev", as: "serviceaccount", namespace: "team", serviceAccount: "dev" }] }, "a");
    await createGroup({ name: "Leads", access: [upload("dev"), upload("qa")] }, "a");
    expect(clusterAccessFor(["developers", "leads"], "dev")).toMatchObject({ as: "serviceaccount", serviceAccount: "dev" });
    expect(clusterAccessFor(["developers", "leads"], "qa")).toMatchObject({ as: "credentials" });
    expect(clusterAccessFor(["developers"], "qa")).toBeUndefined();
    await reorderGroups(["leads"], "a");
    expect(listGroups().map((g) => g.id)).toEqual(["leads", "developers"]);
    expect(clusterAccessFor(["developers", "leads"], "dev")).toMatchObject({ as: "credentials" });
  });

  it("changes access, and refuses to delete a group someone is still in", async () => {
    await start();
    await createGroup({ name: "Developers" }, "a");
    await updateGroup("developers", { access: [{ context: "kind", as: "serviceaccount", namespace: "shop", serviceAccount: "web" }] }, "a");
    expect(clusterAccessFor(["developers"], "kind")).toEqual({ as: "serviceaccount", namespace: "shop", serviceAccount: "web" });
    await expect(deleteGroup("developers", 2, "a")).rejects.toThrow("still has 2 members");
    await deleteGroup("developers", 0, "a");
    expect(listGroups()).toEqual([]);
  });

  it("adopts groups accounts already carry, once, without touching defined ones", async () => {
    await start();
    await createGroup({ name: "Admins", description: "kept" }, "a");
    expect(await adoptGroups(["admins", "viewers", "viewers"], "startup")).toEqual(["viewers"]);
    expect(await adoptGroups(["admins", "viewers"], "startup")).toEqual([]);
    expect(listGroups().find((g) => g.id === "admins")?.description).toBe("kept");
  });
});

describe("uploaded kubeconfigs", () => {
  it("keep only a token or inline certificate, renamed to KubeDeck's context", () => {
    const { yaml, server } = normalizeKubeconfig(kubeconfig({ token: "t" }, { "tls-server-name": "api" }), "qa");
    expect(server).toBe("https://127.0.0.1:1");
    expect(yaml).toContain("current-context: qa");
    expect(yaml).toContain("namespace: monitoring");
    expect(yaml).toContain("tls-server-name: api");
    expect(normalizeKubeconfig(kubeconfig({ "client-certificate-data": "Yw==", "client-key-data": "aw==" }), "kind").yaml).toContain("client-key-data");
  });

  it.each([
    [{ exec: { command: "aws", args: ["eks", "get-token"] } }, "exec plugin"],
    [{ "auth-provider": { name: "oidc" } }, "auth provider"],
    [{ tokenFile: "/var/run/token" }, "token file"],
    [{ token: "t", "client-key": "/etc/key" }, "client key file"],
    [{ token: "t", as: "system:admin" }, "impersonation"],
    [{ username: "u", password: "p" }, "username and password"],
    [{}, "no token or client certificate"],
  ])("refuse %j", (user, why) => {
    expect(() => normalizeKubeconfig(kubeconfig(user), "c")).toThrow(why);
  });

  it("refuse a CA file, a proxy, or something that is not a kubeconfig", () => {
    expect(() => normalizeKubeconfig(kubeconfig({ token: "t" }, { "certificate-authority": "/ca.crt" }), "c")).toThrow("CA file");
    expect(() => normalizeKubeconfig(kubeconfig({ token: "t" }, { "proxy-url": "http://p" }), "c")).toThrow("proxy-url");
    expect(() => normalizeKubeconfig("{ not: [yaml", "c")).toThrow("not valid YAML");
    expect(() => normalizeKubeconfig("kind: Config", "c")).toThrow("no contexts");
  });

  it("are encrypted at rest, written readable only by KubeDeck, and kept when a save leaves them out", async () => {
    await start();
    await createGroup({ name: "QA", access: [upload("qa")] }, "a");
    const rows = await d!.db.selectFrom("group_cluster_access").select("credentials").execute();
    expect(rows[0].credentials).toMatch(/^enc:v1:/);
    expect(rows[0].credentials).not.toContain("secret-token-123");

    const grant = clusterAccessFor(["qa"], "qa");
    if (grant?.as !== "credentials") throw new Error("expected uploaded credentials");
    expect(readFileSync(grant.kubeconfig, "utf-8")).toContain("secret-token-123");
    expect(statSync(grant.kubeconfig).mode & 0o777).toBe(0o600);

    await updateGroup("qa", { description: "x", access: [{ context: "qa", as: "credentials" }] }, "a");
    expect(listGroups()[0].access).toMatchObject([{ as: "credentials", server: "https://127.0.0.1:1" }]);
    await expect(updateGroup("qa", { access: [{ context: "dev", as: "credentials" }] }, "a")).rejects.toThrow("Upload a kubeconfig for dev");
    await expect(updateGroup("qa", { access: [upload("qa", { exec: { command: "sh" } })] }, "a")).rejects.toThrow("qa: The kubeconfig uses an exec plugin");
  });

  it("fail closed when they cannot be decrypted (the secret changed)", async () => {
    await start();
    await createGroup({ name: "QA", access: [upload("qa")] }, "a");
    stopGroups();
    await startGroups(databaseGroupStore(d!), { KUBEDECK_AUTH_SECRET: "t".repeat(40) });
    expect(clusterAccessFor(["qa"], "qa")).toEqual({ as: "credentials", kubeconfig: "/dev/null" });
  });
});

describe("whom kubectl runs as, per cluster", () => {
  const person = { name: "Ann", email: "ann@example.com", groups: ["developers"], role: "user" as const };

  async function call(path: string, run: () => unknown) {
    const app = express();
    app.use((req, _res, next) => { req.kubedeckUser = person; next(); });
    app.use(bindIdentity);
    app.get(path, (_req, res) => { res.json(run()); });
    server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    return (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`)).json();
  }

  it("uses the group's uploaded kubeconfig, a service account, or else the person", async () => {
    await start();
    await createGroup({ name: "Developers", access: [
      upload("dev"),
      { context: "kind", as: "serviceaccount", namespace: "shop", serviceAccount: "shop-editor" },
    ] }, "a");
    setImpersonation({ impersonate: true, impersonatePrefix: "kubedeck:", impersonateGroupPrefix: "kubedeck:" });
    setClusterGrants((p, ctx) => clusterAccessFor(p.groups, ctx), "kind");
    const out = await call("/x", () => ({
      dev: asUser("kubectl", ["get", "pods", "--context=dev"]),
      devSpaced: asUser("kubectl", ["get", "pods", "--context", "dev"]),
      kind: asUser("kubectl", ["get", "pods"]),
      qa: asUser("kubectl", ["get", "pods", "--context=qa"]),
      // kubectl reads the last --context
      last: asUser("kubectl", ["get", "pods", "--context=dev", "--context=qa"]),
      server: asKubeDeck(() => asUser("kubectl", ["auth", "whoami", "--context=qa"])),
    }));
    const file = (clusterAccessFor(["developers"], "dev") as { kubeconfig: string }).kubeconfig;
    expect(out.dev).toEqual(["get", "pods", "--context=dev", `--kubeconfig=${file}`]);
    expect(out.devSpaced).toEqual(["get", "pods", "--context", "dev", `--kubeconfig=${file}`]);
    expect(out.kind).toEqual(["get", "pods", "--as=system:serviceaccount:shop:shop-editor"]);
    const asAnn = ["--as=kubedeck:ann@example.com", "--as-group=kubedeck:developers", "--as-group=system:authenticated"];
    expect(out.qa).toEqual(["get", "pods", "--context=qa", ...asAnn]);
    expect(out.last).toEqual(["get", "pods", "--context=dev", "--context=qa", ...asAnn]);
    expect(out.server).toEqual(["auth", "whoami", "--context=qa"]);
  });

  it("lets a KubeDeck admin use KubeDeck's own credentials where none of their groups applies", async () => {
    await start();
    setImpersonation({ impersonate: true, impersonatePrefix: "kubedeck:", impersonateGroupPrefix: "kubedeck:" });
    setClusterGrants((p, ctx) => clusterAccessFor(p.groups, ctx), "kind");
    const app = express();
    app.use((req, _res, next) => { req.kubedeckUser = { ...person, groups: [], role: "admin" }; next(); });
    app.use(bindIdentity);
    app.get("/x", (_req, res) => { res.json(asUser("kubectl", ["get", "nodes", "--context=qa"])); });
    server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    expect(await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`)).json()).toEqual(["get", "nodes", "--context=qa"]);
  });
});

describe("the Groups routes", () => {
  it("are for admins only, and say why a delete is refused", async () => {
    await start();
    let role: "admin" | "user" = "user";
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.kubedeckUser = { name: "x", email: "x@example.com", groups: [], role }; next(); });
    registerGroupRoutes(app, { members: async (id) => (id === "developers" ? 1 : 0), userPrefix: "kubedeck:", groupPrefix: "kubedeck:" });
    server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send = (method: string, path: string, body?: unknown) =>
      fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));

    expect((await send("GET", "/api/groups")).status).toBe(403);
    role = "admin";
    const sa = (context: string) => ({ context, as: "serviceaccount", namespace: "team", serviceAccount: "dev" });
    expect((await send("POST", "/api/groups", { name: "Developers", access: [sa("a"), sa("a")] })).status).toBe(400);
    expect((await send("POST", "/api/groups", { name: "Developers", access: [sa("-x")] })).status).toBe(400);
    expect(await send("POST", "/api/groups", { name: "Developers", access: [{ context: "qa", as: "credentials" }] })).toMatchObject({ status: 400, body: { message: "Upload a kubeconfig for qa." } });
    expect((await send("POST", "/api/groups", { name: "Developers", access: [sa("dev")] })).status).toBe(201);
    expect((await send("POST", "/api/groups", { name: "QA" })).status).toBe(201);
    expect((await send("PUT", "/api/groups/order", { ids: ["qa"] })).body.groups.map((g: { id: string }) => g.id)).toEqual(["qa", "developers"]);
    expect(await send("DELETE", "/api/groups/developers")).toMatchObject({ status: 409, body: { message: expect.stringContaining("still has 1 member") } });
    expect((await send("DELETE", "/api/groups/qa")).status).toBe(200);
    expect((await send("GET", "/api/groups/serviceaccounts/kind")).status).toBe(400);
    expect((await send("GET", "/api/groups/serviceaccounts/kind?namespace=-n")).status).toBe(400);
  });
});
