import { forwardRef, useState, type ButtonHTMLAttributes, type FC, type ReactNode } from "react";
import { CheckCircle2, CircleSlash, HelpCircle, Loader2, ShieldAlert, ShieldX, XCircle, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOOL_STATE_UI, type ToolState } from "./tool-state";

/** Small square icon button used in action bars. Forwards its ref so primitives can use it `asChild`. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      {...props}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-lg",
        "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        className,
      )}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = "IconButton";

/** Copy text to the clipboard and flag success for 1.5 s. */
export function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: nothing to do
    }
  };
  return { copied, copy };
}

const STATE_ICON: Record<ToolState, ReactNode> = {
  running: <Loader2 className="h-3 w-3 animate-spin" />,
  done: <CheckCircle2 className="h-3 w-3" />,
  error: <XCircle className="h-3 w-3" />,
  approval: <ShieldAlert className="h-3 w-3" />,
  denied: <CircleSlash className="h-3 w-3" />,
  blocked: <ShieldX className="h-3 w-3" />,
  question: <HelpCircle className="h-3 w-3" />,
  stopped: <Ban className="h-3 w-3" />,
};

/** Status pill for a tool call: icon + words, never colour alone. */
export const StateChip: FC<{ state: ToolState; detail?: string; className?: string }> = ({ state, detail, className }) => {
  const ui = TOOL_STATE_UI[state];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
        ui.chip,
        className,
      )}
    >
      {STATE_ICON[state]}
      {ui.label}
      {detail && <span className="font-normal opacity-80">· {detail}</span>}
    </span>
  );
};
