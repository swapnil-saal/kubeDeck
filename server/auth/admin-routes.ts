/**
 * Users, for KubeDeck admins (web mode only; the audit log is server/audit/routes.ts). The browser
 * talks to these routes, never to Better Auth's own /api/auth/admin/* (blocked in mount.ts): group
 * names become Kubernetes groups, so they are validated here before anything is stored. Each change
 * that succeeds is announced as a `user.changed` event.
 */
import type { Express, Request, Response } from "express";
import type { ZodError } from "zod";
import {
  adminPaths,
  banSchema,
  createUserSchema,
  setPasswordSchema,
  updateUserSchema,
  type AdminUser,
  type UserList,
} from "@shared/admin";
import { emit, type UserChanged } from "../events";
import { webConfig } from "../web-mode";
import { joinGroups, roleOf, splitGroups } from "./groups";
import type { KubeDeckAuth } from "./index";

const firstIssue = (e: ZodError) => e.issues[0]?.message ?? "Invalid input.";

/** Better Auth throws errors with a status and a message; pass both on. */
function fail(res: Response, err: unknown): void {
  const e = err as { statusCode?: number; status?: number | string; body?: { message?: string }; message?: string };
  const status = typeof e.statusCode === "number" ? e.statusCode : typeof e.status === "number" ? e.status : 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({ message: e.body?.message || e.message || "Something went wrong." });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAdminUser(u: any): AdminUser {
  return {
    id: String(u.id),
    name: u.name ?? "",
    email: u.email ?? "",
    role: roleOf(u.role),
    groups: splitGroups(u.groups),
    banned: !!u.banned,
    banReason: u.banReason ?? null,
    createdAt: new Date(u.createdAt).toISOString(),
  };
}

const self = (req: Request) => req.kubedeckUser?.id ?? "";

/** Tell the rest of KubeDeck that an admin changed an account. */
const changed = (req: Request, userId: string, change: UserChanged["change"]) => emit("user.changed", { userId, by: self(req), change });

/** A change to the account in the path succeeded: announce it and say so. */
function done(req: Request, res: Response, change: UserChanged["change"]): void {
  changed(req, String(req.params.id), change);
  res.json({ ok: true });
}

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** What the admin routes need from outside this module. */
export interface AdminRouteDeps {
  /** the groups defined under Settings → Groups: an account may carry only these */
  knownGroups(): string[];
}

/** Each admin action, given what it needs. Every one answers with JSON, or the error's own status. */
function adminHandlers(auth: KubeDeckAuth, deps: AdminRouteDeps): Record<string, Handler> {
  const api = auth.instance.api;
  const headers = (req: Request) => auth.headersOf(req);
  const id = (req: Request) => String(req.params.id);
  /** a message naming the groups nobody defined, or null */
  const undefinedGroups = (groups: string[] | undefined): string | null => {
    const known = new Set(deps.knownGroups());
    const missing = (groups ?? []).filter((g) => !known.has(g));
    return missing.length ? `No group named ${missing.join(", ")}. Create ${missing.length === 1 ? "it" : "them"} under Settings → Groups first.` : null;
  };
  const setGroups = async (userId: string, groups: string[]) => {
    const ctx = await auth.instance.$context;
    await ctx.internalAdapter.updateUser(userId, { groups: joinGroups(groups) });
  };

  return {
    async list(req, res) {
      const r = await api.listUsers({ headers: headers(req), query: { limit: 1000, sortBy: "createdAt", sortDirection: "asc" } });
      const c = webConfig();
      res.json({ users: (r.users ?? []).map(toAdminUser), userPrefix: c.impersonatePrefix, groupPrefix: c.impersonateGroupPrefix } satisfies UserList);
    },
    async create(req, res) {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
      const { name, email, password, role, groups } = parsed.data;
      const unknown = undefinedGroups(groups);
      if (unknown) return res.status(400).json({ message: unknown });
      const r = await api.createUser({ headers: headers(req), body: { name, email, password, role } });
      if (groups.length) await setGroups(r.user.id, groups);
      changed(req, String(r.user.id), "created");
      res.status(201).json(toAdminUser({ ...r.user, groups: joinGroups(groups) }));
    },
    async update(req, res) {
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
      const { name, role, groups } = parsed.data;
      const unknown = undefinedGroups(groups);
      if (unknown) return res.status(400).json({ message: unknown });
      if (id(req) === self(req) && role && role !== "admin") return res.status(400).json({ message: "You cannot remove your own admin role. Ask another admin." });
      if (name) await api.adminUpdateUser({ headers: headers(req), body: { userId: id(req), data: { name } } });
      if (role) await api.setRole({ headers: headers(req), body: { userId: id(req), role } });
      if (groups) await setGroups(id(req), groups);
      changed(req, id(req), "updated");
      res.json(toAdminUser(await api.getUser({ headers: headers(req), query: { id: id(req) } })));
    },
    async password(req, res) {
      const parsed = setPasswordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
      await api.setUserPassword({ headers: headers(req), body: { userId: id(req), newPassword: parsed.data.password } });
      done(req, res, "password");
    },
    async ban(req, res) {
      const parsed = banSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
      if (id(req) === self(req)) return res.status(400).json({ message: "You cannot block your own account." });
      if (parsed.data.banned) await api.banUser({ headers: headers(req), body: { userId: id(req), banReason: parsed.data.reason || undefined } });
      else await api.unbanUser({ headers: headers(req), body: { userId: id(req) } });
      done(req, res, parsed.data.banned ? "blocked" : "unblocked");
    },
    async signOutEverywhere(req, res) {
      await api.revokeUserSessions({ headers: headers(req), body: { userId: id(req) } });
      done(req, res, "signed-out");
    },
    async remove(req, res) {
      if (id(req) === self(req)) return res.status(400).json({ message: "You cannot delete your own account." });
      await api.removeUser({ headers: headers(req), body: { userId: id(req) } });
      done(req, res, "deleted");
    },
  };
}

export function registerAdminRoutes(app: Express, auth: KubeDeckAuth, deps: AdminRouteDeps): void {
  const h = adminHandlers(auth, deps);
  // only a KubeDeck admin; then the handler, with any error answered with its own status
  const route = (handler: Handler) => (req: Request, res: Response) => {
    if (req.kubedeckUser?.role !== "admin") return void res.status(403).json({ message: "Only a KubeDeck admin can manage users." });
    handler(req, res).catch((err) => fail(res, err));
  };
  app.get(adminPaths.users, route(h.list));
  app.post(adminPaths.users, route(h.create));
  app.patch(adminPaths.user, route(h.update));
  app.post(adminPaths.password, route(h.password));
  app.post(adminPaths.ban, route(h.ban));
  app.delete(adminPaths.sessions, route(h.signOutEverywhere));
  app.delete(adminPaths.user, route(h.remove));
}
