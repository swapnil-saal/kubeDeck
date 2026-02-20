import { z } from "zod";

export const k8sContextSchema = z.object({
  name: z.string(),
  cluster: z.string(),
  user: z.string(),
  isCurrent: z.boolean(),
});

export const k8sNamespaceSchema = z.object({
  name: z.string(),
  status: z.string(),
  age: z.string(),
});

export const k8sPodSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  status: z.string(),
  restarts: z.number(),
  age: z.string(),
  node: z.string().optional(),
});

export const k8sDeploymentSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  ready: z.string(),
  upToDate: z.string(),
  available: z.string(),
  age: z.string(),
});

export const k8sServiceSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  type: z.string(),
  clusterIP: z.string(),
  ports: z.string(),
  age: z.string(),
});

export type K8sContext = z.infer<typeof k8sContextSchema>;
export type K8sNamespace = z.infer<typeof k8sNamespaceSchema>;
export type K8sPod = z.infer<typeof k8sPodSchema>;
export type K8sDeployment = z.infer<typeof k8sDeploymentSchema>;
export type K8sService = z.infer<typeof k8sServiceSchema>;
