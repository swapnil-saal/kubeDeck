/**
 * KubeDeck groups (web mode): teams such as "Developers" or "Quality team" that an admin defines under
 * Settings → Groups, adds people to, and gives a service account on each cluster, either
 *
 *  - serviceaccount: one KubeDeck impersonates (`--as=system:serviceaccount:<ns>:<name>`), picked from
 *    the cluster, which needs KubeDeck's credentials to be allowed to impersonate it; or
 *  - credentials: a kubeconfig an admin uploads for it (a token or client certificate, kept encrypted),
 *    for clusters where KubeDeck may not impersonate.
 *
 * On a cluster none of a person's groups covers, KubeDeck acts as the person
 * (`kubedeck:<email>` in groups `kubedeck:<group>`), so RoleBindings to those names still work.
 * When several of a person's groups cover the same cluster, the group higher in the list wins.
 */
import { z } from "zod";
import { GROUP_NAME } from "./admin";

export const groupPaths = {
  list: "/api/groups",
  one: "/api/groups/:id",
  order: "/api/groups/order",
  /** a namespace's service accounts as KubeDeck's credentials see them, and whether it may impersonate them */
  serviceAccounts: "/api/groups/serviceaccounts/:context",
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

export const groupSchema = z.object({
  /** the Kubernetes-safe id people's accounts carry, e.g. quality-team; never changes */
  id: z.string(),
  name: z.string(),
  description: z.string(),
  access: z.array(clusterAccessSchema),
  /** place in the list: the first of a person's groups that covers a cluster wins */
  position: z.number(),
});
export type Group = z.infer<typeof groupSchema>;

export const groupListSchema = z.object({
  groups: z.array(groupSchema),
  /** what a person is sent to Kubernetes as on a cluster none of their groups covers */
  userPrefix: z.string(),
  groupPrefix: z.string(),
});
export type GroupList = z.infer<typeof groupListSchema>;

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** optional; derived from the name when left out */
  id: z.string().trim().toLowerCase().regex(GROUP_NAME, "Group ids use lowercase letters, digits and dashes.").optional(),
  description: z.string().trim().max(300).default(""),
  access: accessListSchema.default([]),
});
export type CreateGroupInput = z.input<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(300).optional(),
  access: accessListSchema.optional(),
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

/**
 * What someone in `memberOf` acts as on `context`: the access of the first of their groups, in the
 * list's order, that covers it, with that group; undefined when none does (they act as themselves).
 * The server decides every kubectl call with this; the pages use it to show the same answer.
 */
export function accessOn(groups: Group[], memberOf: string[], context: string): { group: Group; access: ClusterAccess } | undefined {
  if (!context || memberOf.length === 0) return undefined;
  for (const group of [...groups].sort((a, b) => a.position - b.position)) {
    if (!memberOf.includes(group.id)) continue;
    const access = group.access.find((x) => x.context === context);
    if (access) return { group, access };
  }
  return undefined;
}

/** "system:serviceaccount:monitoring:grafana" → "monitoring/grafana"; any other name as it is. */
export function shortIdentity(name: string): string {
  const sa = /^system:serviceaccount:([^:]+):(.+)$/.exec(name);
  return sa ? `${sa[1]}/${sa[2]}` : name;
}
