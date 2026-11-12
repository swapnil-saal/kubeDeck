/** How Better Auth stores a user's KubeDeck groups and role. */
import { roleSchema, type Role } from "@shared/admin";

/** Groups are stored as one comma-separated column on the user. */
export const splitGroups = (raw: unknown): string[] => (typeof raw === "string" ? raw.split(",").map((g) => g.trim()).filter(Boolean) : []);
export const joinGroups = (groups: string[]): string => groups.join(",");
export const roleOf = (raw: unknown): Role => {
  const roles = typeof raw === "string" ? raw.split(",").map((r) => r.trim()) : [];
  return roles.includes("admin") ? "admin" : roleSchema.parse("user");
};
