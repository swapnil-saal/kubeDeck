import { z } from 'zod';
import {
  k8sContextSchema, k8sNamespaceSchema, k8sPodSchema, k8sDeploymentSchema, k8sServiceSchema,
  k8sConfigMapSchema, k8sSecretSchema, k8sIngressSchema, k8sStatefulSetSchema,
  k8sDaemonSetSchema, k8sJobSchema, k8sCronJobSchema, k8sNodeSchema, k8sHpaSchema, k8sPvcSchema,
  settingsSchema, settingsInputSchema, kubeconfigFileSchema,
} from './schema';

export const errorSchemas = {
  internal: z.object({ message: z.string() })
};

const relatedResourceSchema = z.object({
  pods: z.array(z.object({ name: z.string(), namespace: z.string(), status: z.string(), restarts: z.number() })),
  deployments: z.array(z.object({ name: z.string(), namespace: z.string(), ready: z.string() })),
  services: z.array(z.object({ name: z.string(), namespace: z.string(), type: z.string(), ports: z.string() })),
  ingresses: z.array(z.object({ name: z.string(), namespace: z.string(), hosts: z.string() })).default([]),
});

/** One listable resource kind from API discovery (`kubectl api-resources`). */
export const apiResourceSchema = z.object({
  /** what kubectl and the routes use: `deployments`, or `certificates.cert-manager.io` for a non-core group */
  id: z.string(),
  /** plural, e.g. "certificates" */
  name: z.string(),
  /** singular, e.g. "certificate" ("" when the server does not say) */
  singular: z.string().default(""),
  kind: z.string(),
  /** "" for the core group */
  group: z.string(),
  version: z.string(),
  namespaced: z.boolean(),
  shortNames: z.array(z.string()),
  verbs: z.array(z.string()),
  categories: z.array(z.string()),
});
export type ApiResource = z.infer<typeof apiResourceSchema>;

/** A list of any kind, with the columns `kubectl get -o wide` prints for it (CRDs' own columns included). */
export const genericListSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});
export type GenericList = z.infer<typeof genericListSchema>;

/** What the cluster identity KubeDeck uses may do in a namespace (a SelfSubjectRulesReview). */
export const accessRuleSchema = z.object({
  verbs: z.array(z.string()),
  apiGroups: z.array(z.string()),
  resources: z.array(z.string()),
  resourceNames: z.array(z.string()),
});
export const accessSchema = z.object({
  rules: z.array(accessRuleSchema),
  /** the authorizer could not list everything (e.g. a webhook): a missing rule is not a "no" */
  incomplete: z.boolean(),
});
export type AccessRule = z.infer<typeof accessRuleSchema>;
export type Access = z.infer<typeof accessSchema>;

/** `kubectl explain` for one field, parsed. */
export const explainSchema = z.object({
  kind: z.string(),
  version: z.string(),
  /** the field explained, e.g. "replicas"; absent for the kind itself */
  field: z.string().optional(),
  type: z.string().optional(),
  description: z.string(),
  fields: z.array(z.object({ name: z.string(), type: z.string(), required: z.boolean(), description: z.string() })),
});
export type ExplainResult = z.infer<typeof explainSchema>;

/** What an apply would do (dry run + diff), or what it did. */
export const applyResultSchema = z.object({
  message: z.string(),
  /** dry run: one line per object, e.g. "deployment.apps/web created (server dry run)" */
  objects: z.array(z.string()).optional(),
  /** unified diff against the live objects; "" when nothing would change */
  diff: z.string().optional(),
});
export type ApplyResult = z.infer<typeof applyResultSchema>;

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
    nodeAction: {
      method: 'POST' as const,
      /** :action = cordon | uncordon | drain */
      path: '/api/k8s/nodes/:name/:action' as const,
      input: z.object({
        /** drain: also evict pods that keep data in emptyDir volumes (the data is lost) */
        deleteEmptyDirData: z.boolean().optional(),
        /** drain: also evict pods no controller will recreate */
        force: z.boolean().optional(),
      }).default({}),
      responses: { 200: z.object({ message: z.string(), output: z.string() }), 500: errorSchemas.internal },
    },
    resourceApply: {
      method: 'POST' as const,
      /** ?mode=preview (server dry run + diff, changes nothing) or apply (default); ?namespace= for objects that name none */
      path: '/api/k8s/apply' as const,
      input: z.object({ yaml: z.string().max(1_000_000) }),
      responses: { 200: applyResultSchema, 500: errorSchemas.internal },
    },
    access: {
      method: 'GET' as const,
      path: '/api/k8s/access' as const,
      responses: { 200: accessSchema, 500: errorSchemas.internal },
    },
    explain: {
      method: 'GET' as const,
      path: '/api/k8s/explain' as const,
      responses: { 200: explainSchema, 500: errorSchemas.internal },
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
    clusterEvents: {
      method: 'GET' as const,
      path: '/api/k8s/cluster-events' as const,
      responses: {
        200: z.array(z.object({
          lastTimestamp: z.string().nullable(),
          firstTimestamp: z.string().nullable(),
          count: z.number(),
          type: z.string(),
          reason: z.string(),
          message: z.string(),
          objectKind: z.string(),
          objectName: z.string(),
          namespace: z.string(),
        })),
        500: errorSchemas.internal,
      },
    },
    resourceRelated: {
      method: 'GET' as const,
      path: '/api/k8s/resource/:type/:name/related' as const,
      responses: { 200: relatedResourceSchema, 500: errorSchemas.internal },
    },
    // ── Any resource kind (built-in or custom), from API discovery ──
    apiResources: {
      method: 'GET' as const,
      path: '/api/k8s/api-resources' as const,
      responses: { 200: z.array(apiResourceSchema), 500: errorSchemas.internal },
    },
    genericList: {
      method: 'GET' as const,
      path: '/api/k8s/list/:type' as const,
      responses: { 200: genericListSchema, 500: errorSchemas.internal },
    },
  },
  settings: {
    get: {
      method: 'GET' as const,
      path: '/api/settings' as const,
      responses: { 200: settingsSchema },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/settings' as const,
      input: settingsInputSchema,
      responses: { 200: z.object({ message: z.string() }) },
    },
    kubeconfigScan: {
      method: 'GET' as const,
      path: '/api/settings/kubeconfig/scan' as const,
      responses: { 200: z.array(kubeconfigFileSchema) },
    },
  },
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
export type SettingsResponse = z.infer<typeof settingsSchema>;
export type KubeconfigFileInfo = z.infer<typeof kubeconfigFileSchema>;
