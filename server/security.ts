import type { IncomingMessage } from "http";
import type { NextFunction, Request, Response } from "express";

/**
 * KubeDeck runs a local server that can execute kubectl and open a shell, so it must
 * only ever answer the app's own pages. Two attacks matter on localhost:
 *  - cross-site requests / WebSockets from any web page the user visits (browsers do
 *    not apply same-origin rules to WebSockets) — blocked by checking `Origin`;
 *  - DNS rebinding, where an attacker's hostname resolves to 127.0.0.1 — blocked by
 *    checking `Host`.
 * Extra hostnames (e.g. a dev tunnel) can be allowed with KUBEDECK_ALLOWED_HOSTS=a.example,b.example
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  return h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
}

function extraAllowedHosts(): Set<string> {
  return new Set(
    (process.env.KUBEDECK_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isTrustedRequest(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host) return false;
  const name = hostnameOf(host);
  if (!LOOPBACK.has(name) && !extraAllowedHosts().has(name)) return false;

  // Browsers label every request with where it came from. A cross-site <img>/<script>/navigation
  // carries no Origin on GET, but is still "cross-site" here. "none" = the user typed the URL.
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string" && site !== "same-origin" && site !== "none") return false;

  // Browsers always send Origin on WebSocket upgrades and cross-origin fetches.
  // Same-origin page loads from the app itself send an Origin equal to Host (or none).
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== host.toLowerCase()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function requireTrustedRequest(req: Request, res: Response, next: NextFunction): void {
  if (isTrustedRequest(req)) return next();
  res.status(403).json({ message: "Forbidden: KubeDeck only accepts requests from its own window." });
}

// ── kubectl-bound parameters ────────────────────────────────────────────────
// Route handlers paste these straight into a kubectl command line, and some paths run it through
// `sh -c`. Only characters that can appear in real Kubernetes names are accepted, and a value may
// not start with "-" (it would be read as a kubectl flag).

const NAME = /^(?!-)[\w.:@/+=-]{1,253}$/;

export const K8S_PARAM_RULES: Record<string, RegExp> = {
  context: NAME,
  namespace: /^(all|(?!-)[a-z0-9.-]{1,253})$/,
  name: /^(?!-)[\w.:-]{1,253}$/,
  type: /^(?!-)[a-zA-Z][\w.-]{0,62}$/,
  container: /^(?!-)[\w.-]{1,63}$/,
  tail: /^\d{1,5}$/,
  warningsOnly: /^(true|false)$/,
  maxAgeMinutes: /^\d{1,5}$/,
  id: /^[\w-]{1,64}$/,
  // log streaming
  kind: /^(pod|deployment|statefulset|daemonset|replicaset|job|service)$/,
  since: /^\d{1,4}[smhd]$/,
  pods: /^[\w.:-]{1,253}(,[\w.:-]{1,253}){0,49}$/,
  previous: /^(0|1|true|false)$/,
  follow: /^(0|1|true|false)$/,
};

/** Returns the first invalid key, or null when every present value is acceptable. */
export function findInvalidParam(values: Record<string, unknown>): string | null {
  for (const [key, rule] of Object.entries(K8S_PARAM_RULES)) {
    const v = values[key];
    if (v === undefined || v === "") continue;
    if (typeof v !== "string" || !rule.test(v)) return key;
  }
  return null;
}

/** Rejects a request whose query string holds a value that is not a plausible Kubernetes name. */
export function validateK8sQuery(req: Request, res: Response, next: NextFunction): void {
  const bad = findInvalidParam(req.query as Record<string, unknown>);
  if (bad) {
    res.status(400).json({ message: `Invalid "${bad}" parameter.` });
    return;
  }
  next();
}

/** Same check for `:name`, `:type` and `:id` route parameters. */
export function registerParamValidators(app: { param: (name: string, fn: (req: Request, res: Response, next: NextFunction, value: string) => void) => unknown }): void {
  for (const key of ["name", "type", "id"]) {
    app.param(key, (_req, res, next, value) => {
      if (findInvalidParam({ [key]: value })) {
        res.status(400).json({ message: `Invalid "${key}" parameter.` });
        return;
      }
      next();
    });
  }
}
