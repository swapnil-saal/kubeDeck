import { useState, type FC } from "react";
import type { ReasoningMessagePartProps } from "@assistant-ui/react";
import { Brain, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The model's reasoning (reasoning models only), folded away by default.
 * Open while it streams so the user sees the agent think; it folds once the answer starts.
 */
export const Reasoning: FC<ReasoningMessagePartProps> = ({ text, status }) => {
  const streaming = status.type === "running";
  const [pinned, setPinned] = useState<boolean | null>(null);
  const open = pinned ?? streaming;
  if (!text.trim()) return null;

  return (
    <div className="my-1.5 rounded-lg border border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={() => setPinned(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <Brain className={cn("h-3.5 w-3.5", streaming && "text-primary motion-safe:animate-pulse")} />
        {streaming ? "Thinking…" : "Thought process"}
        <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <p className="max-h-60 overflow-auto whitespace-pre-wrap border-t border-border/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {text}
        </p>
      )}
    </div>
  );
};
