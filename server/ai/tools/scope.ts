import { z } from "zod";

/** The cluster scope one agent request runs in. Passed to every cluster tool as its `context`. */
export const kubeScopeSchema = z.object({
  /** kube context name; empty = kubeconfig default */
  context: z.string(),
  /** namespace selected in the header; empty = all namespaces */
  namespace: z.string(),
  /** chat thread, for the repeat-call and access guards */
  threadId: z.string(),
  /** who asked (web mode's signed-in user), for audit lines; empty on the desktop */
  user: z.string().default(""),
});
export type KubeScope = z.infer<typeof kubeScopeSchema>;
