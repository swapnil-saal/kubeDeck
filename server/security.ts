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
