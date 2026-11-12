/**
 * Users, groups and the audit log of a KubeDeck with its own login (KUBEDECK_AUTH=builtin).
 *
 * A user's groups become Kubernetes groups: KubeDeck runs kubectl `--as=<prefix><email>
 * --as-group=<prefix><group>`, so what someone may do is whatever the cluster's RoleBindings give
 * those groups. The prefix (default `kubedeck:`) keeps a KubeDeck group from ever naming a built-in
 * one such as system:masters.
 */
import { z } from "zod";

export const adminPaths = {
  users: "/api/admin/users",
  user: "/api/admin/users/:id",
  password: "/api/admin/users/:id/password",
  ban: "/api/admin/users/:id/ban",
  sessions: "/api/admin/users/:id/sessions",
  audit: "/api/admin/audit",
} as const;

/** A group name: lowercase letters, digits and dashes, like a Kubernetes name. */
export const GROUP_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
export const MIN_PASSWORD = 12;

export const groupsSchema = z
  .array(z.string().trim().toLowerCase().regex(GROUP_NAME, "Groups use lowercase letters, digits and dashes."))
  .max(50)
  .transform((g) => [...new Set(g)].sort());

export const roleSchema = z.enum(["admin", "user"]);
export type Role = z.infer<typeof roleSchema>;

export const adminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  groups: z.array(z.string()),
  banned: z.boolean(),
  banReason: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const userListSchema = z.object({
  users: z.array(adminUserSchema),
  /** what the server prepends to user and group names for Kubernetes */
  userPrefix: z.string(),
  groupPrefix: z.string(),
});
export type UserList = z.infer<typeof userListSchema>;

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(MIN_PASSWORD).max(256),
  role: roleSchema.default("user"),
  groups: groupsSchema.default([]),
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: roleSchema.optional(),
  groups: groupsSchema.optional(),
});
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const setPasswordSchema = z.object({ password: z.string().min(MIN_PASSWORD).max(256) });
export const banSchema = z.object({ banned: z.boolean(), reason: z.string().trim().max(200).optional() });

export const auditEntrySchema = z.object({
  id: z.number(),
  at: z.string(),
  userEmail: z.string(),
  userName: z.string(),
  groups: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number(),
  context: z.string(),
  namespace: z.string(),
  detail: z.string(),
  ip: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export const auditListSchema = z.object({ entries: z.array(auditEntrySchema), more: z.boolean() });
export type AuditList = z.infer<typeof auditListSchema>;
