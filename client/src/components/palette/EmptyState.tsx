import { Activity, ArrowRight, Bug, Clock, Cpu, History, Layers, RotateCcw, ScrollText, Sparkles, Terminal, X } from "lucide-react";
import type { SmartSuggestion } from "@/hooks/use-smart-suggestions";

// ─── Empty state with smart suggestions + history ─────────────

const SMART_ICON: Record<SmartSuggestion["icon"], typeof Bug> = {
  bug: Bug,
  log: ScrollText,
  restart: RotateCcw,
  deploy: Layers,
  event: Activity,
  cpu: Cpu,
};

export function EmptyState({
  smartSuggestions, history, onPick, onRun, onClearHistory, context, namespace,
}: {
  smartSuggestions: SmartSuggestion[];
  history: { command: string; at: number }[];
  onPick: (cmd: string) => void;
  onRun: (cmd: string) => void;
  onClearHistory: () => void;
  context: string;
  namespace: string;
}) {
  const STATIC_EXAMPLES = [
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
  ];

  return (
    <div className="border-t border-border/50 max-h-[55vh] overflow-auto">
      {/* Smart suggestions — only when we have cluster data */}
      {smartSuggestions.length > 0 && (
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-3 h-3 text-primary" />
            <p className="text-[10px] uppercase font-bold tracking-wider text-primary">
              For this scope ({context}/{namespace || "all"})
            </p>
          </div>
          <div className="space-y-1">
            {smartSuggestions.map((s, i) => {
              const Icon = SMART_ICON[s.icon] || Terminal;
              return (
                <div
                  key={i}
                  className="group flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors"
                >
                  <Icon className="w-3 h-3 shrink-0 mt-0.5 text-primary/70" />
                  <button
                    onClick={() => onPick(s.command)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="text-[11px] text-foreground">{s.label}</div>
                    <div className="text-[10px] text-muted-foreground/80 truncate font-mono">{s.command}</div>
                    <div className="text-[10px] text-muted-foreground/60 italic">{s.reason}</div>
                  </button>
                  <button
                    onClick={() => onRun(s.command)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-all"
                    title="Run now"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent commands for this scope */}
      {history.length > 0 && (
        <div className="px-4 py-3 border-t border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <History className="w-3 h-3 text-muted-foreground" />
            <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
              Recent in {namespace || "all"}
            </p>
            <button
              onClick={onClearHistory}
              className="ml-auto text-[9px] text-muted-foreground/60 hover:text-foreground transition-colors flex items-center gap-1"
              title="Clear scope history"
            >
              <X className="w-2.5 h-2.5" /> clear
            </button>
          </div>
          <div className="space-y-0.5">
            {history.map((h, i) => (
              <div
                key={i}
                className="group flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/40 transition-colors"
              >
                <Clock className="w-3 h-3 shrink-0 text-muted-foreground/50" />
                <button
                  onClick={() => onPick(h.command)}
                  className="flex-1 min-w-0 text-left text-[10px] font-mono text-foreground/80 truncate"
                >
                  {h.command}
                </button>
                <button
                  onClick={() => onRun(h.command)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-all"
                  title="Run again"
                >
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Static examples — always at bottom */}
      <div className="px-4 py-3 border-t border-border/50">
        <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground/60 mb-2">Try asking</p>
        <div className="grid grid-cols-2 gap-1.5">
          {STATIC_EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => onPick(ex)}
              className="text-left text-[10px] text-foreground/50 hover:text-foreground bg-foreground/[0.02] hover:bg-foreground/[0.05] px-2.5 py-1.5 rounded border border-border/50 transition-colors truncate"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
