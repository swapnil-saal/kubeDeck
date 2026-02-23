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
  // ── Enhanced fields ──
  ready: z.string().optional(),        // "1/1"
  ip: z.string().optional(),           // Pod IP
  images: z.array(z.string()).optional(),
  cpu: z.string().optional(),           // requests
  memory: z.string().optional(),        // requests
  containerPorts: z.array(z.object({
    port: z.number(),
    protocol: z.string().optional(),
    name: z.string().optional(),
  })).optional(),
});

export const k8sDeploymentSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  ready: z.string(),
  upToDate: z.string(),
  available: z.string(),
  age: z.string(),
  // ── Enhanced ──
  images: z.array(z.string()).optional(),
  strategy: z.string().optional(),
});

export const k8sServiceSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  type: z.string(),
  clusterIP: z.string(),
  ports: z.string(),
  age: z.string(),
});

// ── New resource schemas ────────────────────────────

export const k8sConfigMapSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  dataKeys: z.number(),
  age: z.string(),
});

export const k8sSecretSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  type: z.string(),
  dataKeys: z.number(),
  age: z.string(),
});

export const k8sIngressSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  hosts: z.string(),
  ports: z.string(),
  age: z.string(),
  className: z.string().optional(),
});

export const k8sStatefulSetSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  ready: z.string(),
  replicas: z.number(),
  age: z.string(),
  images: z.array(z.string()).optional(),
});

export const k8sDaemonSetSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  desired: z.number(),
  current: z.number(),
  ready: z.number(),
  available: z.number(),
  age: z.string(),
});

export const k8sJobSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  completions: z.string(),
  duration: z.string().optional(),
  status: z.string(),
  age: z.string(),
});

export const k8sCronJobSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  schedule: z.string(),
  suspend: z.boolean(),
  lastSchedule: z.string().optional(),
  active: z.number(),
  age: z.string(),
});

export const k8sNodeSchema = z.object({
  name: z.string(),
  status: z.string(),
  roles: z.string(),
  version: z.string(),
  cpu: z.string(),
  memory: z.string(),
  os: z.string(),
  age: z.string(),
});

export const k8sHpaSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  reference: z.string(),
  minReplicas: z.number(),
  maxReplicas: z.number(),
  currentReplicas: z.number(),
  metrics: z.string(),
  age: z.string(),
});

export const k8sPvcSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  status: z.string(),
  volume: z.string(),
  capacity: z.string(),
  accessModes: z.string(),
  storageClass: z.string(),
  age: z.string(),
});

// ── Types ───────────────────────────────────────────

export type K8sContext = z.infer<typeof k8sContextSchema>;
export type K8sNamespace = z.infer<typeof k8sNamespaceSchema>;
export type K8sPod = z.infer<typeof k8sPodSchema>;
export type K8sDeployment = z.infer<typeof k8sDeploymentSchema>;
export type K8sService = z.infer<typeof k8sServiceSchema>;
export type K8sConfigMap = z.infer<typeof k8sConfigMapSchema>;
export type K8sSecret = z.infer<typeof k8sSecretSchema>;
export type K8sIngress = z.infer<typeof k8sIngressSchema>;
export type K8sStatefulSet = z.infer<typeof k8sStatefulSetSchema>;
export type K8sDaemonSet = z.infer<typeof k8sDaemonSetSchema>;
export type K8sJob = z.infer<typeof k8sJobSchema>;
export type K8sCronJob = z.infer<typeof k8sCronJobSchema>;
export type K8sNode = z.infer<typeof k8sNodeSchema>;
export type K8sHpa = z.infer<typeof k8sHpaSchema>;
export type K8sPvc = z.infer<typeof k8sPvcSchema>;