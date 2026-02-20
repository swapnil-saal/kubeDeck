import { z } from 'zod';
import { k8sContextSchema, k8sNamespaceSchema, k8sPodSchema, k8sDeploymentSchema, k8sServiceSchema } from './schema';

export const errorSchemas = {
  internal: z.object({ message: z.string() })
};

export const api = {
  k8s: {
    contexts: {
      method: 'GET' as const,
      path: '/api/k8s/contexts' as const,
      responses: {
        200: z.array(k8sContextSchema),
      },
    },
    namespaces: {
      method: 'GET' as const,
      path: '/api/k8s/namespaces' as const,
      responses: {
        200: z.array(k8sNamespaceSchema),
        500: errorSchemas.internal
      },
    },
    pods: {
      method: 'GET' as const,
      path: '/api/k8s/pods' as const,
      responses: {
        200: z.array(k8sPodSchema),
        500: errorSchemas.internal
      },
    },
    deployments: {
      method: 'GET' as const,
      path: '/api/k8s/deployments' as const,
      responses: {
        200: z.array(k8sDeploymentSchema),
        500: errorSchemas.internal
      },
    },
    services: {
      method: 'GET' as const,
      path: '/api/k8s/services' as const,
      responses: {
        200: z.array(k8sServiceSchema),
        500: errorSchemas.internal
      },
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      } else {
        query.append(key, String(value));
      }
    });
    const queryString = query.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }
  return url;
}

export type ContextsResponse = z.infer<typeof api.k8s.contexts.responses[200]>;
export type NamespacesResponse = z.infer<typeof api.k8s.namespaces.responses[200]>;
export type PodsResponse = z.infer<typeof api.k8s.pods.responses[200]>;
export type DeploymentsResponse = z.infer<typeof api.k8s.deployments.responses[200]>;
export type ServicesResponse = z.infer<typeof api.k8s.services.responses[200]>;
