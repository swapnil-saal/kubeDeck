/**
 * Gateway API routes as a table people can read: `kubectl get httproutes -o wide` prints hostnames as
 * a JSON array and nothing about paths or backends, which is what you look a route up for.
 */
import type { GenericList } from "@shared/routes";

/** `httproutes`, `grpcroutes`, with or without their group. */
export const ROUTE_TYPE = /^(http|grpc)routes(\.gateway\.networking\.k8s\.io)?$/;

/** kubectl's short age: 45s, 12m, 5h, 84d, 2y30d. */
export function shortAge(created: string | undefined, now = Date.now()): string {
  const t = created ? Date.parse(created) : NaN;
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 120) return `${s}s`;
  if (s < 7200) return `${Math.floor(s / 60)}m`;
  if (s < 172_800) return `${Math.floor(s / 3600)}h`;
  const d = Math.floor(s / 86_400);
  return d < 730 ? `${d}d` : `${Math.floor(d / 365)}y${d % 365}d`;
}

const PATH_TYPE: Record<string, string> = { PathPrefix: "", Exact: " (exact)", RegularExpression: " (regex)" };

interface RouteMatch {
  path?: { type?: string; value?: string };
  method?: string | { service?: string; method?: string };
  headers?: unknown[];
}
interface Route {
  metadata: { name: string; namespace?: string; creationTimestamp?: string };
  spec?: {
    hostnames?: string[];
    parentRefs?: { name: string; namespace?: string; sectionName?: string }[];
    rules?: { matches?: RouteMatch[]; backendRefs?: { name: string; namespace?: string; port?: number }[] }[];
  };
  status?: { parents?: { conditions?: { type: string; status: string }[] }[] };
}

/** "/api", "/login (exact)", "GET /users", "grpc: pkg.Svc/Method" */
function matchText(m: RouteMatch): string {
  if (m.method && typeof m.method === "object") return [m.method.service, m.method.method].filter(Boolean).join("/") || "*";
  const path = m.path?.value ? `${m.path.value}${PATH_TYPE[m.path.type ?? "PathPrefix"] ?? ""}` : "/";
  return typeof m.method === "string" ? `${m.method} ${path}` : path;
}

const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))];

export function routeTable(items: Route[], allNamespaces: boolean): GenericList {
  const columns = [...(allNamespaces ? ["NAMESPACE"] : []), "NAME", "HOSTNAMES", "PATHS", "BACKENDS", "GATEWAY", "STATUS", "AGE"];
  const rows = items.map((r) => {
    const rules = r.spec?.rules ?? [];
    const conditions = (r.status?.parents ?? []).flatMap((p) => p.conditions ?? []);
    const accepted = conditions.filter((c) => c.type === "Accepted");
    const resolved = conditions.filter((c) => c.type === "ResolvedRefs");
    const status = accepted.length === 0 ? "Pending"
      : accepted.some((c) => c.status !== "True") ? "Not accepted"
      : resolved.some((c) => c.status !== "True") ? "Backend missing"
      : "Accepted";
    return [
      ...(allNamespaces ? [r.metadata.namespace ?? ""] : []),
      r.metadata.name,
      (r.spec?.hostnames ?? []).join(", ") || "*",
      unique(rules.flatMap((rule) => (rule.matches?.length ? rule.matches : [{}]).map(matchText))).join(", "),
      unique(rules.flatMap((rule) => (rule.backendRefs ?? []).map((b) => `${b.namespace ? `${b.namespace}/` : ""}${b.name}${b.port ? `:${b.port}` : ""}`))).join(", "),
      unique((r.spec?.parentRefs ?? []).map((p) => `${p.namespace ? `${p.namespace}/` : ""}${p.name}${p.sectionName ? `/${p.sectionName}` : ""}`)).join(", "),
      status,
      shortAge(r.metadata.creationTimestamp),
    ];
  });
  return { columns, rows };
}

/** A cell kubectl printed as a JSON list of strings, e.g. `["a.example.com","b.example.com"]` → "a.example.com, b.example.com". */
export function readableCell(cell: string): string {
  if (!/^\[".*"\]$/.test(cell)) return cell;
  try {
    const list = JSON.parse(cell);
    return Array.isArray(list) && list.every((x) => typeof x === "string") ? list.join(", ") : cell;
  } catch {
    return cell;
  }
}
