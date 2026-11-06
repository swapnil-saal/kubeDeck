import { useState, useCallback, useRef, useEffect } from "react";
import { Copy, Check, Terminal, ChevronLeft, ChevronRight } from "lucide-react";

interface CommandBarProps {
  commands: CommandEntry[];
}

export interface CommandEntry {
  label: string;
  cmd: string;
}

export function CommandBar({ commands }: CommandBarProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setActiveIdx(0); }, [commands]);

  const current = commands[activeIdx] || commands[0];
  if (!current) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(current.cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-0 h-7 border-t border-border/50 bg-card/50 backdrop-blur shrink-0 overflow-hidden pr-28">
      <div className="flex items-center gap-1 px-2 h-full border-r border-border/50 bg-secondary/40 shrink-0">
        <Terminal className="w-2.5 h-2.5 text-muted-foreground/60" />
      </div>

      {commands.length > 1 && (
        <div ref={scrollRef} className="flex items-center h-full border-r border-border/50 shrink-0">
          {commands.map((c, i) => (
            <button
              key={i}
              onClick={() => { setActiveIdx(i); setCopied(false); }}
              className={`px-2 h-full text-[10px] uppercase tracking-widest font-semibold transition-colors whitespace-nowrap ${
                i === activeIdx
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/50"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-w-0 px-2 flex items-center gap-1.5">
        <code className="text-[10px] text-muted-foreground truncate font-mono select-all">
          {current.cmd}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 p-1 rounded-md hover:bg-secondary text-muted-foreground/50 hover:text-foreground transition-colors"
          title="Copy command"
        >
          {copied ? (
            <Check className="w-3 h-3 text-emerald-400" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </div>
    </div>
  );
}

export function buildListCommands(
  resource: string,
  context: string,
  namespace: string,
): CommandEntry[] {
  const ctx = context ? ` --context=${context}` : "";
  const ns = namespace && namespace !== "all" ? ` -n ${namespace}` : " -A";
  return [
    { label: "GET", cmd: `kubectl get ${resource}${ctx}${ns}` },
    { label: "WATCH", cmd: `kubectl get ${resource}${ctx}${ns} -w` },
    { label: "WIDE", cmd: `kubectl get ${resource}${ctx}${ns} -o wide` },
    { label: "YAML", cmd: `kubectl get ${resource}${ctx}${ns} -o yaml` },
  ];
}

/** What the account may do to this resource; commands it may not run are left out. */
export interface DetailPermissions { patch: boolean; delete: boolean; exec: boolean }

/** A command and the permission it needs, if any. */
type Gated = CommandEntry & { needs?: keyof DetailPermissions };

/** The commands one kind adds, each with the permission it needs. */
function kindCommands(type: string, name: string, ctx: string, ns: string): Gated[] {
  switch (type) {
    case "pod":
      return [
        { label: "LOGS", cmd: `kubectl logs ${name}${ctx}${ns} --tail=100` },
        { label: "LOGS -f", cmd: `kubectl logs -f ${name}${ctx}${ns}` },
        { label: "EXEC", cmd: `kubectl exec -it ${name}${ctx}${ns} -- /bin/sh`, needs: "exec" },
      ];
    case "deployment":
      return [
        { label: "LOGS", cmd: `kubectl logs deployment/${name}${ctx}${ns} --all-containers --prefix --tail=100` },
        { label: "RESTART", cmd: `kubectl rollout restart deployment/${name}${ctx}${ns}`, needs: "patch" },
        { label: "STATUS", cmd: `kubectl rollout status deployment/${name}${ctx}${ns}` },
        { label: "HISTORY", cmd: `kubectl rollout history deployment/${name}${ctx}${ns}` },
        { label: "SCALE", cmd: `kubectl scale deployment/${name}${ctx}${ns} --replicas=3`, needs: "patch" },
      ];
    case "statefulset":
      return [
        { label: "RESTART", cmd: `kubectl rollout restart statefulset/${name}${ctx}${ns}`, needs: "patch" },
        { label: "SCALE", cmd: `kubectl scale statefulset/${name}${ctx}${ns} --replicas=3`, needs: "patch" },
      ];
    case "service":
      return [{ label: "ENDPOINTS", cmd: `kubectl get endpoints ${name}${ctx}${ns}` }];
    case "node":
      return [
        { label: "TOP", cmd: `kubectl top node ${name}${ctx}` },
        { label: "CORDON", cmd: `kubectl cordon ${name}${ctx}`, needs: "patch" },
        { label: "DRAIN", cmd: `kubectl drain ${name}${ctx} --ignore-daemonsets --delete-emptydir-data`, needs: "patch" },
      ];
    default:
      return [];
  }
}

export function buildDetailCommands(
  type: string,
  name: string,
  context: string,
  namespace: string,
  _activeTab?: string,
  can: DetailPermissions = { patch: true, delete: true, exec: true },
): CommandEntry[] {
  const ctx = context ? ` --context=${context}` : "";
  const ns = namespace && namespace !== "all" ? ` -n ${namespace}` : "";
  const all: Gated[] = [
    { label: "DESCRIBE", cmd: `kubectl describe ${type} ${name}${ctx}${ns}` },
    { label: "GET YAML", cmd: `kubectl get ${type} ${name}${ctx}${ns} -o yaml` },
    { label: "GET JSON", cmd: `kubectl get ${type} ${name}${ctx}${ns} -o json` },
    ...kindCommands(type, name, ctx, ns),
    { label: "EVENTS", cmd: `kubectl get events${ctx}${ns} --field-selector involvedObject.name=${name}` },
    { label: "DELETE", cmd: `kubectl delete ${type} ${name}${ctx}${ns}`, needs: "delete" },
  ];
  return all.filter((c) => !c.needs || can[c.needs]).map(({ needs: _needs, ...c }) => c);
}
