import type { ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useAiTooltip } from "@/ai/hooks/use-ai-tooltip";

export interface AiStatusHintProps {
  resource: string;
  status: string;
  /** the badge the tooltip attaches to; must accept a ref (a DOM element) */
  children: ReactElement;
}

/** Wraps a status badge: hovering asks the AI why the resource is in that status and how to fix it. */
export default function AiStatusHint({ resource, status, children }: AiStatusHintProps) {
  const { suggestion, loading, triggerFetch } = useAiTooltip(resource, status);
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild onMouseEnter={triggerFetch} onFocus={triggerFetch}>
          {children}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {loading && !suggestion ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Analyzing...
            </span>
          ) : suggestion ? (
            <span>{suggestion}</span>
          ) : (
            <span className="text-muted-foreground">Hover to get AI insight</span>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
