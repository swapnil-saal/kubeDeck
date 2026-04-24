import { Sparkles, Loader2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useAiTooltip } from "@/hooks/use-ai-tooltip";
import { useAiConfig } from "@/hooks/use-ai-config";

const UNHEALTHY_STATUSES = new Set([
  "error", "crashloopbackoff", "failed", "imagepullbackoff",
  "errimagepull", "oomkilled", "notready", "lost", "pending",
  "containercreating",
]);

interface StatusBadgeProps {
  status: string;
  resourceName?: string;
}

function AiStatusTooltipBadge({ status, resourceName }: { status: string; resourceName: string }) {
  const { suggestion, loading, triggerFetch } = useAiTooltip(resourceName, status);

  const normalized = status.toLowerCase();
  let dotColor = "bg-muted-foreground/50";
  let textColor = "text-muted-foreground";
  let bgColor = "bg-muted";

  if (["pending", "containercreating", "terminating", "waiting"].includes(normalized)) {
    dotColor = "bg-amber-500";
    textColor = "text-amber-700 dark:text-amber-400";
    bgColor = "bg-amber-500/10";
  } else {
    dotColor = "bg-red-500";
    textColor = "text-red-700 dark:text-red-400";
    bgColor = "bg-red-500/10";
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild onMouseEnter={triggerFetch}>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-help ${textColor} ${bgColor}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
            {status}
            <Sparkles className="w-2.5 h-2.5 opacity-50" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {loading ? (
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

export function StatusBadge({ status, resourceName }: StatusBadgeProps) {
  const normalized = status.toLowerCase();
  const { isFastModel } = useAiConfig();
  const isUnhealthy = UNHEALTHY_STATUSES.has(normalized);

  if (isUnhealthy && isFastModel && resourceName) {
    return <AiStatusTooltipBadge status={status} resourceName={resourceName} />;
  }

  let dotColor = "bg-muted-foreground/50";
  let textColor = "text-muted-foreground";
  let bgColor = "bg-muted";

  if (["running", "ready", "active", "succeeded", "bound", "complete", "available"].includes(normalized)) {
    dotColor = "bg-emerald-500";
    textColor = "text-emerald-700 dark:text-emerald-400";
    bgColor = "bg-emerald-500/10";
  } else if (["pending", "containercreating", "terminating", "waiting"].includes(normalized)) {
    dotColor = "bg-amber-500";
    textColor = "text-amber-700 dark:text-amber-400";
    bgColor = "bg-amber-500/10";
  } else if (isUnhealthy) {
    dotColor = "bg-red-500";
    textColor = "text-red-700 dark:text-red-400";
    bgColor = "bg-red-500/10";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${textColor} ${bgColor}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {status}
    </span>
  );
}
