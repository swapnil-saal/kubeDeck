/**
 * Web (server) mode: KubeDeck run as a shared service for a team, instead of as a desktop app.
 *
 * Web mode offers the desktop app's features. A shared host cannot trust "whoever is at this
 * machine", so it adds:
 *  - KubeDeck's own sign-in (server/auth): accounts and groups an admin manages; every kubectl call
 *    runs as the signed-in person (`--as=kubedeck:<email> --as-group=kubedeck:<group>`), so the
 *    cluster's RBAC decides what they can see and change;
 *  - an optional group allow-list;
 *  - switches to turn writes, the AI assistant and pod files off (KUBEDECK_READ_ONLY,
 *    KUBEDECK_AI, KUBEDECK_POD_FILES); all are on unless turned off;
 *  - limits that keep users inside their own identity: no kubectl config / auth / exec /
 *    cp / proxy / attach / debug and no identity flags, from the palette or the assistant; the
 *    assistant's pipelines run without a shell;
 *  - settings (kubeconfig, AI provider) come from the environment, never from the browser;
 *  - no port-forward: the port would open inside the server, out of the user's reach;
 *  - an audit record for every change, with the user and their groups.
 *
 * Turn it on with KUBEDECK_MODE=web. See docs/WEB.md.
 *
 * The desktop app is the same server with one local user who is never asked to sign in (localUser);
 * its writes are audited too, and kubectl runs with the person's own kubeconfig.
 */
import os from "os";
import type { NextFunction, Request, Response } from "express";
import { ALL_PERMISSIONS, APP_PERMISSIONS, NO_PERMISSIONS, type AppPermission, type AppPermissions } from "@shared/groups";
import { emit, type ActionDone } from "./events";
import { currentPerson } from "./identity";
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
  /** if set, the user must belong to at least one of these groups */
  allowedGroups: string[];
}

/** Settings from before clusters and groups were set up in KubeDeck; now ignored, and said so at start. */
export const RETIRED_SETTINGS = ["KUBEDECK_ACCESS", "KUBEDECK_IMPERSONATE_PREFIX", "KUBEDECK_IMPERSONATE_GROUP_PREFIX"];

export interface WebUser {
  name: string;
  email: string;
  groups: string[];
  /** the account id and whether it may manage users */
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
  return {
    enabled: (env.KUBEDECK_MODE ?? "").toLowerCase() === "web",
    readOnly: truthy(env.KUBEDECK_READ_ONLY),
    ai: !falsy(env.KUBEDECK_AI),
    podFiles: !falsy(env.KUBEDECK_POD_FILES),
    hosts: Array.from(new Set(hosts)),
    allowedGroups: list(env.KUBEDECK_ALLOWED_GROUPS),
  };
}

/** Problems that must stop the server from starting: a web server that cannot sign people in safely is open to everyone. */
export function validateWebConfig(c: WebConfig): string[] {
  if (!c.enabled) return [];
  const problems: string[] = [];
  if (c.hosts.length === 0) problems.push("Set KUBEDECK_PUBLIC_URL (e.g. https://kubedeck.example.com) so requests for other hostnames are refused.");
  return problems;
}

let active: WebConfig = loadWebConfig();
export const webConfig = (): WebConfig => active;
export const isWebMode = (): boolean => active.enabled;
/** for tests */
export function setWebConfig(c: WebConfig) { active = c; }

declare module "http" {
  interface IncomingMessage { kubedeckUser?: WebUser }
}

/** Probe path for the pod spec's liveness / readiness checks: no data, no identity, no host check. */
export const HEALTH_PATH = "/healthz";

/** Who a request's session cookie belongs to (set by server/auth once it has started). */
let sessionUser: ((req: Request) => Promise<WebUser | null>) | null = null;
export function setSessionResolver(fn: typeof sessionUser) { sessionUser = fn; }

/**
 * The app's own files and the sign-in routes load without a session (the browser has to show a
 * sign-in page); /api/mode answers either way so the browser knows to. Everything else needs one.
 */
export function needsSession(path: string): boolean {
  if (!path.startsWith("/api/")) return false;
  return !path.startsWith("/api/auth/") && path !== "/api/mode";
}

const inAllowedGroup = (user: WebUser) => active.allowedGroups.length === 0 || user.groups.some((g) => active.allowedGroups.includes(g));

let local: WebUser | null = null;
/**
 * The desktop app's one user: whoever is logged in to this computer, never asked to sign in, and an
 * admin of their own KubeDeck (they read its audit log). No impersonation: kubectl uses their kubeconfig.
 */
export function localUser(): WebUser {
  local ??= { name: computerUserName(), email: "", groups: [], role: "admin" };
  return local;
}

function computerUserName(): string {
  try {
    return os.userInfo().username;
  } catch (err) {
    // a uid with no passwd entry (some containers)
    const fallback = process.env.USER || process.env.USERNAME || "local";
    console.warn(`[kubedeck] could not read this computer's user name (${err instanceof Error ? err.message : err}); using "${fallback}"`);
    return fallback;
  }
}

/** Who is asking: the desktop's local user, or (web mode) the session's user, refusing the API without one. */
export function webGate(req: Request, res: Response, next: NextFunction): void {
  if (!active.enabled) {
    req.kubedeckUser = localUser();
    return next();
  }
  if (req.path === HEALTH_PATH) return next();
  // Better Auth checks its own routes; files of the app carry no data
  if (!req.path.startsWith("/api/") || req.path.startsWith("/api/auth/")) return next();
  if (!sessionUser) {
    res.status(503).json({ message: "KubeDeck is still starting. Try again in a moment." });
    return;
  }
  sessionUser(req).then((user) => {
    if (user && !inAllowedGroup(user) && needsSession(req.path)) {
      res.status(403).json({ message: "Your account is not in a group that may use KubeDeck." });
      return;
    }
    if (user) req.kubedeckUser = user;
    if (user || !needsSession(req.path)) return next();
    res.status(401).json({ message: "Sign in required." });
  }, next);
}

/** Web mode: how to find what a person's groups let them use in KubeDeck (set at startup by server/index.ts). */
let permissionsOfPerson: ((memberOf: string[]) => AppPermissions) | null = null;
export function setPermissionResolver(fn: typeof permissionsOfPerson): void {
  permissionsOfPerson = fn;
}

/**
 * What `user` may use in KubeDeck itself: everything on the desktop and for an admin; otherwise what
 * any of their groups allows (nothing for someone in no group).
 */
export function permissionsFor(user: WebUser | undefined): AppPermissions {
  if (!active.enabled || user?.role === "admin" || !permissionsOfPerson) return { ...ALL_PERMISSIONS };
  return user ? permissionsOfPerson(user.groups) : { ...NO_PERMISSIONS };
}

/** Whether the person of the current request may use `feature` (always outside web mode). */
export const personMay = (feature: AppPermission): boolean => permissionsFor(currentPerson())[feature];

const label = (f: AppPermission) => APP_PERMISSIONS.find((p) => p.key === f)?.label ?? f;
const notAllowed = (f: AppPermission) => `Your KubeDeck groups do not include ${label(f)}. Ask a KubeDeck admin.`;

/** Requests that need a KubeDeck permission (Settings → Groups), with the permission. */
const NEEDS: { match: RegExp; writesOnly: boolean; feature: AppPermission }[] = [
  { match: /^\/api\/ai(\/|$)/, writesOnly: false, feature: "assistant" },
  { match: /^\/api\/kubectl\/exec$/, writesOnly: false, feature: "palette" },
  { match: /^\/api\/k8s\/pods\/[^/]+\/files(\/|$)/, writesOnly: false, feature: "podFiles" },
  { match: /^\/api\/projects(\/|$)/, writesOnly: true, feature: "projects" },
];

/** Web mode: refuse a request the person's groups do not allow. Runs after the session is known. */
export function webPermissionGate(req: Request, res: Response, next: NextFunction): void {
  if (!active.enabled) return next();
  const full = req.baseUrl + req.path;
  const need = NEEDS.find((n) => n.match.test(full) && (!n.writesOnly || MUTATING.has(req.method)));
  if (!need || permissionsFor(req.kubedeckUser)[need.feature]) return next();
  res.status(403).json({ message: notAllowed(need.feature) });
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
 * Read-only web mode: refuse every write to a cluster. Let through the kubectl palette and the
 * assistant, which judge their own commands (both refuse anything but reads when read-only: see
 * webAgentRefusal), and KubeDeck's own records (users, groups, plugins, projects), which touch no cluster.
 */
export function webReadOnly(req: Request, res: Response, next: NextFunction): void {
  if (!active.enabled || !active.readOnly || !MUTATING.has(req.method)) return next();
  // mounted under "/api", so req.path is relative to that mount; compare the full path
  const full = req.baseUrl + req.path;
  const ownRecords = /^\/api\/(ai|admin|groups|plugins|projects)\//.test(full) || /^\/api\/(groups|plugins|projects)$/.test(full);
  if (full === "/api/kubectl/exec" || ownRecords) return next();
  res.status(403).json({ message: "This KubeDeck is read-only. Scaling, restarting, editing and deleting are turned off here." });
}

export type AuditRecord = ActionDone;

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

/**
 * One `action.done` event per write (including palette commands), naming the user; the audit module
 * stores it. Web mode also prints it to stdout for the cluster's log pipeline.
 */
export function auditLog(req: Request, res: Response, next: NextFunction): void {
  const audited = MUTATING.has(req.method) && req.path.startsWith("/api") && !req.path.startsWith("/api/auth/");
  if (!audited) return next();
  // by the time the response finishes, a router mounted on "/api" may have cut req.path short
  const path = req.path;
  res.on("finish", () => {
    const r = { ...auditRecord(req, res.statusCode), path };
    if (active.enabled) {
      console.log(JSON.stringify({
        audit: true, at: r.at, user: r.userEmail || r.userName || "unknown", ip: r.ip,
        method: r.method, path: r.path, status: r.status,
      }));
    }
    emit("action.done", r);
  });
  next();
}

/** Kubectl flags that would let a signed-in user step outside the server's own identity. */
const FORBIDDEN_FLAG = /(^|\s)--?(kubeconfig|token|server|s|as|as-group|as-uid|client-certificate|client-key|certificate-authority|insecure-skip-tls-verify|username|password|user|cluster)(=|\s|$)/i;

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
      if (!w.includes("=") && /^(-n|--namespace|--context|-l|--selector|-o|--output|-c|--container|--request-timeout|-v)$/.test(w)) i++;
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
  if (level !== "allow" && !personMay("assistantChanges")) return "Blocked: your KubeDeck groups let the assistant read only.";
  return null;
}

const publicUser = (u: WebUser | undefined) => (u ? { name: u.name, email: u.email, groups: u.groups, role: u.role ?? "user" } : null);

/**
 * Public description of the running mode, for the browser (never includes secrets). `audit`: whether
 * this KubeDeck keeps an audit log (a desktop whose database could not open does not).
 * Features: `users` = may manage accounts (web admins), `audit` = may read the audit log (admins).
 */
export function describeMode(req: Request, o: { audit: boolean } = { audit: true }) {
  const c = active;
  const user = publicUser(req.kubedeckUser);
  const admin = user?.role === "admin";
  const may = permissionsFor(req.kubedeckUser);
  if (!c.enabled) {
    return {
      mode: "desktop" as const,
      readOnly: false,
      user,
      features: { portForward: true, settingsEdit: true, ai: true, podFiles: true, users: false, audit: admin && o.audit, palette: true, projects: true },
    };
  }
  return {
    mode: "web" as const,
    readOnly: c.readOnly,
    auth: "builtin" as const,
    user,
    // settings come from the server's environment; a forwarded port would open on the server
    // what this person may use: the server's switches AND their groups' KubeDeck permissions
    features: {
      portForward: false, settingsEdit: false, ai: c.ai && may.assistant, podFiles: c.podFiles && may.podFiles,
      users: admin, audit: admin && o.audit, palette: may.palette, projects: may.projects,
    },
  };
}
