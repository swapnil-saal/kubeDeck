/**
 * KubeDeck groups (web mode): teams such as "Developers" or "Quality team" that an admin defines under
 * Settings → Groups, adds people to, and gives a service account on each of the clusters added under
 * Settings → Clusters, either
 *
 *  - serviceaccount: one KubeDeck impersonates through the cluster's connection
 *    (`--as=system:serviceaccount:<ns>:<name>`), picked from the cluster; the connection must be
 *    allowed to impersonate it; or
 *  - credentials: a kubeconfig an admin uploads for it (a token or client certificate, kept encrypted).
 *
 * People reach only the clusters their groups cover (admins too). When several of a person's groups
 * cover the same cluster, permissions add up: a call is tried as each of their service accounts there,
 * in the list's order, until the cluster allows it.
 */
import { z } from "zod";
import { GROUP_NAME } from "./admin";

export const groupPaths = {
  list: "/api/groups",
  one: "/api/groups/:id",
  order: "/api/groups/order",
  /** a namespace's service accounts as the cluster's connection sees them, and whether it may impersonate them */
  serviceAccounts: "/api/groups/serviceaccounts/:context",
  /** a group's service account's Kubernetes permissions in one namespace (?namespace=) */
} as const;

/** A kubeconfig context name as KubeDeck accepts it anywhere (server/security.ts). */
export const contextNameSchema = z.string().trim().regex(/^(?!-)[\w.:@/+=-]{1,253}$/, "Not a valid cluster name.");

const k8sName = z.string().trim().regex(/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/, "Use a Kubernetes name: lowercase letters, digits, dots and dashes.");

export const clusterAccessSchema = z.discriminatedUnion("as", [
  z.object({ context: contextNameSchema, as: z.literal("serviceaccount"), namespace: k8sName, serviceAccount: k8sName }),
  z.object({
    context: contextNameSchema,
    as: z.literal("credentials"),
    /** sent only to upload new ones; never sent back. Left out on a save, the stored ones are kept */
    kubeconfig: z.string().max(64_000).optional(),
    /** filled in by the server: whom they sign in as ("" when the cluster could not say) and the API server */
    identity: z.string().optional(),
    server: z.string().optional(),
  }),
]);
export type ClusterAccess = z.infer<typeof clusterAccessSchema>;

const accessListSchema = z
  .array(clusterAccessSchema)
  .max(100)
  .refine((list) => new Set(list.map((a) => a.context)).size === list.length, "A group acts as one identity per cluster.");

/**
 * What a group may use in KubeDeck itself (not in a cluster: that is Kubernetes RBAC). A person gets a
 * feature when ANY of their groups allows it; an admin always has all; someone in no group has none.
 */
export const APP_PERMISSIONS = [
  { key: "assistant", label: "Ask Deck (assistant)", help: "Chat with the AI assistant; explain and diagnose." },
  { key: "assistantChanges", label: "Assistant may propose changes", help: "Off: the assistant only reads, whatever the cluster allows." },
  { key: "palette", label: "kubectl palette", help: "Run kubectl commands from \u2318K." },
  { key: "podFiles", label: "Pod files", help: "Browse and download files inside containers." },
  { key: "projects", label: "Create and edit projects", help: "Off: projects are view only." },
  { key: "mcp", label: "MCP server tools", help: "The assistant may call tools from MCP servers." },
] as const;
export type AppPermission = (typeof APP_PERMISSIONS)[number]["key"];
export type AppPermissions = Record<AppPermission, boolean>;

export const appPermissionsSchema = z.object({
  assistant: z.boolean(),
  assistantChanges: z.boolean(),
  palette: z.boolean(),
  podFiles: z.boolean(),
  projects: z.boolean(),
  mcp: z.boolean(),
});

export const ALL_PERMISSIONS: AppPermissions = { assistant: true, assistantChanges: true, palette: true, podFiles: true, projects: true, mcp: true };
export const NO_PERMISSIONS: AppPermissions = { assistant: false, assistantChanges: false, palette: false, podFiles: false, projects: false, mcp: false };

/** What someone in `memberOf` may use: a feature any of their groups allows. */
export function permissionsOf(groups: Pick<Group, "id" | "permissions">[], memberOf: string[]): AppPermissions {
  const out = { ...NO_PERMISSIONS };
  for (const g of groups) {
    if (!memberOf.includes(g.id)) continue;
    for (const k of Object.keys(out) as AppPermission[]) out[k] ||= g.permissions[k];
  }
  return out;
}

export const groupSchema = z.object({
  /** the Kubernetes-safe id people's accounts carry, e.g. quality-team; never changes */
  id: z.string(),
  name: z.string(),
  description: z.string(),
  access: z.array(clusterAccessSchema),
  /** place in the list: the order a person's service accounts on a cluster are tried in */
  position: z.number(),
  permissions: appPermissionsSchema,
});
export type Group = z.infer<typeof groupSchema>;

export const groupListSchema = z.object({
  groups: z.array(groupSchema),
});
export type GroupList = z.infer<typeof groupListSchema>;

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** optional; derived from the name when left out */
  id: z.string().trim().toLowerCase().regex(GROUP_NAME, "Group ids use lowercase letters, digits and dashes.").optional(),
  description: z.string().trim().max(300).default(""),
  access: accessListSchema.default([]),
  permissions: appPermissionsSchema.partial().optional(),
});
export type CreateGroupInput = z.input<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(300).optional(),
  access: accessListSchema.optional(),
  permissions: appPermissionsSchema.partial().optional(),
});
export type UpdateGroupInput = z.input<typeof updateGroupSchema>;

export const groupOrderSchema = z.object({ ids: z.array(z.string()).max(500) });


export const serviceAccountsInfoSchema = z.object({
  context: z.string(),
  namespace: z.string(),
  /** absent when KubeDeck's credentials may not list them (see listError) */
  names: z.array(z.string()).optional(),
  listError: z.string().optional(),
  /** KubeDeck's credentials may impersonate service accounts in this namespace */
  canImpersonate: z.boolean(),
});
export type ServiceAccountsInfo = z.infer<typeof serviceAccountsInfoSchema>;

/** "Quality Team" → "quality-team", unique among `taken`. */
export function groupIdFor(name: string, taken: string[]): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 55).replace(/-+$/, "") || "group";
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

/** "system:serviceaccount:monitoring:grafana" → "monitoring/grafana"; any other name as it is. */
export function shortIdentity(name: string): string {
  const sa = /^system:serviceaccount:([^:]+):(.+)$/.exec(name);
  return sa ? `${sa[1]}/${sa[2]}` : name;
}

