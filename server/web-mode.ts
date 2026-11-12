/**
 * Web (server) mode: KubeDeck run as a shared service behind an authenticating reverse proxy
 * (oauth2-proxy + Keycloak, or any proxy that sets identity headers), instead of as a desktop app.
 *
 * Web mode offers the desktop app's features. A shared host cannot trust "whoever is at this
 * machine", so it adds:
 *  - an identity gate: every request must come through the proxy (shared secret, or an explicit
 *    "the network only lets the proxy reach me" declaration) and carry a user. KUBEDECK_AUTH=none
 *    drops the gate for private test clusters: everyone who reaches the URL is "anonymous";
 *    KUBEDECK_AUTH=builtin replaces the proxy with KubeDeck's own login (server/auth): users and
 *    groups an admin manages, each user acting with their groups' Kubernetes RBAC;
 *  - an optional group allow-list;
 *  - switches to turn writes, the AI assistant and pod files off (KUBEDECK_READ_ONLY,
 *    KUBEDECK_AI, KUBEDECK_POD_FILES); all are on unless turned off;
 *  - limits that keep users inside the server's own identity: no kubectl config / auth / exec /
 *    cp / proxy / attach / debug and no identity flags, from the palette or the assistant; the
 *    assistant's pipelines run without a shell;
 *  - settings (kubeconfig, AI provider) come from the environment, never from the browser;
 *  - no port-forward: the port would open inside the server, out of the user's reach;
 *  - an audit line for every non-GET request and every assistant change, with the user's name.
 *
 * Turn it on with KUBEDECK_MODE=web. See docs/WEB.md.
 */
import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import type { IncomingMessage } from "http";
import { scanShell, type SafetyLevel } from "./kubectl-safety";

export interface WebConfig {
  enabled: boolean;
  /** forbid every mutating action (default false; KUBEDECK_READ_ONLY=true) */
  readOnly: boolean;
  /** the AI assistant and AI insights (default on; KUBEDECK_AI=off) */
  ai: boolean;
  /** pod file browsing via kubectl exec of fixed scripts (default on; KUBEDECK_POD_FILES=off) */
  podFiles: boolean;
  /** public hostname(s) users reach the app on, e.g. kubedeck.example.com */
  hosts: string[];
  /** value the proxy must send in `X-KubeDeck-Proxy-Secret` */
  proxySecret: string;
  /** the network guarantees only the proxy can reach this server (NetworkPolicy), so headers are trusted as-is */
  trustProxyNetwork: boolean;
  /** if set, the user must belong to at least one of these groups */
  allowedGroups: string[];
  /** no login proxy at all (KUBEDECK_AUTH=none): every request is the anonymous user */
  authNone: boolean;
  /** KubeDeck's own login (KUBEDECK_AUTH=builtin): no proxy; the session cookie names the user */
  builtin: boolean;
  /** KUBEDECK_ACCESS=impersonate: act as each signed-in user (kubectl --as), so their own RBAC applies */
  impersonate: boolean;
  /** which header becomes the Kubernetes user name: "email" (default) or "name" */
  impersonateUser: "email" | "name";
  /** prepended to the user and group names, to match the API server's OIDC prefixes (e.g. "oidc:") */
  impersonatePrefix: string;
  impersonateGroupPrefix: string;
}

/** Who a request is when KUBEDECK_AUTH=none. */
export const ANONYMOUS: WebUser = { name: "anonymous", email: "", groups: [] };

export interface WebUser {
  name: string;
  email: string;
  groups: string[];
  /** builtin login only: the account id and whether it may manage users */
  id?: string;
  role?: "admin" | "user";
}

const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? "").trim());
const falsy = (v: string | undefined) => /^(0|false|no|off)$/i.test((v ?? "").trim());
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const hosts = list(env.KUBEDECK_PUBLIC_HOSTS ?? env.KUBEDECK_ALLOWED_HOSTS).map((h) => h.toLowerCase());
  if (env.KUBEDECK_PUBLIC_URL) {
    try { hosts.push(new URL(env.KUBEDECK_PUBLIC_URL).hostname.toLowerCase()); } catch { /* reported by validateWebConfig */ }
  }
  const auth = (env.KUBEDECK_AUTH ?? "").trim().toLowerCase();
  const builtin = auth === "builtin";
  const access = (env.KUBEDECK_ACCESS ?? "").trim().toLowerCase();
  // with KubeDeck's own login, names get a prefix by default so a KubeDeck group can never be a
  // built-in one (system:masters); an operator can still set their own
  const prefix = (v: string | undefined) => v ?? (builtin ? "kubedeck:" : "");
  return {
    enabled: (env.KUBEDECK_MODE ?? "").toLowerCase() === "web",
    readOnly: truthy(env.KUBEDECK_READ_ONLY),
    ai: !falsy(env.KUBEDECK_AI),
    podFiles: !falsy(env.KUBEDECK_POD_FILES),
    hosts: Array.from(new Set(hosts)),
    proxySecret: env.KUBEDECK_PROXY_SECRET ?? "",
    trustProxyNetwork: truthy(env.KUBEDECK_TRUST_PROXY_NETWORK),
    allowedGroups: list(env.KUBEDECK_ALLOWED_GROUPS),
    authNone: auth === "none",
    builtin,
    // builtin login acts as each user unless the operator explicitly chose the shared service account
    impersonate: access === "impersonate" || (builtin && access !== "shared"),
    impersonateUser: (env.KUBEDECK_IMPERSONATE_USER ?? "").trim().toLowerCase() === "name" ? "name" : "email",
    impersonatePrefix: prefix(env.KUBEDECK_IMPERSONATE_PREFIX),
    impersonateGroupPrefix: prefix(env.KUBEDECK_IMPERSONATE_GROUP_PREFIX),
  };
}

/** What each way of signing people in needs. */
function authProblems(c: WebConfig): string[] {
  if (c.authNone) {
    // nothing signs anyone in, so there are no groups to check and no one to act as
    return [
      ...(c.allowedGroups.length > 0 ? ["KUBEDECK_ALLOWED_GROUPS needs a login proxy: remove it, or remove KUBEDECK_AUTH=none."] : []),
      ...(c.impersonate ? ["KUBEDECK_ACCESS=impersonate needs a login proxy to say who the user is: remove it, or remove KUBEDECK_AUTH=none."] : []),
    ];
  }
  if (c.builtin) {
    // the login is KubeDeck's own; KUBEDECK_AUTH_SECRET and the first admin are checked by server/auth
    return [
      ...(c.proxySecret || c.trustProxyNetwork ? ["KUBEDECK_AUTH=builtin signs people in itself: remove KUBEDECK_PROXY_SECRET / KUBEDECK_TRUST_PROXY_NETWORK."] : []),
      ...(c.impersonate && !c.impersonateGroupPrefix
        ? ["KUBEDECK_AUTH=builtin needs a group prefix (default \"kubedeck:\") so a KubeDeck group cannot be a built-in Kubernetes group: unset KUBEDECK_IMPERSONATE_GROUP_PREFIX or give it a value."]
        : []),
    ];
  }
  if (c.proxySecret || c.trustProxyNetwork) return c.proxySecret && c.proxySecret.length < 16 ? ["KUBEDECK_PROXY_SECRET must be at least 16 characters."] : [];
  return [
    "Web mode needs a way to know requests came through your login proxy: set KUBEDECK_PROXY_SECRET " +
      "(and have the proxy send it as X-KubeDeck-Proxy-Secret), or set KUBEDECK_TRUST_PROXY_NETWORK=1 if a " +
      "NetworkPolicy lets only the proxy reach this server.",
  ];
}

/** Problems that must stop the server from starting: a web server with no way to authenticate is open to everyone. */
export function validateWebConfig(c: WebConfig): string[] {
  if (!c.enabled) return [];
  const problems = authProblems(c);
  if (c.hosts.length === 0) problems.push("Set KUBEDECK_PUBLIC_URL (e.g. https://kubedeck.example.com) so requests for other hostnames are refused.");
  return problems;
}

let active: WebConfig = loadWebConfig();
export const webConfig = (): WebConfig => active;
export const isWebMode = (): boolean => active.enabled;
/** for tests */
export function setWebConfig(c: WebConfig) { active = c; }

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The signed-in user as the proxy reported it, or null when the request carries no identity. */
export function userFromHeaders(headers: IncomingMessage["headers"]): WebUser | null {
  const name = first(headers["x-forwarded-preferred-username"]) || first(headers["x-forwarded-user"]) || first(headers["x-auth-request-user"]);
  const email = first(headers["x-forwarded-email"]) || first(headers["x-auth-request-email"]);
  const groups = list(first(headers["x-forwarded-groups"]) || first(headers["x-auth-request-groups"])).map((g) => g.replace(/^role:/, ""));
  if (!name && !email) return null;
  return { name: name || email, email, groups };
}

export type GateResult =
  | { ok: true; user: WebUser }
  | { ok: false; status: 401 | 403; message: string };

/** Pure decision, so it can be tested without a server. */
export function checkRequest(headers: IncomingMessage["headers"], c: WebConfig = active): GateResult {
  // no login proxy: headers could be typed by anyone, so they name nobody
  if (c.authNone) return { ok: true, user: ANONYMOUS };
  // A configured secret is always required; without one, the operator vouched for the network instead.
  const viaProxy = c.proxySecret ? secretMatches(first(headers["x-kubedeck-proxy-secret"]), c.proxySecret) : c.trustProxyNetwork;
  if (!viaProxy) {
    return { ok: false, status: 403, message: "Forbidden: requests must come through the KubeDeck login proxy." };
  }
  const user = userFromHeaders(headers);
  if (!user) return { ok: false, status: 401, message: "Sign in required." };
  if (c.allowedGroups.length > 0 && !user.groups.some((g) => c.allowedGroups.includes(g))) {
    return { ok: false, status: 403, message: "Your account is not in a group that may use KubeDeck." };
  }
  return { ok: true, user };
}

declare module "http" {
  interface IncomingMessage { kubedeckUser?: WebUser }
}

/** Probe path for the pod spec's liveness / readiness checks: no data, no identity, no host check. */
export const HEALTH_PATH = "/healthz";

/** Builtin login: who a request's session cookie belongs to (set by server/auth once it has started). */
let sessionUser: ((req: Request) => Promise<WebUser | null>) | null = null;
export function setSessionResolver(fn: typeof sessionUser) { sessionUser = fn; }

/**
 * Builtin login: the app's own files and the sign-in routes load without a session (the browser has to
 * show a sign-in page); /api/mode answers either way so the browser knows to. Everything else needs one.
 */
export function needsSession(path: string): boolean {
  if (!path.startsWith("/api/")) return false;
  return !path.startsWith("/api/auth/") && path !== "/api/mode";
}

function builtinGate(req: Request, res: Response, next: NextFunction): void {
  // Better Auth checks its own routes; files of the app carry no data
  if (!req.path.startsWith("/api/") || req.path.startsWith("/api/auth/")) return next();
  if (!sessionUser) {
    res.status(503).json({ message: "KubeDeck is still starting. Try again in a moment." });
    return;
  }
  sessionUser(req).then((user) => {
    if (user) {
      if (active.allowedGroups.length > 0 && !user.groups.some((g) => active.allowedGroups.includes(g)) && needsSession(req.path)) {
        res.status(403).json({ message: "Your account is not in a group that may use KubeDeck." });
        return;
      }
      req.kubedeckUser = user;
      return next();
    }
    if (!needsSession(req.path)) return next();
    res.status(401).json({ message: "Sign in required." });
  }, next);
}

export function webGate(req: Request, res: Response, next: NextFunction): void {
  if (!active.enabled || req.path === HEALTH_PATH) return next();
  if (active.builtin) return builtinGate(req, res, next);
  const r = checkRequest(req.headers);
  if (!r.ok) {
    res.status(r.status).json({ message: r.message });
    return;
  }
  req.kubedeckUser = r.user;
  next();
}

/** Features a shared KubeDeck may have turned off, with the reason the browser shows. */
const WEB_OFF: { match: RegExp; writesOnly: boolean; off: (c: WebConfig) => boolean; message: string }[] = [
  { match: /^\/api\/ai(\/|$)/, writesOnly: false, off: (c) => !c.ai, message: "The AI assistant is turned off on this KubeDeck." },
  { match: /^\/api\/k8s\/pods\/[^/]+\/files(\/|$)/, writesOnly: false, off: (c) => !c.podFiles, message: "Browsing pod files is turned off on this KubeDeck." },
  // the port would open inside the server, not on the user's machine. Listing stays a plain (empty) read.
  { match: /^\/api\/k8s\/(pods\/[^/]+\/port-forward|port-forwards)(\/|$)/, writesOnly: true, off: () => true, message: "Port forwarding is not available on a shared KubeDeck: the port would open on the server, not on your machine." },
];

/** Web mode: refuse a feature that is off with its own reason, read-only or not. */
export function webFeatureOff(req: Request, res: Response, next: NextFunction): void {
  if (!active.enabled) return next();
  const full = req.baseUrl + req.path;
  const off = WEB_OFF.find((f) => f.off(active) && f.match.test(full) && (!f.writesOnly || MUTATING.has(req.method)));
  if (!off) return next();
  res.status(403).json({ message: off.message });
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/**
 * Read-only web mode: refuse every write except the kubectl palette and the assistant, which judge
 * their own commands (both refuse anything but reads when read-only: see webAgentRefusal).
 */
export function webReadOnly(req: Request, res: Response, next: NextFunction): void {
  if (!active.enabled || !active.readOnly || !MUTATING.has(req.method)) return next();
  // mounted under "/api", so req.path is relative to that mount; compare the full path
  const full = req.baseUrl + req.path;
  if (full === "/api/kubectl/exec" || /^\/api\/ai\//.test(full)) return next();
  res.status(403).json({ message: "This KubeDeck is read-only. Scaling, restarting, editing and deleting are turned off here." });
}

export interface AuditRecord {
  at: string;
  userEmail: string;
  userName: string;
  groups: string;
  method: string;
  path: string;
  status: number;
  context: string;
  namespace: string;
  /** the kubectl command, for palette and assistant runs */
  detail: string;
  ip: string;
}

/** Where audit records are kept besides stdout (the database, when KubeDeck has one). */
let auditSink: ((e: AuditRecord) => Promise<void>) | null = null;
export function setAuditSink(fn: typeof auditSink) { auditSink = fn; }

const field = (v: unknown): string => (typeof v === "string" ? v : "");

/** The audit record of a finished write. Sign-in routes are not writes to a cluster, so they are left out. */
export function auditRecord(req: Request, status: number, at = new Date()): AuditRecord {
  const user = req.kubedeckUser;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (req.body ?? {}) as Record<string, any>;
  return {
    at: at.toISOString(),
    userEmail: user?.email ?? "",
    userName: user?.name ?? "",
    groups: (user?.groups ?? []).join(","),
    method: req.method,
    path: req.path,
    status,
    context: field(req.query.context) || field(body.context),
    namespace: field(req.query.namespace) || field(body.namespace),
    detail: field(body.command).slice(0, 1000),
    ip: req.ip || req.socket.remoteAddress || "",
  };
}

/** One record per write (including palette commands), naming the user: stdout for the cluster's log pipeline, and the database. */
export function auditLog(req: Request, res: Response, next: NextFunction): void {
  if (!active.enabled) return next();
  const audited = MUTATING.has(req.method) && req.path.startsWith("/api") && !req.path.startsWith("/api/auth/");
  if (!audited) return next();
  res.on("finish", () => {
    const r = auditRecord(req, res.statusCode);
    console.log(JSON.stringify({
      audit: true, at: r.at, user: r.userEmail || r.userName || "unknown",
      // with no login, the caller's address is the only trace of who it was
      ...(active.authNone ? { ip: r.ip } : {}),
      method: r.method, path: r.path, status: r.status,
    }));
    auditSink?.(r).catch((err) => console.error(`[kubedeck] could not store an audit record: ${err instanceof Error ? err.message : err}`));
  });
  next();
}

/** Kubectl flags that would let a signed-in user step outside the server's own identity. */
const FORBIDDEN_FLAG = /(^|\s)--?(kubeconfig|token|server|s|as|as-group|as-uid|client-certificate|client-key|certificate-authority|insecure-skip-tls-verify|username|password)(=|\s|$)/i;

/** Verbs that would hand a user the server's credentials or a shell under its identity. */
const SERVER_ONLY_VERBS = new Set(["config", "auth", "exec", "cp", "port-forward", "proxy", "attach", "debug"]);

/** What the kubectl palette may run in web mode: no config dump, no shell in a pod, no identity flags. */
export function webExecAllowed(raw: string): { ok: true } | { ok: false; message: string } {
  const trimmed = raw.trim().replace(/^kubectl\s+/, "");
  if (FORBIDDEN_FLAG.test(` ${trimmed}`)) {
    return { ok: false, message: "That flag is not allowed on a shared KubeDeck." };
  }
  // the verb is the first word that is neither a flag nor a flag's value (`-n web exec …` → exec)
  const words = trimmed.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();
    if (w.startsWith("-")) {
      if (!w.includes("=") && /^(-n|--namespace|--context|-l|--selector|-o|--output|-c|--container|--cluster|--user|--request-timeout|-v)$/.test(w)) i++;
      continue;
    }
    if (SERVER_ONLY_VERBS.has(w)) return { ok: false, message: `kubectl ${w} is not available on a shared KubeDeck.` };
    break;
  }
  return { ok: true };
}

/**
 * Web mode: why the assistant may not run this command line, or null. The same limits as the palette,
 * applied to every kubectl in a pipeline, plus read-only. `line` is a kubectl tool command (with or
 * without the leading `kubectl`) or a bash tool pipeline; `level` is its safety classification.
 */
export function webAgentRefusal(line: string, tool: "kubectl" | "bash", level: SafetyLevel): string | null {
  if (!active.enabled) return null;
  const invocations = tool === "kubectl"
    ? [line]
    : scanShell(line.trim()).segments.flatMap((seg) => {
      const m = seg.match(/(?:^|[\s/])kubectl\s+([\s\S]*)$/);
      return m ? [m[1]] : [];
    });
  for (const args of invocations) {
    const r = webExecAllowed(args);
    if (!r.ok) return `Blocked: ${r.message}`;
  }
  if (active.readOnly && level !== "allow") return "Blocked: this KubeDeck is read-only, so the assistant can only read from the cluster.";
  return null;
}

/** Public description of the running mode, for the browser (never includes secrets). */
export function describeMode(req: Request) {
  const c = active;
  if (!c.enabled) return { mode: "desktop" as const, readOnly: false, features: { portForward: true, settingsEdit: true, ai: true, podFiles: true } };
  return {
    mode: "web" as const,
    readOnly: c.readOnly,
    auth: c.authNone ? ("none" as const) : c.builtin ? ("builtin" as const) : ("proxy" as const),
    // whose permissions apply: each user's own (impersonation) or KubeDeck's service account
    access: c.impersonate ? ("user" as const) : ("shared" as const),
    user: !c.authNone && req.kubedeckUser
      ? { name: req.kubedeckUser.name, email: req.kubedeckUser.email, groups: req.kubedeckUser.groups, role: req.kubedeckUser.role ?? "user" }
      : null,
    // settings come from the server's environment; a forwarded port would open on the server
    features: { portForward: false, settingsEdit: false, ai: c.ai, podFiles: c.podFiles, admin: c.builtin && req.kubedeckUser?.role === "admin" },
  };
}
