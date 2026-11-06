/**
 * The palette's instant matches: common requests in plain English turned into kubectl, without a model.
 * Any name a request mentions must resolve to a resource the palette knows (exactly, or as the one
 * resource whose name contains it); otherwise the pattern stays silent and the AI translation takes
 * over, so "show me the logs of the api pod" never becomes `kubectl logs the`.
 */
export interface MatchedCommand {
  description: string;
  command: string;
  confidence: number;
}

/** What the palette knows by name: "pod" / "deployment" / "service"… → names in scope. */
export type KnownNames = (type: string) => string[];

interface Pattern {
  triggers: RegExp[];
  build: (m: RegExpMatchArray, scope: Scope) => MatchedCommand | null;
}

interface Scope {
  ctx: string;
  ns: string;
  resolve: (type: string, word: string | undefined) => string | null;
}

export function buildCtx(ctx: string) { return ctx ? ` --context=${ctx}` : ""; }
export function buildNs(ns: string) { return ns && ns !== "all" ? ` -n ${ns}` : ""; }

/** The known name `word` refers to: an exact name, or the only name containing it. */
export function resolveName(word: string | undefined, names: string[]): string | null {
  if (!word) return null;
  const w = word.toLowerCase().replace(/^["'`]|["'`.,!?]$/g, "");
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(w)) return null;
  const exact = names.find((n) => n.toLowerCase() === w);
  if (exact) return exact;
  if (w.length < 3) return null;
  const partial = [...new Set(names.filter((n) => n.toLowerCase().includes(w)))];
  return partial.length === 1 ? partial[0] : null;
}

const flags = (s: Scope) => `${buildCtx(s.ctx)}${buildNs(s.ns)}`;
/** Filler between a verb and the name: "logs for the …", "exec into my …" */
const FILL = String.raw`(?:(?:for|of|from|into|to|on|in|the|my|a|an|pod|deployment|service|me)\s+)*`;
const NAME = String.raw`([\w.-]+)`;

const PATTERNS: Pattern[] = [
  {
    triggers: [/\bpods?\s+(?:with\s+)?(?:more\s+than\s+)?(\d+)\s*\+?\s*restarts?\b/i, /\brestarts?\s*(?:>\s*|more\s+than\s+|above\s+|over\s+)(\d+)/i],
    build: (m, s) => ({
      description: `Pods with more than ${m[1]} restarts`,
      command: `kubectl get pods${flags(s)} -o json | jq '.items[] | select(.status.containerStatuses[]?.restartCount > ${m[1]}) | .metadata.name'`,
      confidence: 0.9,
    }),
  },
  {
    triggers: [/\bcrash(?:ing|loop|loopbackoff)?\b/i, /\b(?:failing|broken|errored?|unhealthy)\s+pods?\b/i],
    build: (_, s) => ({
      description: "Pods that are not running",
      command: `kubectl get pods${flags(s)} --field-selector=status.phase!=Running,status.phase!=Succeeded`,
      confidence: 0.85,
    }),
  },
  {
    triggers: [new RegExp(String.raw`\blogs?\s+${FILL}${NAME}`, "i")],
    build: (m, s) => {
      const pod = s.resolve("pod", m[1]);
      return pod ? { description: `Recent logs of ${pod}`, command: `kubectl logs ${pod}${flags(s)} --tail=200`, confidence: 0.85 } : null;
    },
  },
  {
    triggers: [new RegExp(String.raw`\b(?:exec|shell|ssh|connect)\s+${FILL}${NAME}`, "i")],
    build: (m, s) => {
      const pod = s.resolve("pod", m[1]);
      return pod ? { description: `Open a shell in ${pod}`, command: `kubectl exec -it ${pod}${flags(s)} -- /bin/sh`, confidence: 0.8 } : null;
    },
  },
  {
    triggers: [new RegExp(String.raw`\b(?:scale|set\s+replicas?\s+(?:for\s+)?)\s*${FILL}${NAME}\s+(?:deployment\s+)?(?:to\s+)?(\d+)\b`, "i")],
    build: (m, s) => {
      const d = s.resolve("deployment", m[1]);
      return d ? { description: `Scale ${d} to ${m[2]} replicas`, command: `kubectl scale deployment/${d}${flags(s)} --replicas=${m[2]}`, confidence: 0.9 } : null;
    },
  },
  {
    triggers: [new RegExp(String.raw`\b(?:rolling\s+restart|restart|redeploy)\s+${FILL}${NAME}`, "i")],
    build: (m, s) => {
      const d = s.resolve("deployment", m[1]);
      return d ? { description: `Rolling restart of ${d}`, command: `kubectl rollout restart deployment/${d}${flags(s)}`, confidence: 0.85 } : null;
    },
  },
  {
    triggers: [new RegExp(String.raw`\b(?:rollout|deployment)\s+status\s+${FILL}${NAME}`, "i")],
    build: (m, s) => {
      const d = s.resolve("deployment", m[1]);
      return d ? { description: `Rollout status of ${d}`, command: `kubectl rollout status deployment/${d}${flags(s)}`, confidence: 0.85 } : null;
    },
  },
  {
    triggers: [/\b(?:top|cpu|memory|usage)\b\s*(?:for\s+)?(?:pods?|containers?)\b/i, /\bwhich\s+pods?\s+(?:are\s+)?(?:using|consuming)\s+(?:the\s+)?most\b/i, /\bhighest\s+(?:cpu|memory)\b/i],
    build: (_, s) => ({ description: "Pods by CPU use", command: `kubectl top pods${flags(s)} --sort-by=cpu`, confidence: 0.85 }),
  },
  {
    triggers: [/\b(?:top|cpu|memory|usage)\b\s*(?:for\s+)?nodes?\b/i, /\bnode\s+(?:cpu|memory|usage)\b/i],
    build: (_, s) => ({ description: "Nodes by resource use", command: `kubectl top nodes${buildCtx(s.ctx)}`, confidence: 0.85 }),
  },
  {
    triggers: [/\b(?:recent\s+)?events\b/i, /\bwhat.?s\s+happening\b/i],
    build: (_, s) => ({ description: "Recent events", command: `kubectl get events${flags(s)} --sort-by=.lastTimestamp`, confidence: 0.8 }),
  },
  {
    triggers: [new RegExp(String.raw`\b(?:delete|remove|kill)\s+pod\s+${NAME}`, "i")],
    build: (m, s) => {
      const pod = s.resolve("pod", m[1]);
      return pod ? { description: `Delete pod ${pod} (its controller usually replaces it)`, command: `kubectl delete pod ${pod}${flags(s)}`, confidence: 0.85 } : null;
    },
  },
  {
    triggers: [/\b(?:show|list|get|find)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?(pods?|deployments?|services?|ingress(?:es)?|configmaps?|secrets?|nodes?|jobs?|cronjobs?|statefulsets?|daemonsets?|hpa|pvcs?)\b/i],
    build: (m, s) => {
      const raw = m[1].toLowerCase();
      const resource = raw.endsWith("s") || raw === "hpa" ? raw : `${raw}s`;
      const clusterWide = resource === "nodes";
      return { description: `List ${resource}`, command: `kubectl get ${resource}${clusterWide ? buildCtx(s.ctx) : flags(s)}`, confidence: 0.75 };
    },
  },
  {
    triggers: [new RegExp(String.raw`\bdescribe\s+(pod|deployment|service|ingress|configmap|secret|job|cronjob|statefulset|daemonset)\s+${NAME}`, "i")],
    build: (m, s) => {
      const type = m[1].toLowerCase();
      const name = s.resolve(type, m[2]);
      return name ? { description: `Describe ${type} ${name}`, command: `kubectl describe ${type} ${name}${flags(s)}`, confidence: 0.9 } : null;
    },
  },
  {
    triggers: [new RegExp(String.raw`\bport[\s-]?forward\s+${FILL}${NAME}\s+(\d+)(?::(\d+))?`, "i")],
    build: (m, s) => {
      const pod = s.resolve("pod", m[1]);
      const local = m[2];
      return pod ? { description: `Forward localhost:${local} to ${pod}`, command: `kubectl port-forward ${pod}${flags(s)} ${local}:${m[3] || local}`, confidence: 0.8 } : null;
    },
  },
  {
    triggers: [/\b(?:show|list|get)\s+(?:all\s+)?namespaces?\b/i, /\bwhich\s+namespaces\b/i],
    build: (_, s) => ({ description: "List namespaces", command: `kubectl get namespaces${buildCtx(s.ctx)}`, confidence: 0.8 }),
  },
  {
    triggers: [/\bpods?\s+(?:with\s+)?(?:ips?|nodes?|wide|details?)\b/i, /\bwhere\s+(?:are\s+)?(?:my\s+)?pods?\s+running\b/i],
    build: (_, s) => ({ description: "Pods with node and IP", command: `kubectl get pods${flags(s)} -o wide`, confidence: 0.8 }),
  },
];

/** Every instant match for a query, most confident first; `known` lists the names in scope per type. */
export function matchQuery(query: string, ctx: string, ns: string, known: KnownNames = () => []): MatchedCommand[] {
  const q = query.trim();
  if (!q) return [];
  if (q.startsWith("kubectl")) return [{ description: "Run as typed", command: q, confidence: 1 }];
  const scope: Scope = { ctx, ns, resolve: (type, word) => resolveName(word, known(type)) };
  const results: MatchedCommand[] = [];
  for (const pattern of PATTERNS) {
    for (const trigger of pattern.triggers) {
      const m = q.match(trigger);
      if (!m) continue;
      const built = pattern.build(m, scope);
      if (built) results.push(built);
      break;
    }
  }
  const seen = new Set<string>();
  return results.filter((r) => !seen.has(r.command) && seen.add(r.command)).sort((a, b) => b.confidence - a.confidence);
}
