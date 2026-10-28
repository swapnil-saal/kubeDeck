/**
 * Web (server) mode: KubeDeck run as a shared service behind an authenticating reverse proxy
 * (oauth2-proxy + Keycloak, or any proxy that sets identity headers), instead of as a desktop app.
 *
 * The desktop build trusts "whoever is at this machine". A shared host cannot, so web mode adds:
 *  - an identity gate: every request must come through the proxy (shared secret, or an explicit
 *    "the network only lets the proxy reach me" declaration) and carry a user;
 *  - an optional group allow-list;
 *  - read-only by default: no scale / restart / apply / delete / exec-style mutation;
 *  - no shell, no port-forward, no editing of kubeconfig paths or AI keys from the browser;
 *  - an audit line for every non-GET request and every AI call, with the user's name.
 *
 * Turn it on with KUBEDECK_MODE=web. See docs/WEB.md.
 */
import { timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import type { IncomingMessage } from "http";

export interface WebConfig {
  enabled: boolean;
  /** forbid every mutating action (default true) */
  readOnly: boolean;
  /** public hostname(s) users reach the app on, e.g. e2-k8s.saal.ai */
  hosts: string[];
  /** value the proxy must send in `X-KubeDeck-Proxy-Secret` */
  proxySecret: string;
  /** the network guarantees only the proxy can reach this server (NetworkPolicy), so headers are trusted as-is */
  trustProxyNetwork: boolean;
  /** if set, the user must belong to at least one of these groups */
  allowedGroups: string[];
}

export interface WebUser {
  name: string;
  email: string;
  groups: string[];
}

const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? "").trim());
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const hosts = list(env.KUBEDECK_PUBLIC_HOSTS ?? env.KUBEDECK_ALLOWED_HOSTS).map((h) => h.toLowerCase());
  if (env.KUBEDECK_PUBLIC_URL) {
    try { hosts.push(new URL(env.KUBEDECK_PUBLIC_URL).hostname.toLowerCase()); } catch { /* reported by validateWebConfig */ }
  }
  return {
    enabled: (env.KUBEDECK_MODE ?? "").toLowerCase() === "web",
    readOnly: env.KUBEDECK_READ_ONLY === undefined ? true : truthy(env.KUBEDECK_READ_ONLY),
    hosts: Array.from(new Set(hosts)),
    proxySecret: env.KUBEDECK_PROXY_SECRET ?? "",
    trustProxyNetwork: truthy(env.KUBEDECK_TRUST_PROXY_NETWORK),
    allowedGroups: list(env.KUBEDECK_ALLOWED_GROUPS),
  };
}

/** Problems that must stop the server from starting: a web server with no way to authenticate is open to everyone. */
export function validateWebConfig(c: WebConfig): string[] {
  if (!c.enabled) return [];
  const problems: string[] = [];
  if (!c.proxySecret && !c.trustProxyNetwork) {
    problems.push(
      "Web mode needs a way to know requests came through your login proxy: set KUBEDECK_PROXY_SECRET " +
        "(and have the proxy send it as X-KubeDeck-Proxy-Secret), or set KUBEDECK_TRUST_PROXY_NETWORK=1 if a " +
        "NetworkPolicy lets only the proxy reach this server.",
    );
  }
  if (c.proxySecret && c.proxySecret.length < 16) problems.push("KUBEDECK_PROXY_SECRET must be at least 16 characters.");
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

export function webGate(req: Request, res: Response, next: NextFunction): void {
  if (!active.enabled || req.path === HEALTH_PATH) return next();
  const r = checkRequest(req.headers);
  if (!r.ok) {
    res.status(r.status).json({ message: r.message });
    return;
  }
  req.kubedeckUser = r.user;
  next();
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** AI calls are POSTs but read-only; the agent's own tools enforce read-only separately. */
const READ_ONLY_POST_PREFIXES = ["/api/ai/"];

/** Read-only web mode: refuse every write except the AI endpoints (and the kubectl palette, which classifies its own verbs). */
export function webReadOnly(req: Request, res: Response, next: NextFunction): void {
  if (!active.enabled || !active.readOnly || !MUTATING.has(req.method)) return next();
  // mounted under "/api", so req.path is relative to that mount; compare the full path
  const full = req.baseUrl + req.path;
  if (READ_ONLY_POST_PREFIXES.some((p) => full.startsWith(p)) || full === "/api/kubectl/exec") return next();
  res.status(403).json({ message: "This KubeDeck is read-only. Scaling, restarting, editing and deleting are turned off here." });
}

/** One line per write or AI call, naming the user. Goes to stdout so the cluster's log pipeline keeps it. */
export function auditLog(req: Request, res: Response, next: NextFunction): void {
  if (!active.enabled) return next();
  const audited = MUTATING.has(req.method) && req.path.startsWith("/api");
  if (!audited) return next();
  const user = req.kubedeckUser;
  res.on("finish", () => {
    console.log(JSON.stringify({
      audit: true, at: new Date().toISOString(), user: user?.email || user?.name || "unknown",
      method: req.method, path: req.path, status: res.statusCode,
    }));
  });
  next();
}

/** Kubectl flags that would let a signed-in user step outside the server's own identity. */
const FORBIDDEN_FLAG = /(^|\s)--?(kubeconfig|token|server|s|as|as-group|as-uid|client-certificate|client-key|certificate-authority|insecure-skip-tls-verify|username|password)(=|\s|$)/i;

/** What the kubectl palette may run in web mode: read-only verbs, no config dump, no identity flags. */
export function webExecAllowed(raw: string): { ok: true } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (FORBIDDEN_FLAG.test(` ${trimmed}`)) {
    return { ok: false, message: "That flag is not allowed on a shared KubeDeck." };
  }
  const verb = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (verb === "config" || verb === "auth" || verb === "exec" || verb === "cp" || verb === "port-forward" || verb === "proxy" || verb === "attach") {
    return { ok: false, message: `kubectl ${verb} is not available on a shared KubeDeck.` };
  }
  return { ok: true };
}

/** AI provider from the environment (web mode never lets browsers write or read the key). */
export function webAiFromEnv(env: NodeJS.ProcessEnv = process.env) {
  if (!active.enabled || !env.KUBEDECK_AI_API_KEY) return undefined;
  const provider = (["openai", "anthropic", "ollama", "custom"].includes(env.KUBEDECK_AI_PROVIDER ?? "")
    ? env.KUBEDECK_AI_PROVIDER
    : "openai") as "openai" | "anthropic" | "ollama" | "custom";
  return {
    provider,
    apiKey: env.KUBEDECK_AI_API_KEY,
    model: env.KUBEDECK_AI_MODEL || "gpt-4o-mini",
    fastModel: env.KUBEDECK_AI_FAST_MODEL || undefined,
    baseUrl: env.KUBEDECK_AI_BASE_URL || "",
  };
}

/** Public description of the running mode, for the browser (never includes secrets). */
export function describeMode(req: Request) {
  const c = active;
  if (!c.enabled) return { mode: "desktop" as const, readOnly: false, features: { terminal: true, portForward: true, settingsEdit: true } };
  return {
    mode: "web" as const,
    readOnly: c.readOnly,
    user: req.kubedeckUser ? { name: req.kubedeckUser.name, email: req.kubedeckUser.email } : null,
    features: { terminal: false, portForward: false, settingsEdit: false },
  };
}
