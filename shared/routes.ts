import { z } from 'zod';
import {
  k8sContextSchema, k8sNamespaceSchema, k8sPodSchema, k8sDeploymentSchema, k8sServiceSchema,
  k8sConfigMapSchema, k8sSecretSchema, k8sIngressSchema, k8sStatefulSetSchema,
  k8sDaemonSetSchema, k8sJobSchema, k8sCronJobSchema, k8sNodeSchema, k8sHpaSchema, k8sPvcSchema,
} from './schema';

export const errorSchemas = {
  internal: z.object({ message: z.string() })
};

const relatedResourceSchema = z.object({
  pods: z.array(z.object({ name: z.string(), namespace: z.string(), status: z.string(), restarts: z.number() })),
  deployments: z.array(z.object({ name: z.string(), namespace: z.string(), ready: z.string() })),
  services: z.array(z.object({ name: z.string(), namespace: z.string(), type: z.string(), ports: z.string() })),
});

const portForwardEntrySchema = z.object({
  id: z.string(),
  pod: z.string(),
  namespace: z.string(),
  context: z.string(),
  localPort: z.number(),
  remotePort: z.number(),
  startedAt: z.string(),
  status: z.enum(["active", "dead", "error"]).optional(),
  error: z.string().optional(),
  connections: z.number().optional(),
});

export const api = {
  k8s: {
    contexts: {
      method: 'GET' as const,
      path: '/api/k8s/contexts' as const,
      responses: { 200: z.array(k8sContextSchema) },
    },
    namespaces: {
      method: 'GET' as const,
      path: '/api/k8s/namespaces' as const,
      responses: { 200: z.array(k8sNamespaceSchema), 500: errorSchemas.internal },
    },
    pods: {
      method: 'GET' as const,
      path: '/api/k8s/pods' as const,
      responses: { 200: z.array(k8sPodSchema), 500: errorSchemas.internal },
    },
    deployments: {
      method: 'GET' as const,
      path: '/api/k8s/deployments' as const,
      responses: { 200: z.array(k8sDeploymentSchema), 500: errorSchemas.internal },
    },
    services: {
      method: 'GET' as const,
      path: '/api/k8s/services' as const,
      responses: { 200: z.array(k8sServiceSchema), 500: errorSchemas.internal },
    },
    podDelete: {
      method: 'DELETE' as const,
      path: '/api/k8s/pods/:name' as const,
      responses: { 200: z.object({ message: z.string() }), 500: errorSchemas.internal },
    },
    podLogs: {
      method: 'GET' as const,
      path: '/api/k8s/pods/:name/logs' as const,
      responses: { 200: z.object({ logs: z.string() }), 500: errorSchemas.internal },
    },
    podEnv: {
      method: 'GET' as const,
      path: '/api/k8s/pods/:name/env' as const,
      responses: { 200: z.object({ env: z.string() }), 500: errorSchemas.internal },
    },
    portForward: {
      method: 'POST' as const,
      path: '/api/k8s/pods/:name/port-forward' as const,
      input: z.object({ port: z.number(), remotePort: z.number().optional() }),
      responses: { 200: z.object({ message: z.string(), id: z.string() }), 500: errorSchemas.internal },
    },
    portForwards: {
      method: 'GET' as const,
      path: '/api/k8s/port-forwards' as const,
      responses: { 200: z.array(portForwardEntrySchema) },
    },
    portForwardStop: {
      method: 'DELETE' as const,
      path: '/api/k8s/port-forwards/:id' as const,
      responses: { 200: z.object({ message: z.string() }), 500: errorSchemas.internal },
    },
    // ── New resource list endpoints ──
    configmaps: {
      method: 'GET' as const,
      path: '/api/k8s/configmaps' as const,
      responses: { 200: z.array(k8sConfigMapSchema), 500: errorSchemas.internal },
    },
    secrets: {
      method: 'GET' as const,
      path: '/api/k8s/secrets' as const,
      responses: { 200: z.array(k8sSecretSchema), 500: errorSchemas.internal },
    },
    ingresses: {
      method: 'GET' as const,
      path: '/api/k8s/ingresses' as const,
      responses: { 200: z.array(k8sIngressSchema), 500: errorSchemas.internal },
    },
    statefulsets: {
      method: 'GET' as const,
      path: '/api/k8s/statefulsets' as const,
      responses: { 200: z.array(k8sStatefulSetSchema), 500: errorSchemas.internal },
    },
    daemonsets: {
      method: 'GET' as const,
      path: '/api/k8s/daemonsets' as const,
      responses: { 200: z.array(k8sDaemonSetSchema), 500: errorSchemas.internal },
    },
    jobs: {
      method: 'GET' as const,
      path: '/api/k8s/jobs' as const,
      responses: { 200: z.array(k8sJobSchema), 500: errorSchemas.internal },
    },
    cronjobs: {
      method: 'GET' as const,
      path: '/api/k8s/cronjobs' as const,
      responses: { 200: z.array(k8sCronJobSchema), 500: errorSchemas.internal },
    },
    nodes: {
      method: 'GET' as const,
      path: '/api/k8s/nodes' as const,
      responses: { 200: z.array(k8sNodeSchema), 500: errorSchemas.internal },
    },
    hpa: {
      method: 'GET' as const,
      path: '/api/k8s/hpa' as const,
      responses: { 200: z.array(k8sHpaSchema), 500: errorSchemas.internal },
    },
    pvcs: {
      method: 'GET' as const,
      path: '/api/k8s/pvcs' as const,
      responses: { 200: z.array(k8sPvcSchema), 500: errorSchemas.internal },
    },
    // ── Actions ──
    deploymentScale: {
      method: 'POST' as const,
      path: '/api/k8s/deployments/:name/scale' as const,
      input: z.object({ replicas: z.number() }),
      responses: { 200: z.object({ message: z.string() }), 500: errorSchemas.internal },
    },
    deploymentRestart: {
      method: 'POST' as const,
      path: '/api/k8s/deployments/:name/restart' as const,
      responses: { 200: z.object({ message: z.string() }), 500: errorSchemas.internal },
    },
    resourceApply: {
      method: 'POST' as const,
      path: '/api/k8s/apply' as const,
      input: z.object({ yaml: z.string() }),
      responses: { 200: z.object({ message: z.string() }), 500: errorSchemas.internal },
    },
    resourceDescribe: {
      method: 'GET' as const,
      path: '/api/k8s/resource/:type/:name/describe' as const,
      responses: { 200: z.object({ content: z.string() }), 500: errorSchemas.internal },
    },
    resourceYaml: {
      method: 'GET' as const,
      path: '/api/k8s/resource/:type/:name/yaml' as const,
      responses: { 200: z.object({ content: z.string() }), 500: errorSchemas.internal },
    },
    resourceEvents: {
      method: 'GET' as const,
      path: '/api/k8s/resource/:type/:name/events' as const,
      responses: { 200: z.object({ content: z.string() }), 500: errorSchemas.internal },
    },
    resourceRelated: {
      method: 'GET' as const,
      path: '/api/k8s/resource/:type/:name/related' as const,
      responses: { 200: relatedResourceSchema, 500: errorSchemas.internal },
    },
    podLogsStream: {
      method: 'GET' as const,
      path: '/api/k8s/pods/:name/logs/stream' as const,
    },
    // Terminal (WebSocket-based, path used for WS upgrade)
    terminal: {
      path: '/api/terminal' as const,
    },
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(':' + key)) {
        url = url.replace(':' + key, String(value));
      } else {
        query.append(key, String(value));
      }
    });
    const queryString = query.toString();
    if (queryString) url += '?' + queryString;
  }
  return url;
}

export type ContextsResponse = z.infer<typeof api.k8s.contexts.responses[200]>;
export type NamespacesResponse = z.infer<typeof api.k8s.namespaces.responses[200]>;
export type PodsResponse = z.infer<typeof api.k8s.pods.responses[200]>;
export type DeploymentsResponse = z.infer<typeof api.k8s.deployments.responses[200]>;
export type ServicesResponse = z.infer<typeof api.k8s.services.responses[200]>;
export type RelatedResources = z.infer<typeof relatedResourceSchema>;
export type PortForwardEntry = z.infer<typeof portForwardEntrySchema>;
