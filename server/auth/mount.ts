/**
 * Where Better Auth's own routes (sign in, sign out, session) are served. Mounted before the body
 * parsers, which would consume what Better Auth reads. Its admin routes are never reachable from
 * outside: admins use KubeDeck's /api/admin routes, which validate what they store.
 */
import type { Express } from "express";
import { CLIENT_IP_HEADER, type KubeDeckAuth } from "./index";

export function mountAuthRoutes(app: Express, current: () => KubeDeckAuth | null): void {
  app.all("/api/auth/*splat", (req, res) => {
    if (req.path.startsWith("/api/auth/admin/")) return void res.status(404).json({ message: "Not found" });
    // always overwritten, so a browser cannot pick its own address to dodge the sign-in rate limit;
    // req.ip is the connection's address, or the client behind KUBEDECK_PROXY_HOPS trusted proxies
    req.headers[CLIENT_IP_HEADER] = req.ip || req.socket.remoteAddress || "unknown";
    const auth = current();
    if (!auth) return void res.status(503).json({ message: "KubeDeck is still starting. Try again in a moment." });
    void auth.handle(req, res);
  });
}
