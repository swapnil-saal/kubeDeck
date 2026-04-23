import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Command, Search, Copy, Check, Terminal, ArrowRight, Sparkles } from "lucide-react";
import { useTerminalStore } from "@/hooks/use-terminal-store";

interface MatchedCommand {
  description: string;
  command: string;
  confidence: number;
}

interface Pattern {
  triggers: RegExp[];
  build: (match: RegExpMatchArray | null, ctx: string, ns: string) => MatchedCommand;
}

function buildCtx(ctx: string) { return ctx ? ` --context=${ctx}` : ""; }
function buildNs(ns: string) { return ns && ns !== "all" ? ` -n ${ns}` : ""; }

const PATTERNS: Pattern[] = [
  // pods with restarts
  {
    triggers: [/pods?\s+(?:with\s+)?(?:more\s+than\s+)?(\d+)\s*\+?\s*restarts?/i, /restarts?\s*(?:>\s*|more\s+than\s+|above\s+|over\s+)(\d+)/i],
    build: (m, ctx, ns) => ({
      description: `Pods with more than ${m?.[1] || "0"} restarts`,
      command: `kubectl get pods${buildCtx(ctx)}${buildNs(ns)} -o json | jq '.items[] | select(.status.containerStatuses[]?.restartCount > ${m?.[1] || "0"}) | .metadata.name'`,
      confidence: 0.9,
    }),
  },
  // crashloopbackoff / crashing pods
  {
    triggers: [/crash(?:ing|loop|loopbackoff)?/i, /failing\s*pods?/i, /broken\s*pods?/i, /errored?\s*pods?/i, /unhealthy\s*pods?/i],
    build: (_, ctx, ns) => ({
      description: "Pods in CrashLoopBackOff or Error state",
      command: `kubectl get pods${buildCtx(ctx)}${buildNs(ns)} --field-selector=status.phase!=Running,status.phase!=Succeeded`,
      confidence: 0.85,
    }),
  },
  // pod logs
  {
    triggers: [/logs?\s+(?:for\s+|of\s+|from\s+)?(?:pod\s+)?(\S+)/i, /show\s+(?:me\s+)?logs?\s+(?:for\s+|of\s+)?(\S+)/i],
    build: (m, ctx, ns) => {
      const name = m?.[1] || m?.[2] || "<pod-name>";
      return {
        description: `Stream logs from ${name}`,
        command: `kubectl logs -f ${name}${buildCtx(ctx)}${buildNs(ns)}`,
        confidence: 0.8,
      };
    },
  },
  // exec into pod
  {
    triggers: [/exec\s+(?:into\s+)?(\S+)/i, /shell\s+(?:into\s+)?(\S+)/i, /ssh\s+(?:into\s+)?(\S+)/i, /connect\s+(?:to\s+)?(\S+)/i],
    build: (m, ctx, ns) => ({
      description: `Exec into ${m?.[1] || "<pod>"}`,
      command: `kubectl exec -it ${m?.[1] || "<pod-name>"}${buildCtx(ctx)}${buildNs(ns)} -- /bin/sh`,
      confidence: 0.85,
    }),
  },
  // scale deployment
  {
    triggers: [/scale\s+(?:deployment\s+)?(\S+)\s+(?:to\s+)?(\d+)/i, /set\s+replicas?\s+(?:for\s+)?(\S+)\s+(?:to\s+)?(\d+)/i],
    build: (m, ctx, ns) => ({
      description: `Scale ${m?.[1]} to ${m?.[2]} replicas`,
      command: `kubectl scale deployment/${m?.[1]}${buildCtx(ctx)}${buildNs(ns)} --replicas=${m?.[2]}`,
      confidence: 0.9,
    }),
  },
  // restart deployment
  {
    triggers: [/restart\s+(?:deployment\s+)?(\S+)/i, /rolling\s+restart\s+(\S+)/i, /redeploy\s+(\S+)/i],
    build: (m, ctx, ns) => ({
      description: `Rolling restart of ${m?.[1]}`,
      command: `kubectl rollout restart deployment/${m?.[1]}${buildCtx(ctx)}${buildNs(ns)}`,
      confidence: 0.85,
    }),
  },
  // rollout status
  {
    triggers: [/rollout\s+status\s+(?:for\s+)?(\S+)/i, /deployment\s+status\s+(?:of\s+)?(\S+)/i],
    build: (m, ctx, ns) => ({
      description: `Rollout status of ${m?.[1]}`,
      command: `kubectl rollout status deployment/${m?.[1]}${buildCtx(ctx)}${buildNs(ns)}`,
      confidence: 0.85,
    }),
  },
  // top / resource usage
  {
    triggers: [/(?:top|cpu|memory|usage|resource)\s*(?:for\s+)?(?:pods?|containers?)/i, /which\s+pods?\s+(?:are\s+)?(?:using|consuming)\s+(?:the\s+)?most/i, /highest\s+(?:cpu|memory)/i],
    build: (_, ctx, ns) => ({
      description: "Top pods by resource usage",
      command: `kubectl top pods${buildCtx(ctx)}${buildNs(ns)} --sort-by=cpu`,
      confidence: 0.85,
    }),
  },
  {
    triggers: [/(?:top|cpu|memory|usage|resource)\s*(?:for\s+)?nodes?/i, /node\s+(?:cpu|memory|usage)/i],
    build: (_, ctx, _ns) => ({
      description: "Top nodes by resource usage",
      command: `kubectl top nodes${buildCtx(ctx)}`,
      confidence: 0.85,
    }),
  },
  // events
  {
    triggers: [/events?\s*(?:in\s+|for\s+)?(?:namespace\s+)?/i, /show\s+(?:me\s+)?events/i, /what.?s\s+happening/i, /recent\s+events/i],
    build: (_, ctx, ns) => ({
      description: "Recent cluster events",
      command: `kubectl get events${buildCtx(ctx)}${buildNs(ns)} --sort-by='.lastTimestamp'`,
      confidence: 0.7,
    }),
  },
  // delete pod
  {
    triggers: [/delete\s+pod\s+(\S+)/i, /remove\s+pod\s+(\S+)/i, /kill\s+pod\s+(\S+)/i],
    build: (m, ctx, ns) => ({
      description: `Delete pod ${m?.[1]}`,
      command: `kubectl delete pod ${m?.[1]}${buildCtx(ctx)}${buildNs(ns)}`,
      confidence: 0.9,
    }),
  },
  // get by resource type
  {
    triggers: [/(?:show|list|get|find)\s+(?:me\s+)?(?:all\s+)?(pods?|deployments?|services?|ingress(?:es)?|configmaps?|secrets?|nodes?|jobs?|cronjobs?|statefulsets?|daemonsets?|hpa|pvcs?)/i],
    build: (m, ctx, ns) => {
      const raw = m?.[1]?.toLowerCase() || "pods";
      const resource = raw.endsWith("s") ? raw : raw + "s";
      return {
        description: `List ${resource}`,
        command: `kubectl get ${resource}${buildCtx(ctx)}${buildNs(ns)}`,
        confidence: 0.75,
      };
    },
  },
  // describe a resource
  {
    triggers: [/describe\s+(pod|deployment|service|ingress|configmap|secret|node|job|cronjob|statefulset|daemonset|hpa|pvc)\s+(\S+)/i],
    build: (m, ctx, ns) => ({
      description: `Describe ${m?.[1]} ${m?.[2]}`,
      command: `kubectl describe ${m?.[1]} ${m?.[2]}${buildCtx(ctx)}${buildNs(ns)}`,
      confidence: 0.9,
    }),
  },
  // port forward
  {
    triggers: [/port[\s-]?forward\s+(\S+)\s+(\d+)(?::(\d+))?/i, /forward\s+(?:port\s+)?(\d+)\s+(?:to\s+)?(\S+)/i],
    build: (m, ctx, ns) => {
      const name = m?.[1] || "<pod>";
      const local = m?.[2] || "8080";
      const remote = m?.[3] || local;
      return {
        description: `Port forward ${name} ${local}:${remote}`,
        command: `kubectl port-forward ${name}${buildCtx(ctx)}${buildNs(ns)} ${local}:${remote}`,
        confidence: 0.85,
      };
    },
  },
  // apply / create
  {
    triggers: [/apply\s+(?:from\s+)?(\S+)/i],
    build: (m, ctx, ns) => ({
      description: `Apply manifest from ${m?.[1]}`,
      command: `kubectl apply -f ${m?.[1]}${buildCtx(ctx)}${buildNs(ns)}`,
      confidence: 0.85,
    }),
  },
  // namespaces
  {
    triggers: [/(?:show|list|get)\s+(?:all\s+)?namespaces?/i, /which\s+namespaces/i],
    build: (_, ctx, _ns) => ({
      description: "List all namespaces",
      command: `kubectl get namespaces${buildCtx(ctx)}`,
      confidence: 0.8,
    }),
  },
  // wide output for pods
  {
    triggers: [/pods?\s+(?:with\s+)?(?:ip|ips|node|nodes|wide|detail)/i, /where\s+(?:are\s+)?(?:my\s+)?pods?\s+running/i],
    build: (_, ctx, ns) => ({
      description: "Pods with node and IP info",
      command: `kubectl get pods${buildCtx(ctx)}${buildNs(ns)} -o wide`,
      confidence: 0.8,
    }),
  },
  // cordon / drain
  {
    triggers: [/cordon\s+(?:node\s+)?(\S+)/i],
    build: (m, ctx) => ({
      description: `Cordon node ${m?.[1]}`,
      command: `kubectl cordon ${m?.[1]}${buildCtx(ctx)}`,
      confidence: 0.9,
    }),
  },
  {
    triggers: [/drain\s+(?:node\s+)?(\S+)/i],
    build: (m, ctx) => ({
      description: `Drain node ${m?.[1]}`,
      command: `kubectl drain ${m?.[1]}${buildCtx(ctx)} --ignore-daemonsets --delete-emptydir-data`,
      confidence: 0.9,
    }),
  },
];

function matchQuery(query: string, ctx: string, ns: string): MatchedCommand[] {
  if (!query.trim()) return [];
  const results: MatchedCommand[] = [];

  for (const pattern of PATTERNS) {
    for (const trigger of pattern.triggers) {
      const match = query.match(trigger);
      if (match) {
        results.push(pattern.build(match, ctx, ns));
        break;
      }
    }
  }

  // If nothing matched, try a kubectl passthrough
  if (results.length === 0 && query.trim().startsWith("kubectl")) {
    results.push({
      description: "Run as-is",
      command: query.trim(),
      confidence: 1.0,
    });
  }

  // Deduplicate by command
  const seen = new Set<string>();
  return results.filter(r => {
    if (seen.has(r.command)) return false;
    seen.add(r.command);
    return true;
  }).sort((a, b) => b.confidence - a.confidence);
}

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

const INTERACTIVE_COMMANDS = /\b(exec|logs\s+-f|port-forward|attach|run\s+.*--stdin)\b/i;

export function KubectlPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [execState, setExecState] = useState<{ idx: number; loading: boolean; result: ExecResult | null; error: string | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const { context, namespace } = useTerminalStore();

  const results = useMemo(() => matchQuery(query, context, namespace), [query, context, namespace]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCopiedIdx(null);
      setExecState(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (execState) { setExecState(null); } else { onClose(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, execState]);

  useEffect(() => {
    if (execState?.result && outputRef.current) {
      outputRef.current.scrollTop = 0;
    }
  }, [execState?.result]);

  const handleCopy = useCallback((cmd: string, idx: number) => {
    navigator.clipboard.writeText(cmd);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  }, []);

  const handleCopyOutput = useCallback(() => {
    if (!execState?.result) return;
    const text = execState.result.stdout || execState.result.stderr;
    navigator.clipboard.writeText(text);
  }, [execState]);

  const handleExec = useCallback(async (cmd: string, idx: number) => {
    setExecState({ idx, loading: true, result: null, error: null });
    try {
      const res = await fetch("/api/kubectl/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setExecState({ idx, loading: false, result: null, error: data.message || "Execution failed" });
      } else {
        setExecState({ idx, loading: false, result: data, error: null });
      }
    } catch (err: any) {
      setExecState({ idx, loading: false, result: null, error: err.message || "Network error" });
    }
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh]" onClick={() => { if (!execState) onClose(); }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 h-12 border-b border-border">
          <Sparkles className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setExecState(null); }}
            placeholder="Describe what you want… (e.g. 'pods with more than 5 restarts')"
            className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border text-[9px] text-muted-foreground/50 font-bold">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[55vh] overflow-auto">
          {query.trim() && results.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-[11px] text-muted-foreground">No matching patterns. Try phrases like:</p>
              <div className="mt-3 space-y-1.5">
                {["show me crashing pods", "scale myapp to 5", "exec into my-pod", "pods with restarts > 3", "top pods by cpu"].map(ex => (
                  <button
                    key={ex}
                    onClick={() => setQuery(ex)}
                    className="block mx-auto text-[10px] text-foreground/60 hover:text-foreground bg-foreground/[0.03] hover:bg-foreground/[0.06] px-3 py-1 rounded-md border border-border transition-colors"
                  >
                    "{ex}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {results.map((r, i) => {
            const isInteractive = INTERACTIVE_COMMANDS.test(r.command);
            const isRunning = execState?.idx === i && execState.loading;
            const hasResult = execState?.idx === i && !execState.loading && (execState.result || execState.error);

            return (
              <div key={i}>
                <div className="group flex items-start gap-3 px-4 py-3 border-b border-border/50 hover:bg-foreground/[0.03] transition-colors">
                  <Terminal className="w-3.5 h-3.5 text-muted-foreground/60 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground mb-1">{r.description}</p>
                    <code className="text-[11px] text-foreground/80 font-mono break-all select-all">{r.command}</code>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!isInteractive && (
                      <button
                        onClick={() => handleExec(r.command, i)}
                        disabled={isRunning}
                        className="flex items-center gap-1 px-2 py-1 rounded border border-border text-[9px] uppercase font-bold tracking-wider text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] hover:border-foreground/15 transition-colors disabled:opacity-50"
                        title="Execute command"
                      >
                        {isRunning ? (
                          <div className="w-3 h-3 border border-muted-foreground/40 border-t-foreground/60 rounded-full animate-spin" />
                        ) : (
                          <ArrowRight className="w-3 h-3" />
                        )}
                        <span>{isRunning ? "Running" : "Run"}</span>
                      </button>
                    )}
                    {isInteractive && (
                      <span className="text-[8px] text-muted-foreground/50 uppercase tracking-wider px-1.5 py-0.5 rounded border border-border/50">interactive</span>
                    )}
                    <button
                      onClick={() => handleCopy(r.command, i)}
                      className="p-1.5 rounded hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy command"
                    >
                      {copiedIdx === i ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Execution output */}
                {hasResult && (
                  <div className="border-b border-border bg-surface-inset">
                    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50 bg-foreground/[0.02]">
                      <span className={`text-[9px] uppercase font-bold tracking-wider ${
                        execState!.error || (execState!.result && execState!.result.code !== 0)
                          ? "text-destructive/80" : "text-foreground/50"
                      }`}>
                        {execState!.error ? "ERROR" : execState!.result!.code === 0 ? "OUTPUT" : `EXIT ${execState!.result!.code}`}
                      </span>
                      {execState!.result && (
                        <span className="text-[9px] text-muted-foreground/50 tabular-nums">
                          {(execState!.result.stdout || execState!.result.stderr).split("\n").length} lines
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          onClick={handleCopyOutput}
                          className="px-1.5 py-0.5 rounded text-[8px] uppercase font-bold tracking-wider text-muted-foreground/60 hover:text-foreground border border-border/50 hover:bg-foreground/[0.04] transition-colors"
                        >
                          Copy output
                        </button>
                        <button
                          onClick={() => setExecState(null)}
                          className="px-1.5 py-0.5 rounded text-[8px] uppercase font-bold tracking-wider text-muted-foreground/60 hover:text-foreground border border-border/50 hover:bg-foreground/[0.04] transition-colors"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                    <pre
                      ref={outputRef}
                      className="px-4 py-3 text-[10px] leading-relaxed overflow-auto max-h-60 whitespace-pre-wrap break-all"
                    >
                      {execState!.error ? (
                        <span className="text-destructive/80">{execState!.error}</span>
                      ) : (
                        <>
                          {execState!.result!.stdout && (
                            <span className="text-foreground/70">{execState!.result!.stdout}</span>
                          )}
                          {execState!.result!.stderr && (
                            <span className="text-destructive/60">{execState!.result!.stderr}</span>
                          )}
                        </>
                      )}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer hints */}
        {!query.trim() && !execState && (
          <div className="px-4 py-4 border-t border-border/50">
            <p className="text-[10px] text-muted-foreground/60 mb-2">QUICK EXAMPLES</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                "show me crashing pods",
                "pods with more than 5 restarts",
                "top pods by cpu",
                "scale my-deployment to 3",
                "exec into my-pod",
                "logs for my-pod",
                "restart my-deployment",
                "list all services",
                "events in this namespace",
                "port-forward my-pod 8080:80",
              ].map(ex => (
                <button
                  key={ex}
                  onClick={() => setQuery(ex)}
                  className="text-left text-[10px] text-foreground/50 hover:text-foreground bg-foreground/[0.02] hover:bg-foreground/[0.05] px-2.5 py-1.5 rounded border border-border/50 transition-colors truncate"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
