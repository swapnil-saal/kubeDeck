/**
 * Reading the audit log, for KubeDeck admins: web-mode admins, and the desktop's local user.
 */
import type { Express } from "express";
import { adminPaths } from "@shared/admin";
import type { Database } from "../db";
import { listAudit } from "./store";

/** `d` is null when the database could not open (a desktop with an unwritable home): the log is off. */
export function registerAuditRoutes(app: Express, d: Database | null): void {
  app.get(adminPaths.audit, (req, res) => {
    if (req.kubedeckUser?.role !== "admin") return void res.status(403).json({ message: "Only a KubeDeck admin can read the audit log." });
    if (!d) return void res.status(503).json({ message: "The audit log is off: KubeDeck could not open its database." });
    const user = typeof req.query.user === "string" && req.query.user ? req.query.user : undefined;
    listAudit(d, { before: Number(req.query.before) || undefined, limit: Number(req.query.limit) || undefined, user }).then(
      (list) => res.json(list),
      (err) => res.status(500).json({ message: err instanceof Error ? err.message : "Could not read the audit log." }),
    );
  });
}
