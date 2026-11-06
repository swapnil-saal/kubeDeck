import type { ReactNode } from "react";
import { ArrowRight, Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Commands that need a terminal: offered to copy, never run from the palette. */
export const INTERACTIVE_COMMANDS = /\b(exec|logs\s+-f|port-forward|attach|run\s+.*--stdin)\b/i;

/** One suggested command: what it does, the command (editable), Run and Copy. */
export function EditableCommand({ icon, description, command, edited, onChange, onReset, onRun, onCopy, copied, running, tone = "plain" }: {
  icon: ReactNode;
  description: ReactNode;
  command: string;
  /** the user changed the suggestion: offer Reset */
  edited: boolean;
  onChange: (cmd: string) => void;
  onReset: () => void;
  onRun: () => void;
  onCopy: () => void;
  copied: boolean;
  running: boolean;
  /** "ai": the model's translation, tinted */
  tone?: "plain" | "ai";
}) {
  const interactive = INTERACTIVE_COMMANDS.test(command);
  return (
    <div className={cn(
      "group flex flex-col gap-2 px-4 py-3 border-b transition-colors",
      tone === "ai" ? "border-primary/20 bg-primary/[0.03]" : "border-border/50 hover:bg-foreground/[0.03]",
    )}>
      <div className="flex items-center gap-3">
        {icon}
        <p className={cn("text-[10px] flex-1", tone === "ai" ? "text-primary font-medium" : "text-muted-foreground")}>{description}</p>
        <div className="flex items-center gap-1 shrink-0">
          {interactive ? (
            <span className="text-[8px] text-muted-foreground/50 uppercase tracking-wider px-1.5 py-0.5 rounded border border-border/50" title="Needs a terminal: copy it">interactive</span>
          ) : (
            <button
              type="button"
              onClick={onRun}
              disabled={running}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-primary/20 text-[10px] font-medium text-primary bg-primary/5 hover:bg-primary/10 transition-colors disabled:opacity-50"
              title="Run this command"
            >
              {running ? <div className="w-3 h-3 border border-primary/40 border-t-primary rounded-full animate-spin" /> : <ArrowRight className="w-3 h-3" />}
              <span>{running ? "Running" : "Run"}</span>
            </button>
          )}
          <button type="button" onClick={onCopy} className="p-1.5 rounded hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-colors" title="Copy command">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      <div className="relative">
        <textarea
          value={command}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !interactive) {
              e.preventDefault();
              onRun();
            }
          }}
          rows={Math.min(Math.ceil(command.length / 70) || 1, 4)}
          className={cn(
            "w-full bg-surface-inset border rounded px-3 py-2 text-[11px] text-foreground/80 font-mono resize-none focus:outline-none transition-colors leading-relaxed",
            tone === "ai" ? "border-primary/20 focus:border-primary/40" : "border-border focus:border-foreground/20",
          )}
          spellCheck={false}
        />
        {edited && (
          <button
            type="button"
            onClick={onReset}
            className="absolute top-1.5 right-1.5 text-[7px] uppercase tracking-wider font-bold text-muted-foreground/50 hover:text-foreground px-1 py-0.5 rounded border border-border/50 hover:bg-foreground/[0.04] transition-colors"
            title="Reset to the suggestion"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
