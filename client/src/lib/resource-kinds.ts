import {
  Box, Boxes, CalendarClock, Database, FileText, Gauge, Globe, HardDrive, KeyRound, Layers, ListChecks, Network, Server,
  type LucideIcon,
} from "lucide-react";

/**
 * Every resource kind KubeDeck lists, in one place: the sidebar, the list routes
 * (`/resources/:kind`), breadcrumbs and the detail page all read from here.
 */
export interface ResourceKind {
  /** route segment and list key, e.g. "pods" */
  key: string;
  /** sidebar / heading label */
  label: string;
  /** singular type used by `/resource/:type/:name` and kubectl, e.g. "pod" */
  type: string;
  /** kubectl resource for the command bar, e.g. "pvc" */
  kubectl: string;
  icon: LucideIcon;
  group: "Workloads" | "Network" | "Config" | "Storage" | "Cluster";
  /** cluster-scoped: never filtered by namespace */
  clusterScoped?: boolean;
}

export const RESOURCE_KINDS: readonly ResourceKind[] = [
  { key: "pods", label: "Pods", type: "pod", kubectl: "pods", icon: Box, group: "Workloads" },
  { key: "deployments", label: "Deployments", type: "deployment", kubectl: "deployments", icon: Layers, group: "Workloads" },
  { key: "statefulsets", label: "StatefulSets", type: "statefulset", kubectl: "statefulsets", icon: Database, group: "Workloads" },
  { key: "daemonsets", label: "DaemonSets", type: "daemonset", kubectl: "daemonsets", icon: Boxes, group: "Workloads" },
  { key: "jobs", label: "Jobs", type: "job", kubectl: "jobs", icon: ListChecks, group: "Workloads" },
  { key: "cronjobs", label: "CronJobs", type: "cronjob", kubectl: "cronjobs", icon: CalendarClock, group: "Workloads" },
  { key: "hpa", label: "Autoscalers", type: "hpa", kubectl: "hpa", icon: Gauge, group: "Workloads" },
  { key: "services", label: "Services", type: "service", kubectl: "services", icon: Network, group: "Network" },
  { key: "ingresses", label: "Ingresses", type: "ingress", kubectl: "ingresses", icon: Globe, group: "Network" },
  { key: "configmaps", label: "ConfigMaps", type: "configmap", kubectl: "configmaps", icon: FileText, group: "Config" },
  { key: "secrets", label: "Secrets", type: "secret", kubectl: "secrets", icon: KeyRound, group: "Config" },
  { key: "pvcs", label: "Volume claims", type: "pvc", kubectl: "pvc", icon: HardDrive, group: "Storage" },
  { key: "nodes", label: "Nodes", type: "node", kubectl: "nodes", icon: Server, group: "Cluster", clusterScoped: true },
];

export const RESOURCE_GROUPS = ["Workloads", "Network", "Config", "Storage", "Cluster"] as const;

const BY_KEY = new Map(RESOURCE_KINDS.map((k) => [k.key, k]));
const BY_TYPE = new Map(RESOURCE_KINDS.map((k) => [k.type, k]));

export const kindByKey = (key: string): ResourceKind | undefined => BY_KEY.get(key);
export const kindByType = (type: string): ResourceKind | undefined => BY_TYPE.get(type);

/** Link to a kind's list, optionally with a quick filter (`bad`, `restarts`). */
export function listHref(key: string, filter?: "bad" | "restarts" | null): string {
  return `/resources/${key}${filter ? `?f=${filter}` : ""}`;
}
