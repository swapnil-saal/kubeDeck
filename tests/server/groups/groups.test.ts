import { readFileSync, statSync } from "fs";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@server/db";
import { memoryDatabase } from "@tests/support/db";
import { unreachableKubeconfig } from "@tests/support/kubeconfig";
import { addCluster, clusterFile, databaseClusterStore, startClusters, stopClusters } from "@server/clusters";
import { asKubeDeck, asUser, asUserChoices, bindIdentity, NO_ACCESS, setClusterGrants } from "@server/identity";
import { normalizeKubeconfig } from "@server/kubeconfig-files";
import { adoptGroups, clusterAccessFor, clusterGrantsFor, clustersFor, createGroup, deleteGroup, databaseGroupStore, listGroups, registerGroupRoutes, reorderGroups, startGroups, stopGroups, updateGroup } from "@server/groups";

let d: Database | undefined;
let server: Server | undefined;
const ENV = { KUBEDECK_AUTH_SECRET: "s".repeat(40) };

/** A database with the clusters dev, qa and kind added (their API servers do not exist), and groups started. */
async function start() {
  d = await memoryDatabase();
  await startClusters(databaseClusterStore(d), ENV);
  for (const name of ["dev", "qa", "kind"]) await addCluster(name, "kubeconfig", kubeconfig({ token: `kubedeck-${name}` }), "admin");
  await startGroups(databaseGroupStore(d), ENV);
}

const kubeconfig = unreachableKubeconfig;
const upload = (context: string, user?: Record<string, unknown>) => ({ context, as: "credentials" as const, kubeconfig: kubeconfig(user) });

afterEach(async () => {
  stopGroups();
  stopClusters();
  setClusterGrants(null);
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

  it("start with every KubeDeck permission on, and keep the ones a save leaves out", async () => {
    await start();
    const g = await createGroup({ name: "QA", permissions: { palette: false } }, "a");
    expect(g.permissions).toEqual({ assistant: true, assistantChanges: true, palette: false, podFiles: true, projects: true, mcp: true });
    await updateGroup("qa", { permissions: { assistant: false } }, "a");
    stopGroups();
    await startGroups(databaseGroupStore(d!), ENV);
    expect(listGroups()[0].permissions).toMatchObject({ assistant: false, palette: false, podFiles: true });
  });

  it("changes access, and refuses to delete a group someone is still in", async () => {
    await start();
    await createGroup({ name: "Developers" }, "a");
    await updateGroup("developers", { access: [{ context: "kind", as: "serviceaccount", namespace: "shop", serviceAccount: "web" }] }, "a");
    expect(clusterAccessFor(["developers"], "kind")).toEqual({ as: "serviceaccount", kubeconfig: clusterFile("kind"), namespace: "shop", serviceAccount: "web" });
    await expect(updateGroup("developers", { access: [{ context: "prod", as: "serviceaccount", namespace: "shop", serviceAccount: "web" }] }, "a")).rejects.toThrow("There is no cluster named prod");
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

  it("take the context named like KubeDeck's cluster from a kubeconfig with several", () => {
    const several = `
apiVersion: v1
kind: Config
clusters: [{ name: a, cluster: { server: "https://a:6443" } }, { name: b, cluster: { server: "https://b:6443" } }]
users: [{ name: ua, user: { token: ta } }, { name: ub, user: { token: tb } }]
contexts: [{ name: qa, context: { cluster: a, user: ua } }, { name: dev, context: { cluster: b, user: ub } }]
current-context: dev
`;
    expect(normalizeKubeconfig(several, "qa")).toMatchObject({ server: "https://a:6443" });
    expect(normalizeKubeconfig(several, "other")).toMatchObject({ server: "https://b:6443" });
    expect(() => normalizeKubeconfig(several.replace("current-context: dev", ""), "other")).toThrow("none is named other or current");
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

  it("uses the group's uploaded kubeconfig or a service account through the cluster's connection, else no access", async () => {
    await start();
    await createGroup({ name: "Developers", access: [
      upload("dev"),
      { context: "kind", as: "serviceaccount", namespace: "shop", serviceAccount: "shop-editor" },
    ] }, "a");
    setClusterGrants((p, ctx) => clusterGrantsFor(p.groups, ctx), (p) => clustersFor(p.groups));
    const out = await call("/x", () => ({
      dev: asUser("kubectl", ["get", "pods", "--context=dev"]),
      devSpaced: asUser("kubectl", ["get", "pods", "--context", "dev"]),
      kind: asUser("kubectl", ["get", "pods", "--context=kind"]),
      qa: asUser("kubectl", ["get", "pods", "--context=qa"]),
      none: asUser("kubectl", ["get", "pods"]),
      // kubectl reads the last --context
      last: asUser("kubectl", ["get", "pods", "--context=dev", "--context=qa"]),
      server: asKubeDeck(() => asUser("kubectl", ["auth", "whoami", "--context=qa"])),
    }));
    const file = (clusterAccessFor(["developers"], "dev") as { kubeconfig: string }).kubeconfig;
    expect(out.dev).toEqual(["get", "pods", "--context=dev", `--kubeconfig=${file}`]);
    expect(out.devSpaced).toEqual(["get", "pods", "--context", "dev", `--kubeconfig=${file}`]);
    expect(out.kind).toEqual(["get", "pods", "--context=kind", `--kubeconfig=${clusterFile("kind")}`, "--as=system:serviceaccount:shop:shop-editor"]);
    expect(out.qa).toEqual(["get", "pods", "--context=qa", ...NO_ACCESS]);
    expect(out.none).toEqual(["get", "pods", ...NO_ACCESS]);
    expect(out.last).toEqual(["get", "pods", "--context=dev", "--context=qa", ...NO_ACCESS]);
    expect(out.server).toEqual(["auth", "whoami", "--context=qa"]);
    expect(clustersFor(["developers"])).toEqual(["dev", "kind"]);
  });

  it("tries every service account a person's groups give them on a cluster, in order, and nothing else", async () => {
    await start();
    await createGroup({ name: "Readers", access: [{ context: "kind", as: "serviceaccount", namespace: "shop", serviceAccount: "viewer" }] }, "a");
    await createGroup({ name: "Developers", access: [{ context: "kind", as: "serviceaccount", namespace: "shop", serviceAccount: "editor" }] }, "a");
    setClusterGrants((p, ctx) => clusterGrantsFor(p.groups, ctx), (p) => clustersFor(p.groups));
    const app = express();
    app.use((req, _res, next) => { req.kubedeckUser = { ...person, groups: ["developers", "readers"] }; next(); });
    app.use(bindIdentity);
    app.get("/x", (_req, res) => { res.json(asUserChoices("kubectl", ["delete", "pod", "web-1", "--context=kind"])); });
    server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const choices = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`)).json();
    const kind = `--kubeconfig=${clusterFile("kind")}`;
    expect(choices.map((c: string[]) => c.slice(4))).toEqual([
      [kind, "--as=system:serviceaccount:shop:viewer"],
      [kind, "--as=system:serviceaccount:shop:editor"],
    ]);
  });

  it("gives a KubeDeck admin no cluster that none of their groups covers", async () => {
    await start();
    setClusterGrants((p, ctx) => clusterGrantsFor(p.groups, ctx), (p) => clustersFor(p.groups));
    const app = express();
    app.use((req, _res, next) => { req.kubedeckUser = { ...person, groups: [], role: "admin" }; next(); });
    app.use(bindIdentity);
    app.get("/x", (_req, res) => { res.json(asUser("kubectl", ["get", "nodes", "--context=qa"])); });
    server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    expect(await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`)).json()).toEqual(["get", "nodes", "--context=qa", ...NO_ACCESS]);
  });
});

describe("the Groups routes", () => {
  it("are for admins only, and say why a delete is refused", async () => {
    await start();
    let role: "admin" | "user" = "user";
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.kubedeckUser = { name: "x", email: "x@example.com", groups: [], role }; next(); });
    registerGroupRoutes(app, { members: async (id) => (id === "developers" ? 1 : 0) });
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
