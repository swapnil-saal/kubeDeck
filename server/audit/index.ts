/**
 * The audit log: one row per write anyone made through KubeDeck (scale, edit, delete, palette
 * commands, assistant actions), on the desktop and in web mode. Writes arrive as `action.done`
 * events (web mode also prints them to stdout so a cluster's log pipeline keeps them).
 * This module owns the `audit_log` table.
 */
export { listAudit, recordAudit, startAudit, type NewAuditEntry } from "./store";
export { registerAuditRoutes } from "./routes";
