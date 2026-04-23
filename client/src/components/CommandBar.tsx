import { useState, useCallback } from "react";
import { Copy, Check, Terminal } from "lucide-react";

interface CommandBarProps {
  command: string;
}

export function CommandBar({ command }: CommandBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [command]);

  if (!command) return null;

  return (
    <div className="flex items-center gap-0 h-8 border-t border-border bg-surface-inset/80 shrink-0 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 h-full border-r border-border bg-foreground/[0.02]">
        <Terminal className="w-3 h-3 text-muted-foreground/60" />
        <span className="text-[8px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 select-none">CMD</span>
      </div>
      <div className="flex-1 min-w-0 px-3 flex items-center">
        <code className="text-[10px] text-foreground/70 truncate font-mono select-all">
          {command}
        </code>
      </div>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1.5 h-full px-3 border-l border-border text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
        title="Copy command"
      >
        {copied ? (
          <>
            <Check className="w-3 h-3 text-emerald-400" />
            <span className="text-[9px] font-bold text-emerald-400">Copied</span>
          </>
        ) : (
          <>
            <Copy className="w-3 h-3" />
            <span className="text-[9px] font-bold">Copy</span>
          </>
        )}
      </button>
    </div>
  );
}

export function buildKubectlCommand(
  resource: string,
  context: string,
  namespace: string,
  extra?: string,
): string {
  const parts = ["kubectl get", resource];
  if (context) parts.push(`--context=${context}`);
  if (namespace && namespace !== "all") {
    parts.push(`-n ${namespace}`);
  } else {
    parts.push("-A");
  }
  if (extra) parts.push(extra);
  return parts.join(" ");
}

export function buildDescribeCommand(
  type: string,
  name: string,
  context: string,
  namespace: string,
): string {
  const parts = ["kubectl describe", type, name];
  if (context) parts.push(`--context=${context}`);
  if (namespace && namespace !== "all") parts.push(`-n ${namespace}`);
  return parts.join(" ");
}
