/**
 * Which MCP tools only read. KubeDeck decides this itself, from the tool's name and the server's own
 * annotations, and a tool that might change something is never treated as a read:
 *
 * - a server that marks a tool destructive, or not read-only, is believed;
 * - the name's words are checked: a write word anywhere (create, update, delete, run…) rules it out;
 * - then it reads when its first word is a read verb (get, list, search…), or the server marks it
 *   read-only, or the server's own rule names it.
 *
 * Names split on `_`, `-`, `.`, `/` and camelCase, so `list_pods`, `list-pods` and `listPods` agree.
 */

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

/** Extra knowledge about one server's tools (Grafana's): names that read although no verb says so, names that never do. */
export interface ReadRule {
  readNames?: RegExp;
  never?: RegExp;
}

const READ_VERBS = new Set([
  "get", "list", "search", "query", "find", "read", "fetch", "describe", "show", "view", "analyze", "diff", "check", "count",
  "lookup", "inspect", "explain", "summarize", "browse", "retrieve",
]);

const WRITE_WORDS = new Set([
  "create", "update", "delete", "remove", "write", "patch", "put", "post", "set", "add", "insert", "upsert", "drop", "install",
  "uninstall", "manage", "apply", "exec", "execute", "run", "deploy", "restart", "scale", "send", "push", "merge", "move",
  "rename", "upload", "kill", "terminate", "approve", "cancel", "close", "archive", "edit", "modify", "replace", "enable",
  "disable", "assign", "unassign", "invite", "publish", "trigger", "start", "stop", "reset", "revoke", "grant", "transfer",
  "commit", "comment", "reply", "mutate", "import", "restore", "rollback", "sync", "submit", "resolve", "acknowledge", "ack",
  "silence", "mute", "unmute", "pause", "resume", "rotate", "purge", "clear", "destroy", "provision",
]);

/** A tool name's words, lower case: `listPods` and `list-pods` → ["list", "pods"]. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-./:]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

/** Whether a tool only reads, by its name, the server's annotations and an optional server-specific rule. */
export function isReadTool(t: { name: string; annotations?: McpToolAnnotations }, rule: ReadRule = {}): boolean {
  if (t.annotations?.destructiveHint === true) return false;
  if (t.annotations?.readOnlyHint === false) return false;
  if (rule.never?.test(t.name)) return false;
  const words = nameWords(t.name);
  if (words.some((w) => WRITE_WORDS.has(w))) return false;
  return READ_VERBS.has(words[0] ?? "") || t.annotations?.readOnlyHint === true || !!rule.readNames?.test(t.name);
}
