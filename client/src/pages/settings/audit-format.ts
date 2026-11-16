/**
 * The audit log in words: an entry's method and request path become "Scaled deployment web",
 * "Set a new password for dana@example.com" or "Ran kubectl delete pod web-1". Pure, so it is tested
 * without a browser; the page only lays the pieces out.
 */
import type { AuditEntry } from "@shared/admin";
import { ago } from "@/lib/cluster-health";

export interface AuditAction {
  /** the sentence up to its target, e.g. "Scaled deployment" */
  lead: string;
  /** what it acted on, shown in monospace: a resource name, plugin id or email */
  target?: string;
  /** words after the target, e.g. " out everywhere" */
  tail?: string;
  /** the kubectl command a palette run sent, shown in full */
  command?: string;
}

/** Looks up a user's email by id, when the page has the users list (web-mode admins). */
export type EmailOf = (id: string) => string | undefined;

type Entry = Pick<AuditEntry, "method" | "path" | "detail">;

const NODE_VERB: Record<string, string> = { cordon: "Cordoned", uncordon: "Uncordoned", drain: "Drained" };
const FALLBACK_VERB: Record<string, string> = { POST: "Called", PUT: "Updated", PATCH: "Changed", DELETE: "Deleted" };

const decode = (s: string) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

/** "Set a new password for" + the user's email, or "… for a user" when the id cannot be resolved. */
function aboutUser(lead: string, id: string, emailOf?: EmailOf, tail?: string): AuditAction {
  const email = emailOf?.(id);
  return email ? { lead, target: email, tail } : { lead: `${lead} a user${tail ?? ""}` };
}

/** Users: /api/admin/users[/:id[/password|ban|sessions]] */
function userAction(method: string, rest: string[], emailOf?: EmailOf): AuditAction | null {
  const [id, sub] = rest.map(decode);
  if (!id) return method === "POST" ? { lead: "Added a user" } : null;
  if (!sub && method === "PATCH") return aboutUser("Changed the name, role or groups of", id, emailOf);
  if (!sub && method === "DELETE") return aboutUser("Deleted", id, emailOf);
  if (sub === "password") return aboutUser("Set a new password for", id, emailOf);
  if (sub === "ban") return aboutUser("Blocked or unblocked", id, emailOf);
  if (sub === "sessions") return aboutUser("Signed", id, emailOf, " out everywhere");
  return null;
}

/** Plugins: /api/plugins[/:id[/test]] */
function pluginAction(method: string, rest: string[]): AuditAction | null {
  const [id, sub] = rest.map(decode);
  if (!id) return method === "POST" ? { lead: "Added a plugin" } : null;
  // the AI provider is kept as the "ai" plugin, but people know it as the AI settings
  if (id === "ai" && !sub && (method === "PUT" || method === "PATCH")) return { lead: "Changed the AI provider" };
  if (id === "ai" && sub === "test") return { lead: "Tested the AI provider" };
  if (sub === "test") return { lead: "Tested plugin", target: id };
  if (sub) return null;
  if (method === "PUT" || method === "PATCH") return { lead: "Changed plugin", target: id };
  if (method === "DELETE") return { lead: "Removed plugin", target: id };
  return null;
}

/** Groups: /api/groups[/:id | /order] */
function groupAction(method: string, rest: string[]): AuditAction | null {
  const [id] = rest.map(decode);
  if (!id) return method === "POST" ? { lead: "Created a group" } : null;
  if (id === "order") return { lead: "Reordered the groups" };
  if (method === "PATCH") return { lead: "Changed group", target: id };
  if (method === "DELETE") return { lead: "Deleted group", target: id };
  return null;
}

/** Projects: /api/projects[/:id | /import] */
function projectAction(method: string, rest: string[]): AuditAction | null {
  const [id] = rest.map(decode);
  if (!id) return method === "POST" ? { lead: "Created a project" } : null;
  if (id === "import") return { lead: "Moved this browser's projects to KubeDeck" };
  if (method === "PUT") return { lead: "Changed project", target: id };
  if (method === "DELETE") return { lead: "Deleted project", target: id };
  return null;
}

/** Cluster actions: /api/k8s/… */
function k8sAction(method: string, rest: string[]): AuditAction | null {
  const [kind, name, sub] = rest;
  const n = name && decode(name);
  if (kind === "apply" && !name) return { lead: "Applied YAML" };
  if (kind === "deployments" && sub === "scale") return { lead: "Scaled deployment", target: n };
  if (kind === "deployments" && sub === "restart") return { lead: "Restarted deployment", target: n };
  if (kind === "nodes" && sub && NODE_VERB[sub]) return { lead: `${NODE_VERB[sub]} node`, target: n };
  if (kind === "pods" && sub === "port-forward") return { lead: "Started a port-forward to pod", target: n };
  if (kind === "pods" && !sub && method === "DELETE") return { lead: "Deleted pod", target: n };
  if (kind === "port-forwards" && method === "DELETE") return { lead: "Stopped a port-forward" };
  return null;
}

/** The assistant: /api/ai/… */
function aiAction(rest: string[]): AuditAction | null {
  const [what, task] = rest;
  if (what === "agent") return { lead: "Asked the assistant" };
  if (what === "translate") return { lead: "Asked the assistant for a kubectl command" };
  if (what === "test") return { lead: "Tested the AI provider" };
  if (what === "tasks" && task) return { lead: "Asked the assistant to", target: decode(task) };
  return null;
}

/** What an audit entry did, in words. Anything unknown still reads as a sentence with its path. */
export function describeAudit(e: Entry, emailOf?: EmailOf): AuditAction {
  const path = e.path.split("?")[0].replace(/\/+$/, "");
  const [, api, area, ...rest] = path.split("/");
  let action: AuditAction | null = null;
  if (api === "api") {
    if (area === "kubectl" && rest[0] === "exec") {
      action = { lead: "Ran a kubectl command", ...(e.detail && { command: e.detail }) };
    } else if (area === "k8s") action = k8sAction(e.method, rest);
    else if (area === "ai") action = aiAction(rest);
    else if (area === "admin" && rest[0] === "users") action = userAction(e.method, rest.slice(1), emailOf);
    else if (area === "plugins") action = pluginAction(e.method, rest);
    else if (area === "groups") action = groupAction(e.method, rest);
    else if (area === "projects") action = projectAction(e.method, rest);
    else if (area === "settings" && rest.length === 0) action = { lead: "Changed KubeDeck's settings" };
  }
  return action ?? { lead: FALLBACK_VERB[e.method] ?? e.method, target: path.replace(/^\/api\//, "") || "/" };
}

/** The whole sentence as plain text, for titles and screen readers. */
export function auditSentence(a: AuditAction): string {
  if (a.command) return `${a.lead}: ${a.command}`;
  return `${a.lead}${a.target ? ` ${a.target}` : ""}${a.tail ?? ""}`;
}

export type AuditOutcome = "done" | "refused" | "failed";

/** 2xx/3xx done; 401/403 the cluster or KubeDeck said no; anything else failed. */
export function auditOutcome(status: number): AuditOutcome {
  if (status < 400) return "done";
  return status === 401 || status === 403 ? "refused" : "failed";
}

/** "just now", "5m ago", "3h ago", "2d ago"; a date once it is more than a week old. */
export function auditWhen(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = (now - t) / 1000;
  if (s < 60) return "just now";
  if (s > 7 * 86_400) return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${ago(iso, now)} ago`;
}

/** The exact time, for the hover title. */
export const auditExactTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
