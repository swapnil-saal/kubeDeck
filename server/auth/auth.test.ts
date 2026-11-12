/**
 * KubeDeck's own sign-in, end to end over HTTP: the real gate, the real Better Auth, a real (in-memory)
 * SQLite database. Nothing here talks to a cluster.
 */
import express, { type Express } from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAudit, registerAuditRoutes, startAudit } from "../audit";
import { databaseTarget, migrate, openDatabase, type Database } from "../db";
import { on, settled, type UserChanged } from "../events";
import { auditLog, describeMode, loadWebConfig, setSessionResolver, setWebConfig, webGate } from "../web-mode";
import { authConfigProblems, loadAuthConfig, mountAuthRoutes, registerAdminRoutes, roleOf, splitGroups, startAuth, type KubeDeckAuth } from "./index";

const ADMIN = { email: "admin@example.com", password: "admin-password-123", name: "Admin" };

let server: Server;
let base = "";
let d: Database;
let auth: KubeDeckAuth | null = null;
const stops: (() => void)[] = [];
const userChanges: UserChanged[] = [];

/** fetch with a cookie jar of one session, sending the Origin a browser would */
function client() {
  let cookie = "";
  return async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(base + path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { origin: base, ...(cookie ? { cookie } : {}), ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

beforeAll(async () => {
  const app: Express = express();
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  setWebConfig(loadWebConfig({ KUBEDECK_MODE: "web", KUBEDECK_AUTH: "builtin", KUBEDECK_PUBLIC_URL: base }));
  // KUBEDECK_TEST_DATABASE_URL=postgres://… runs the same tests against Postgres (an empty database)
  const url = process.env.KUBEDECK_TEST_DATABASE_URL;
  d = await openDatabase(url ? databaseTarget(url) : { type: "sqlite", target: ":memory:" });
  await migrate(d);
  auth = await startAuth(d, { secret: "x".repeat(40), baseURL: base, admin: ADMIN });
  setSessionResolver((req) => auth!.userOf(req));
  stops.push(startAudit(d), on("user.changed", (e) => { userChanges.push(e); }));

  app.use(webGate);
  app.use(auditLog);
  mountAuthRoutes(app, () => auth);
  app.get("/api/mode", (req, res) => { res.json(describeMode(req)); });
  app.use(express.json());
  registerAdminRoutes(app, auth);
  registerAuditRoutes(app, d);
  app.get("/api/whoami", (req, res) => { res.json(req.kubedeckUser); });
  app.post("/api/k8s/deployments/web/scale", (req, res) => { res.json({ ok: true }); });
});

afterAll(async () => {
  setWebConfig(loadWebConfig({}));
  setSessionResolver(null);
  for (const stop of stops) stop();
  server?.close();
  await d?.close();
});

describe("auth config", () => {
  it("refuses a short secret, a missing public URL and a short admin password", () => {
    const c = loadAuthConfig({ KUBEDECK_AUTH_SECRET: "short", KUBEDECK_ADMIN_EMAIL: "A@Example.com", KUBEDECK_ADMIN_PASSWORD: "short" });
    expect(c.admin?.email).toBe("a@example.com");
    expect(authConfigProblems(c).join(" ")).toMatch(/32 characters.*KUBEDECK_PUBLIC_URL.*12 characters/);
    expect(authConfigProblems(loadAuthConfig({ KUBEDECK_AUTH_SECRET: "y".repeat(32), KUBEDECK_PUBLIC_URL: "https://k.example.com" }))).toEqual([]);
  });
  it("reads groups and roles as Better Auth stores them", () => {
    expect(splitGroups("shop-editors, viewers,")).toEqual(["shop-editors", "viewers"]);
    expect(roleOf("user,admin")).toBe("admin");
    expect(roleOf(undefined)).toBe("user");
  });
});

describe("builtin sign-in over HTTP", () => {
  it("lets the app and /api/mode load without a session, and refuses the API", async () => {
    const c = client();
    expect((await c("/api/mode")).body).toMatchObject({ auth: "builtin", user: null, features: { users: false, audit: false } });
    expect((await c("/api/whoami")).status).toBe(401);
  });

  it("creates the first admin, signs them in, and reports who they are", async () => {
    const c = client();
    expect((await c("/api/auth/sign-in/email", { body: { email: ADMIN.email, password: "wrong-password-1" } })).status).toBe(401);
    expect((await c("/api/auth/sign-in/email", { body: { email: ADMIN.email, password: ADMIN.password } })).status).toBe(200);
    expect((await c("/api/mode")).body).toMatchObject({ user: { email: ADMIN.email, role: "admin", groups: [] }, features: { users: true, audit: true } });
  });

  it("has no self sign-up, and Better Auth's own admin routes are not reachable", async () => {
    const c = client();
    const up = await c("/api/auth/sign-up/email", { body: { email: "new@example.com", password: "new-password-123", name: "New" } });
    expect(up.status).toBe(400);
    await c("/api/auth/sign-in/email", { body: { email: ADMIN.email, password: ADMIN.password } });
    expect((await c("/api/auth/admin/list-users")).status).toBe(404);
  });

  it("lets an admin add a user with groups, and the user then acts with those groups", async () => {
    const admin = client();
    await admin("/api/auth/sign-in/email", { body: { email: ADMIN.email, password: ADMIN.password } });
    const bad = await admin("/api/admin/users", { body: { name: "M", email: "m@example.com", password: "m-password-1234", groups: ["system:masters"] } });
    expect(bad.status).toBe(400);
    const made = await admin("/api/admin/users", { body: { name: "Alice", email: "Alice@Example.com", password: "alice-password-1", groups: ["shop-editors", "viewers"] } });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ email: "alice@example.com", role: "user", groups: ["shop-editors", "viewers"] });

    const alice = client();
    expect((await alice("/api/auth/sign-in/email", { body: { email: "alice@example.com", password: "alice-password-1" } })).status).toBe(200);
    expect((await alice("/api/whoami")).body).toMatchObject({ email: "alice@example.com", groups: ["shop-editors", "viewers"], role: "user" });
    // not an admin
    expect((await alice("/api/admin/users")).status).toBe(403);
    expect((await alice("/api/admin/audit")).status).toBe(403);
    expect((await alice("/api/mode")).body.features).toMatchObject({ users: false, audit: false });

    // a group change applies on the next request, without signing in again
    const patched = await admin(`/api/admin/users/${made.body.id}`, { method: "PATCH", body: { groups: ["ops-editors"] } });
    expect(patched.body.groups).toEqual(["ops-editors"]);
    expect((await alice("/api/whoami")).body.groups).toEqual(["ops-editors"]);

    // blocking signs them out at once
    expect((await admin(`/api/admin/users/${made.body.id}/ban`, { body: { banned: true, reason: "left" } })).status).toBe(200);
    expect((await alice("/api/whoami")).status).toBe(401);
    expect((await alice("/api/auth/sign-in/email", { body: { email: "alice@example.com", password: "alice-password-1" } })).status).toBe(403);

    // each change was announced, naming the admin who made it; the refused one was not
    await settled();
    const aliceChanges = userChanges.filter((e) => e.userId === made.body.id);
    expect(aliceChanges.map((e) => e.change)).toEqual(["created", "updated", "blocked"]);
    expect(aliceChanges.every((e) => e.by && e.by !== made.body.id)).toBe(true);
  });

  it("keeps an admin from locking themselves out", async () => {
    const admin = client();
    await admin("/api/auth/sign-in/email", { body: { email: ADMIN.email, password: ADMIN.password } });
    const me = (await admin("/api/admin/users")).body.users.find((u: { email: string }) => u.email === ADMIN.email);
    expect((await admin(`/api/admin/users/${me.id}`, { method: "PATCH", body: { role: "user" } })).status).toBe(400);
    expect((await admin(`/api/admin/users/${me.id}/ban`, { body: { banned: true } })).status).toBe(400);
    expect((await admin(`/api/admin/users/${me.id}`, { method: "DELETE" })).status).toBe(400);
  });

  it("records every write with the user, their groups and the scope", async () => {
    const admin = client();
    await admin("/api/auth/sign-in/email", { body: { email: ADMIN.email, password: ADMIN.password } });
    await admin("/api/k8s/deployments/web/scale?context=kind&namespace=shop", { body: { replicas: 2 } });
    // the record is emitted when the response has finished, and stored by the audit module's handler
    await new Promise((r) => setTimeout(r, 50));
    await settled();
    const { entries } = await listAudit(d, { user: ADMIN.email, limit: 5 });
    expect(entries[0]).toMatchObject({ userEmail: ADMIN.email, method: "POST", path: "/api/k8s/deployments/web/scale", status: 200, context: "kind", namespace: "shop" });
    // signing in is not a cluster change
    expect(entries.some((e) => e.path.startsWith("/api/auth/"))).toBe(false);
    expect((await admin("/api/admin/audit?limit=2")).body.entries).toHaveLength(2);
  });
});
