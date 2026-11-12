/**
 * The audit log: one row per write anyone made through KubeDeck (scale, edit, delete, palette
 * commands, assistant actions). It is also printed to stdout so a cluster's log pipeline keeps it.
 * This module owns the `audit_log` table.
 */
import type { AuditEntry, AuditList } from "@shared/admin";
import type { Database } from "../db";

export type NewAuditEntry = Omit<AuditEntry, "id">;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function recordAudit(d: Database, e: NewAuditEntry): Promise<void> {
  await d.db
    .insertInto("audit_log")
    .values({
      at: e.at,
      user_email: clip(e.userEmail, 200),
      user_name: clip(e.userName, 200),
      groups: clip(e.groups, 500),
      method: e.method,
      path: clip(e.path, 500),
      status: e.status,
      context: clip(e.context, 200),
      namespace: clip(e.namespace, 200),
      detail: clip(e.detail, 1000),
      ip: clip(e.ip, 100),
    })
    .execute();
}

/** Newest first. `before` is an id from the previous page; `user` filters by email. */
export async function listAudit(d: Database, o: { limit?: number; before?: number; user?: string } = {}): Promise<AuditList> {
  const limit = Math.min(Math.max(o.limit ?? 100, 1), 500);
  let q = d.db.selectFrom("audit_log").selectAll().orderBy("id", "desc").limit(limit + 1);
  if (o.before) q = q.where("id", "<", o.before);
  if (o.user) q = q.where("user_email", "=", o.user.toLowerCase());
  const rows = await q.execute();
  return {
    more: rows.length > limit,
    entries: rows.slice(0, limit).map((r) => ({
      id: Number(r.id),
      at: r.at,
      userEmail: r.user_email,
      userName: r.user_name,
      groups: r.groups,
      method: r.method,
      path: r.path,
      status: Number(r.status),
      context: r.context,
      namespace: r.namespace,
      detail: r.detail,
      ip: r.ip,
    })),
  };
}
