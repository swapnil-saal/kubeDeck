import { useMemo, useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { useTerminalStore } from "./use-terminal-store";

interface NamedResource {
  name: string;
  [key: string]: unknown;
}

export interface ResourceNameEntry {
  name: string;
  type: string;
  typeShort: string;
}

const RESOURCE_QUERIES: Array<{
  path: string;
  type: string;
  typeShort: string;
  useNamespace: boolean;
}> = [
  { path: api.k8s.pods.path, type: "pod", typeShort: "po", useNamespace: true },
  { path: api.k8s.deployments.path, type: "deployment", typeShort: "deploy", useNamespace: true },
  { path: api.k8s.services.path, type: "service", typeShort: "svc", useNamespace: true },
  { path: api.k8s.configmaps.path, type: "configmap", typeShort: "cm", useNamespace: true },
  { path: api.k8s.secrets.path, type: "secret", typeShort: "secret", useNamespace: true },
  { path: api.k8s.ingresses.path, type: "ingress", typeShort: "ing", useNamespace: true },
  { path: api.k8s.statefulsets.path, type: "statefulset", typeShort: "sts", useNamespace: true },
  { path: api.k8s.daemonsets.path, type: "daemonset", typeShort: "ds", useNamespace: true },
  { path: api.k8s.jobs.path, type: "job", typeShort: "job", useNamespace: true },
  { path: api.k8s.cronjobs.path, type: "cronjob", typeShort: "cj", useNamespace: true },
  { path: api.k8s.nodes.path, type: "node", typeShort: "no", useNamespace: false },
  { path: api.k8s.hpa.path, type: "hpa", typeShort: "hpa", useNamespace: true },
  { path: api.k8s.pvcs.path, type: "pvc", typeShort: "pvc", useNamespace: true },
];

const TYPE_ALIASES: Record<string, string> = {
  pods: "pod", po: "pod",
  deployments: "deployment", deploy: "deployment", deploys: "deployment",
  services: "service", svc: "service",
  configmaps: "configmap", cm: "configmap",
  secrets: "secret",
  ingresses: "ingress", ing: "ingress",
  statefulsets: "statefulset", sts: "statefulset",
  daemonsets: "daemonset", ds: "daemonset",
  jobs: "job",
  cronjobs: "cronjob", cj: "cronjob",
  nodes: "node", no: "node",
  hpa: "hpa", horizontalpodautoscaler: "hpa", horizontalpodautoscalers: "hpa",
  pvcs: "pvc", pvc: "pvc", persistentvolumeclaim: "pvc", persistentvolumeclaims: "pvc",
};

function normalizeType(input: string): string | null {
  const lower = input.toLowerCase();
  return TYPE_ALIASES[lower] || RESOURCE_QUERIES.find(r => r.type === lower)?.type || null;
}

/**
 * Reads resource names from React Query cache — zero extra network calls.
 * Returns all cached resource names grouped by type.
 */
export function useResourceNames(): ResourceNameEntry[] {
  const qc = useQueryClient();
  const { context, namespace } = useTerminalStore();
  const [tick, setTick] = useState(0);

  const buildEntries = useCallback((): ResourceNameEntry[] => {
    if (!context) return [];
    const entries: ResourceNameEntry[] = [];

    for (const rq of RESOURCE_QUERIES) {
      const key = rq.useNamespace
        ? [rq.path, context, namespace]
        : [rq.path, context];

      const data = qc.getQueryData<NamedResource[]>(key);
      if (!data || !Array.isArray(data)) continue;

      for (const item of data) {
        if (item.name) {
          entries.push({ name: item.name, type: rq.type, typeShort: rq.typeShort });
        }
      }
    }
    return entries;
  }, [qc, context, namespace]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = qc.getQueryCache().subscribe(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setTick(t => t + 1);
      }, 2000);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [qc]);

  return useMemo(() => buildEntries(), [buildEntries, tick]);
}

export interface AutocompleteResult {
  description: string;
  command: string;
  confidence: number;
  resourceName: string;
  resourceType: string;
}

/**
 * Given a query like "describe pod e2-course" or "logs e2-co",
 * returns matching commands with actual resource names from the cluster.
 */
export function searchResourceNames(
  query: string,
  entries: ResourceNameEntry[],
  ctxFlag: string,
  nsFlag: string,
): AutocompleteResult[] {
  if (!query.trim() || entries.length === 0) return [];

  const trimmed = query.trim().toLowerCase();

  // Pattern 1: "verb [type] partial-name" — e.g. "describe pod e2-course", "logs e2-co", "exec my-pod"
  const verbTypeNameMatch = trimmed.match(
    /^(get|describe|logs?|exec|delete|scale|restart|rollout|top)\s+(?:(pod|pods?|deployment|deployments?|deploy|service|services?|svc|configmap|configmaps?|cm|secret|secrets?|ingress|ingresses?|ing|statefulset|statefulsets?|sts|daemonset|daemonsets?|ds|job|jobs?|cronjob|cronjobs?|cj|node|nodes?|no|hpa|pvc|pvcs?)\s+)?(.+)/i,
  );

  if (verbTypeNameMatch) {
    const verb = verbTypeNameMatch[1].toLowerCase().replace(/^log$/, "logs");
    const typeStr = verbTypeNameMatch[2];
    const partial = verbTypeNameMatch[3].toLowerCase();

    const targetType = typeStr ? normalizeType(typeStr) : null;

    const matches = entries.filter(e => {
      if (targetType && e.type !== targetType) return false;
      return e.name.toLowerCase().includes(partial);
    });

    if (matches.length === 0) return [];

    const verbCommands: Record<string, (t: string, n: string) => string> = {
      get: (t, n) => `kubectl get ${t} ${n}${ctxFlag}${nsFlag}`,
      describe: (t, n) => `kubectl describe ${t} ${n}${ctxFlag}${nsFlag}`,
      logs: (t, n) => `kubectl logs ${n}${ctxFlag}${nsFlag} --tail=100`,
      exec: (t, n) => `kubectl exec -it ${n}${ctxFlag}${nsFlag} -- /bin/sh`,
      delete: (t, n) => `kubectl delete ${t} ${n}${ctxFlag}${nsFlag}`,
      scale: (t, n) => `kubectl scale ${t}/${n}${ctxFlag}${nsFlag} --replicas=`,
      restart: (t, n) => `kubectl rollout restart ${t}/${n}${ctxFlag}${nsFlag}`,
      rollout: (t, n) => `kubectl rollout status ${t}/${n}${ctxFlag}${nsFlag}`,
      top: (_t, n) => `kubectl top pod ${n}${ctxFlag}${nsFlag}`,
    };

    const buildCmd = verbCommands[verb] || verbCommands.get;

    return matches.slice(0, 8).map(m => ({
      description: `${verb} ${m.type} ${m.name}`,
      command: buildCmd(m.type, m.name),
      confidence: m.name.toLowerCase().startsWith(partial) ? 0.95 : 0.85,
      resourceName: m.name,
      resourceType: m.type,
    })).sort((a, b) => b.confidence - a.confidence);
  }

  // Pattern 2: bare partial name — just a resource name fragment (no verb)
  if (trimmed.length >= 3 && !/\s/.test(trimmed)) {
    const matches = entries.filter(e => e.name.toLowerCase().includes(trimmed));
    if (matches.length > 0) {
      return matches.slice(0, 6).map(m => ({
        description: `describe ${m.type} ${m.name}`,
        command: `kubectl describe ${m.type} ${m.name}${ctxFlag}${nsFlag}`,
        confidence: m.name.toLowerCase().startsWith(trimmed) ? 0.8 : 0.7,
        resourceName: m.name,
        resourceType: m.type,
      })).sort((a, b) => b.confidence - a.confidence);
    }
  }

  return [];
}
