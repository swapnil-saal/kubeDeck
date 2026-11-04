/**
 * Web (server) mode: KubeDeck run as a shared service behind an authenticating reverse proxy
 * (oauth2-proxy + Keycloak, or any proxy that sets identity headers), instead of as a desktop app.
 *
 * Web mode offers the desktop app's features. A shared host cannot trust "whoever is at this
 * machine", so it adds:
 *  - an identity gate: every request must come through the proxy (shared secret, or an explicit
 *    "the network only lets the proxy reach me" declaration) and carry a user;
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

/** One line per write (including palette commands), naming the user. Goes to stdout so the cluster's log pipeline keeps it. */
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
    user: req.kubedeckUser ? { name: req.kubedeckUser.name, email: req.kubedeckUser.email } : null,
    // settings come from the server's environment; a forwarded port would open on the server
    features: { portForward: false, settingsEdit: false, ai: c.ai, podFiles: c.podFiles },
  };
}
