import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@server/db";
import { memoryDatabase } from "@tests/support/db";
import { databaseProjectStore, registerProjectRoutes } from "@server/projects";

let d: Database;
let server: Server;
let base = "";
const people = {
  ann: { name: "Ann", email: "ann@example.com", groups: [], role: "user" as const },
  bob: { name: "Bob", email: "bob@example.com", groups: [], role: "user" as const },
  root: { name: "Root", email: "root@example.com", groups: [], role: "admin" as const },
};

beforeAll(async () => {
  d = await memoryDatabase();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.kubedeckUser = people[(req.headers["x-who"] as keyof typeof people) ?? "ann"]; next(); });
  registerProjectRoutes(app, databaseProjectStore(d));
  server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await d.close();
});

const as = (who: keyof typeof people) => (method: string, path: string, body?: unknown) =>
  fetch(base + path, { method, headers: { "Content-Type": "application/json", "x-who": who }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

describe("projects on the server", () => {
  it("are shared, and only their creator or an admin changes them", async () => {
    const ann = as("ann"), bob = as("bob"), root = as("root");
    const made = await ann("POST", "/api/projects", { name: "Payments API", scopes: [{ context: "dev", namespace: "pay" }, { context: "dev", namespace: "pay" }] });
    expect(made).toMatchObject({ status: 201, body: { id: "payments-api", createdBy: "ann@example.com", canEdit: true, scopes: [{ context: "dev", namespace: "pay" }] } });

    const seen = await bob("GET", "/api/projects");
    expect(seen.body.projects).toMatchObject([{ id: "payments-api", canEdit: false }]);
    expect((await bob("PUT", "/api/projects/payments-api", { name: "Mine", scopes: [{ context: "dev", namespace: "x" }] })).status).toBe(403);
    expect((await bob("DELETE", "/api/projects/payments-api")).status).toBe(403);

    const renamed = await ann("PUT", "/api/projects/payments-api", { name: "Payments", description: "checkout", scopes: [{ context: "qa", namespace: "pay" }] });
    expect(renamed.body).toMatchObject({ id: "payments-api", name: "Payments", description: "checkout" });
    expect((await root("DELETE", "/api/projects/payments-api")).status).toBe(200);
    expect((await ann("GET", "/api/projects")).body.projects).toEqual([]);
  });

  it("refuse a project without namespaces or with a bad name", async () => {
    const ann = as("ann");
    expect((await ann("POST", "/api/projects", { name: "x", scopes: [] })).status).toBe(400);
    expect((await ann("POST", "/api/projects", { name: "x", scopes: [{ context: "-bad", namespace: "a" }] })).status).toBe(400);
    expect((await ann("POST", "/api/projects", { name: "x", scopes: [{ context: "a", namespace: "all" }] })).status).toBe(400);
  });

  it("take a browser's old projects once", async () => {
    const bob = as("bob");
    const old = { projects: [{ name: "Shop", scopes: [{ context: "kind", namespace: "shop" }], createdAt: 1_700_000_000_000 }] };
    expect((await bob("POST", "/api/projects/import", old)).body).toEqual({ added: 1 });
    expect((await bob("POST", "/api/projects/import", old)).body).toEqual({ added: 0 });
    expect((await bob("GET", "/api/projects")).body.projects).toMatchObject([{ id: "shop", createdBy: "bob@example.com", createdAt: 1_700_000_000_000 }]);
  });
});
