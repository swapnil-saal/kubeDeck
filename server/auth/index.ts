/**
 * KubeDeck's sign-in for web mode, built on Better Auth. This module is the only code
 * that knows Better Auth exists: the rest of the server sees a `WebUser` (name, email, groups, role).
 *
 * Who someone is, and which KubeDeck groups they are in, comes from here; what they may do in a
 * cluster is decided per kubectl call in identity.ts (their groups' cluster access, else RBAC for
 * `--as` / `--as-group`). The KubeDeck role only says who may manage users, groups and the audit log.
 *
 *   KUBEDECK_AUTH_SECRET=<32+ random characters>      signs sessions; keep it stable across restarts
 *   KUBEDECK_ADMIN_EMAIL / KUBEDECK_ADMIN_PASSWORD     first admin, created on start if missing
 */
import type { IncomingMessage, ServerResponse } from "http";
import { MIN_PASSWORD } from "@shared/admin";
import { roleOf, splitGroups } from "./groups";
import { CLIENT_IP_HEADER } from "./mount";
import type { Database } from "../db";
import type { WebUser } from "../web-mode";

export interface AuthConfig {
  secret: string;
  /** the address people open, e.g. https://kubedeck.example.com */
  baseURL: string;
  admin: { email: string; password: string; name: string } | null;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const email = (env.KUBEDECK_ADMIN_EMAIL ?? "").trim().toLowerCase();
  return {
    secret: env.KUBEDECK_AUTH_SECRET ?? "",
    baseURL: (env.KUBEDECK_PUBLIC_URL ?? "").replace(/\/+$/, ""),
    admin: email ? { email, password: env.KUBEDECK_ADMIN_PASSWORD ?? "", name: (env.KUBEDECK_ADMIN_NAME ?? "").trim() || email.split("@")[0] } : null,
  };
}

/** Problems that must stop the server: a guessable secret lets anyone forge a session. */
export function authConfigProblems(c: AuthConfig): string[] {
  const problems: string[] = [];
  if (c.secret.length < 32) problems.push("Web mode needs KUBEDECK_AUTH_SECRET of at least 32 characters (e.g. `openssl rand -base64 32`).");
  if (!/^https?:\/\//.test(c.baseURL)) problems.push("Web mode needs KUBEDECK_PUBLIC_URL, the address people open (e.g. https://kubedeck.example.com).");
  if (c.admin && c.admin.password && c.admin.password.length < MIN_PASSWORD) problems.push(`KUBEDECK_ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters.`);
  return problems;
}

/** What the rest of KubeDeck needs from the login. */
export interface KubeDeckAuth {
  /** Better Auth's own routes (sign in, sign out, session) */
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** the signed-in user of a request, or null */
  userOf(req: IncomingMessage): Promise<WebUser | null>;
  /** a request's headers in the form Better Auth's API takes (for calls made as the signed-in admin) */
  headersOf(req: IncomingMessage): Headers;
  /** how many accounts carry each group id */
  groupMembers(): Promise<Map<string, number>>;
  /** the Better Auth instance, for the admin routes in this module only */
  readonly instance: BetterAuthInstance;
}

// typed loosely on purpose: Better Auth's generated types are huge and only this module touches it
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BetterAuthInstance = { api: Record<string, (...args: any[]) => Promise<any>>; options: unknown; $context: Promise<any> };

export async function startAuth(d: Database, c: AuthConfig): Promise<KubeDeckAuth> {
  // loaded only in builtin mode: the desktop app never pulls Better Auth in
  const { betterAuth } = await import("better-auth");
  const { admin } = await import("better-auth/plugins");
  const { toNodeHandler, fromNodeHeaders } = await import("better-auth/node");
  const { getMigrations } = await import("better-auth/db/migration");

  const secure = c.baseURL.startsWith("https://");
  const options = {
    appName: "KubeDeck",
    baseURL: c.baseURL,
    basePath: "/api/auth",
    secret: c.secret,
    database: { db: d.db, type: d.type },
    trustedOrigins: [new URL(c.baseURL).origin],
    // accounts are created by an admin; nobody signs themselves up
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD, maxPasswordLength: 256 },
    user: {
      additionalFields: {
        // set only by an admin, through KubeDeck's admin routes (validated there)
        groups: { type: "string", required: false, defaultValue: "", input: false },
      },
    },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
    plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] })],
    rateLimit: { enabled: true, window: 60, max: 120, customRules: { "/sign-in/email": { window: 60, max: 10 } } },
    // the client address, set by mount.ts from the connection (or the trusted proxy hops), never by the browser
    advanced: { cookiePrefix: "kubedeck", useSecureCookies: secure, ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    telemetry: { enabled: false },
  } as const;

  // tables first: Better Auth checks them as soon as an instance exists
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { runMigrations } = await getMigrations(options as any);
  await runMigrations();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auth = betterAuth(options as any) as unknown as BetterAuthInstance;
  await ensureFirstAdmin(auth, c);

  const handler = toNodeHandler(auth as never);
  return {
    instance: auth,
    handle: (req, res) => handler(req, res),
    headersOf: (req) => fromNodeHeaders(req.headers),
    async groupMembers() {
      const ctx = await auth.$context;
      const users = (await ctx.internalAdapter.listUsers(100_000)) as { groups?: unknown }[];
      const counts = new Map<string, number>();
      for (const u of users) for (const g of splitGroups(u.groups)) counts.set(g, (counts.get(g) ?? 0) + 1);
      return counts;
    },
    async userOf(req) {
      const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!s?.user || s.user.banned) return null;
      return { id: s.user.id, name: s.user.name || s.user.email, email: s.user.email, groups: splitGroups(s.user.groups), role: roleOf(s.user.role) };
    },
  };
}

/** Create the admin named by KUBEDECK_ADMIN_EMAIL if no such user exists. Never changes an existing one. */
async function ensureFirstAdmin(auth: BetterAuthInstance, c: AuthConfig): Promise<void> {
  const ctx = await auth.$context;
  const users = await ctx.internalAdapter.listUsers(1);
  if (!c.admin) {
    if (users.length === 0) console.warn("[kubedeck] No users yet. Set KUBEDECK_ADMIN_EMAIL and KUBEDECK_ADMIN_PASSWORD to create the first admin.");
    return;
  }
  const existing = await ctx.internalAdapter.findUserByEmail(c.admin.email);
  if (existing) return;
  if (!c.admin.password) {
    console.warn(`[kubedeck] ${c.admin.email} does not exist yet: set KUBEDECK_ADMIN_PASSWORD to create it.`);
    return;
  }
  await auth.api.createUser({ body: { email: c.admin.email, password: c.admin.password, name: c.admin.name, role: "admin" } });
  console.log(`[kubedeck] Created the first admin, ${c.admin.email}. Sign in and add users under Settings → Users.`);
}

export { joinGroups, roleOf, splitGroups } from "./groups";
export { CLIENT_IP_HEADER, mountAuthRoutes } from "./mount";
export { registerAdminRoutes, type AdminRouteDeps } from "./admin-routes";
