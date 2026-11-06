import {
  Archive, BadgeCheck, Box, Boxes, CalendarClock, Copy, Cylinder, Database, FileText, Folders, Gauge, Globe, HardDrive, History,
  DoorOpen, KeyRound, Layers, Link, Link2, ListChecks, Network, Puzzle, Route, Ruler, Scale, Server, Shield, ShieldCheck, ShieldHalf,
  Split, UserCog,
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
  group: (typeof RESOURCE_GROUPS)[number];
  /** cluster-scoped: never filtered by namespace */
  clusterScoped?: boolean;
  /** listed by the generic list (the columns kubectl prints); `type` and `key` are the api-resource id */
  generic?: boolean;
  /** shown only when the cluster serves this kind (an add-on API such as Gateway API) */
  optional?: boolean;
}

export const RESOURCE_GROUPS = ["Workloads", "Network", "Config", "Storage", "Access", "Cluster"] as const;

/** A kind with no list of its own: shown with kubectl's columns, linked by its api-resource id. */
const g = (key: string, label: string, icon: LucideIcon, group: ResourceKind["group"], clusterScoped = false, optional = false): ResourceKind =>
  ({ key, label, type: key, kubectl: key, icon, group, clusterScoped, generic: true, optional });

export const RESOURCE_KINDS: readonly ResourceKind[] = [
  { key: "pods", label: "Pods", type: "pod", kubectl: "pods", icon: Box, group: "Workloads" },
  { key: "deployments", label: "Deployments", type: "deployment", kubectl: "deployments", icon: Layers, group: "Workloads" },
  { key: "statefulsets", label: "StatefulSets", type: "statefulset", kubectl: "statefulsets", icon: Database, group: "Workloads" },
  { key: "daemonsets", label: "DaemonSets", type: "daemonset", kubectl: "daemonsets", icon: Boxes, group: "Workloads" },
  { key: "jobs", label: "Jobs", type: "job", kubectl: "jobs", icon: ListChecks, group: "Workloads" },
  { key: "cronjobs", label: "CronJobs", type: "cronjob", kubectl: "cronjobs", icon: CalendarClock, group: "Workloads" },
  { key: "hpa", label: "Autoscalers", type: "hpa", kubectl: "hpa", icon: Gauge, group: "Workloads" },
  g("replicasets", "ReplicaSets", Copy, "Workloads"),
  g("poddisruptionbudgets", "Disruption budgets", ShieldCheck, "Workloads"),
  { key: "services", label: "Services", type: "service", kubectl: "services", icon: Network, group: "Network" },
  { key: "ingresses", label: "Ingresses", type: "ingress", kubectl: "ingresses", icon: Globe, group: "Network" },
  g("gateways.gateway.networking.k8s.io", "Gateways", DoorOpen, "Network", false, true),
  g("httproutes.gateway.networking.k8s.io", "HTTP routes", Route, "Network", false, true),
  g("grpcroutes.gateway.networking.k8s.io", "gRPC routes", Split, "Network", false, true),
  g("networkpolicies", "Network policies", ShieldHalf, "Network"),
  { key: "configmaps", label: "ConfigMaps", type: "configmap", kubectl: "configmaps", icon: FileText, group: "Config" },
  { key: "secrets", label: "Secrets", type: "secret", kubectl: "secrets", icon: KeyRound, group: "Config" },
  g("resourcequotas", "Resource quotas", Scale, "Config"),
  g("limitranges", "Limit ranges", Ruler, "Config"),
  { key: "pvcs", label: "Volume claims", type: "pvc", kubectl: "pvc", icon: HardDrive, group: "Storage" },
  g("persistentvolumes", "Volumes", Cylinder, "Storage", true),
  g("storageclasses", "Storage classes", Archive, "Storage", true),
  g("serviceaccounts", "Service accounts", UserCog, "Access"),
  g("roles", "Roles", Shield, "Access"),
  g("rolebindings", "Role bindings", Link2, "Access"),
  g("clusterroles", "Cluster roles", BadgeCheck, "Access", true),
  g("clusterrolebindings", "Cluster role bindings", Link, "Access", true),
  { key: "nodes", label: "Nodes", type: "node", kubectl: "nodes", icon: Server, group: "Cluster", clusterScoped: true },
  g("namespaces", "Namespaces", Folders, "Cluster", true),
  g("events", "Events", History, "Cluster"),
  g("customresourcedefinitions", "Custom resource definitions", Puzzle, "Cluster", true),
];

const BY_KEY = new Map(RESOURCE_KINDS.map((k) => [k.key, k]));
const BY_TYPE = new Map(RESOURCE_KINDS.map((k) => [k.type, k]));

export const kindByKey = (key: string): ResourceKind | undefined => BY_KEY.get(key);
export const kindByType = (type: string): ResourceKind | undefined => BY_TYPE.get(type);

/** Link to a kind's list, optionally with a quick filter (`bad`, `restarts`). */
export function listHref(key: string, filter?: "bad" | "restarts" | null): string {
  return `/resources/${key}${filter ? `?f=${filter}` : ""}`;
}
