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
    <div className="flex items-center gap-0 h-7 border-t border-border bg-surface-inset/80 shrink-0 overflow-hidden pr-28">
      <div className="flex items-center gap-1 px-2 h-full border-r border-border bg-foreground/[0.02] shrink-0">
        <Terminal className="w-2.5 h-2.5 text-muted-foreground/60" />
      </div>

      {commands.length > 1 && (
        <div ref={scrollRef} className="flex items-center h-full border-r border-border shrink-0">
          {commands.map((c, i) => (
            <button
              key={i}
              onClick={() => { setActiveIdx(i); setCopied(false); }}
              className={`px-2 h-full text-[8px] uppercase tracking-[0.15em] font-bold transition-colors whitespace-nowrap ${
                i === activeIdx
                  ? "text-foreground bg-foreground/[0.05]"
                  : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-foreground/[0.02]"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-w-0 px-2 flex items-center gap-1.5">
        <code className="text-[10px] text-foreground/70 truncate font-mono select-all">
          {current.cmd}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 p-1 rounded hover:bg-foreground/8 text-muted-foreground/50 hover:text-foreground transition-colors"
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

export function buildDetailCommands(
  type: string,
  name: string,
  context: string,
  namespace: string,
  activeTab?: string,
): CommandEntry[] {
  const ctx = context ? ` --context=${context}` : "";
  const ns = namespace && namespace !== "all" ? ` -n ${namespace}` : "";

  const cmds: CommandEntry[] = [
    { label: "DESCRIBE", cmd: `kubectl describe ${type} ${name}${ctx}${ns}` },
    { label: "GET YAML", cmd: `kubectl get ${type} ${name}${ctx}${ns} -o yaml` },
    { label: "GET JSON", cmd: `kubectl get ${type} ${name}${ctx}${ns} -o json` },
  ];

  if (type === "pod") {
    cmds.push(
      { label: "LOGS", cmd: `kubectl logs ${name}${ctx}${ns} --tail=100` },
      { label: "LOGS -f", cmd: `kubectl logs -f ${name}${ctx}${ns}` },
      { label: "EXEC", cmd: `kubectl exec -it ${name}${ctx}${ns} -- /bin/sh` },
    );
  }

  if (type === "deployment") {
    cmds.push(
      { label: "LOGS", cmd: `kubectl logs deployment/${name}${ctx}${ns} --all-containers --prefix --tail=100` },
      { label: "RESTART", cmd: `kubectl rollout restart deployment/${name}${ctx}${ns}` },
      { label: "STATUS", cmd: `kubectl rollout status deployment/${name}${ctx}${ns}` },
      { label: "HISTORY", cmd: `kubectl rollout history deployment/${name}${ctx}${ns}` },
      { label: "SCALE", cmd: `kubectl scale deployment/${name}${ctx}${ns} --replicas=3` },
    );
  }

  if (type === "statefulset") {
    cmds.push(
      { label: "RESTART", cmd: `kubectl rollout restart statefulset/${name}${ctx}${ns}` },
      { label: "SCALE", cmd: `kubectl scale statefulset/${name}${ctx}${ns} --replicas=3` },
    );
  }

  if (type === "service") {
    cmds.push(
      { label: "ENDPOINTS", cmd: `kubectl get endpoints ${name}${ctx}${ns}` },
    );
  }

  if (type === "node") {
    cmds.push(
      { label: "TOP", cmd: `kubectl top node ${name}${ctx}` },
      { label: "CORDON", cmd: `kubectl cordon ${name}${ctx}` },
      { label: "DRAIN", cmd: `kubectl drain ${name}${ctx} --ignore-daemonsets --delete-emptydir-data` },
    );
  }

  cmds.push(
    { label: "EVENTS", cmd: `kubectl get events${ctx}${ns} --field-selector involvedObject.name=${name}` },
    { label: "DELETE", cmd: `kubectl delete ${type} ${name}${ctx}${ns}` },
  );

  return cmds;
}
