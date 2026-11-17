import { readFileSync, statSync } from "fs";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "@server/db";
import { memoryDatabase } from "@tests/support/db";
import { unreachableKubeconfig } from "@tests/support/kubeconfig";
import { addCluster, clusterFile, clusterNames, databaseClusterStore, inClusterAvailable, registerClusterRoutes, removeCluster, replaceConnection, startClusters, stopClusters } from "@server/clusters";

const ENV = { KUBEDECK_AUTH_SECRET: "c".repeat(40) };
let d: Database | undefined;
let server: Server | undefined;

const kubeconfig = (token = "kubedeck-token") => unreachableKubeconfig({ token });

async function start(env = ENV) {
  d ??= await memoryDatabase();
  await startClusters(databaseClusterStore(d), env);
}

afterEach(async () => {
  stopClusters();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
  await d?.close();
  d = undefined;
});

describe("clusters of a shared KubeDeck", () => {
  it("keep KubeDeck's connection encrypted, written to a private file named like the cluster", async () => {
    await start();
    await addCluster("prod", "kubeconfig", kubeconfig("secret-123"), "admin");
    const row = await d!.db.selectFrom("kubedeck_cluster").selectAll().executeTakeFirst();
    expect(row).toMatchObject({ name: "prod", source: "kubeconfig", server: "https://127.0.0.1:1" });
    expect(row!.credentials).toMatch(/^enc:v1:/);
    expect(row!.credentials).not.toContain("secret-123");
    const file = clusterFile("prod")!;
    expect(readFileSync(file, "utf-8")).toContain("current-context: prod");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    stopClusters();
    await start();
    expect(clusterNames()).toEqual(["prod"]);
    expect(readFileSync(clusterFile("prod")!, "utf-8")).toContain("secret-123");
  });

  it("refuse a second cluster of the same name, a kubeconfig that could run a program, and the pod's own account outside a pod", async () => {
    await start();
    await addCluster("prod", "kubeconfig", kubeconfig(), "admin");
    await expect(addCluster("prod", "kubeconfig", kubeconfig(), "admin")).rejects.toThrow("already exists");
    await expect(addCluster("dev", "kubeconfig", unreachableKubeconfig({ exec: { command: "sh" } }), "admin")).rejects.toThrow("exec plugin");
    const cutShort = kubeconfig().replace(/certificate-authority-data: \S+/, "certificate-authority-data: LS0tLS1CRUdJTi...");
    await expect(addCluster("dev", "kubeconfig", cutShort, "admin")).rejects.toThrow("incomplete or damaged");
    expect(clusterNames()).toEqual(["prod"]);
    expect(inClusterAvailable()).toBe(false);
    await expect(addCluster("here", "in-cluster", undefined, "admin")).rejects.toThrow("not running inside a Kubernetes cluster");
  });

  it("take a new kubeconfig, and are removed only when no group uses them", async () => {
    await start();
    await addCluster("prod", "kubeconfig", kubeconfig("old"), "admin");
    await replaceConnection("prod", kubeconfig("new"), "admin");
    expect(readFileSync(clusterFile("prod")!, "utf-8")).toContain("new");
    await expect(removeCluster("prod", ["Developers"], "admin")).rejects.toThrow("Developers still uses prod");
    await removeCluster("prod", [], "admin");
    expect(clusterNames()).toEqual([]);
    expect(clusterFile("prod")).toBeUndefined();
  });

  it("cannot be read after KUBEDECK_AUTH_SECRET changed: no connection file, so no access", async () => {
    await start();
    await addCluster("prod", "kubeconfig", kubeconfig(), "admin");
    stopClusters();
    await start({ KUBEDECK_AUTH_SECRET: "other".repeat(10) });
    expect(clusterNames()).toEqual(["prod"]);
    expect(clusterFile("prod")).toBeUndefined();
  });
});

describe("the Clusters routes", () => {
  it("are for admins only and say who uses a cluster", async () => {
    await start();
    let role: "admin" | "user" = "user";
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.kubedeckUser = { name: "x", email: "x@example.com", groups: [], role }; next(); });
    registerClusterRoutes(app, { usedBy: (name) => (name === "prod" ? ["Developers"] : []) });
    server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send = (method: string, path: string, body?: unknown) =>
      fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));

    expect((await send("GET", "/api/clusters")).status).toBe(403);
    role = "admin";
    expect((await send("POST", "/api/clusters", { name: "-bad", source: "kubeconfig", kubeconfig: kubeconfig() })).status).toBe(400);
    expect((await send("POST", "/api/clusters", { name: "prod", source: "kubeconfig" })).status).toBe(400);
    const added = await send("POST", "/api/clusters", { name: "prod", source: "kubeconfig", kubeconfig: kubeconfig() });
    expect(added).toMatchObject({ status: 201, body: { clusters: [{ name: "prod", source: "kubeconfig", usedBy: ["Developers"] }], inClusterAvailable: false } });
    expect(JSON.stringify(added.body)).not.toContain("kubedeck-token");
    expect(await send("DELETE", "/api/clusters/prod")).toMatchObject({ status: 409, body: { message: expect.stringContaining("Developers still uses prod") } });
    expect((await send("GET", "/api/clusters/nowhere/namespaces")).status).toBe(404);
  });
});
