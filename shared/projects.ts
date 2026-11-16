/**
 * Projects: an application seen as one thing, spread over namespaces in one or more clusters. Kept in
 * KubeDeck's database, so everyone on a shared KubeDeck sees the same projects (what each person sees
 * inside one is still limited by their own cluster access). Anyone may create one; its creator or an
 * admin changes or deletes it.
 */
import { z } from "zod";
import { contextNameSchema } from "./groups";

export const projectPaths = {
  list: "/api/projects",
  one: "/api/projects/:id",
  /** projects a browser kept before they moved to the server, sent once */
  import: "/api/projects/import",
} as const;

export const projectScopeSchema = z.object({
  context: contextNameSchema,
  namespace: z.string().trim().regex(/^(?!-)[a-z0-9.-]{1,253}$/, "Not a valid namespace.").refine((n) => n !== "all", "Pick a namespace."),
});
export type ProjectScope = z.infer<typeof projectScopeSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  scopes: z.array(projectScopeSchema),
  createdAt: z.number(),
  /** who created it (an email, or the desktop's user name) */
  createdBy: z.string(),
  /** the viewer may change or delete it: its creator, or an admin */
  canEdit: z.boolean(),
});
export type Project = z.infer<typeof projectSchema>;

export const saveProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  scopes: z.array(projectScopeSchema).min(1, "Add at least one namespace.").max(200),
});
export type SaveProjectInput = z.input<typeof saveProjectSchema>;

export const importProjectsSchema = z.object({
  projects: z.array(saveProjectSchema.extend({ createdAt: z.number().optional() })).max(200),
});

/** "Payments API" → "payments-api", unique among existing ids. */
export function projectId(name: string, taken: string[]): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

/** Same cluster and namespace only once, in a stable order. */
export function normalizeScopes(scopes: ProjectScope[]): ProjectScope[] {
  const seen = new Set<string>();
  return scopes
    .filter((s) => s.context && s.namespace && s.namespace !== "all")
    .filter((s) => { const k = `${s.context}\u0000${s.namespace}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.context.localeCompare(b.context) || a.namespace.localeCompare(b.namespace));
}
