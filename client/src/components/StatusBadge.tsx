import { useServerMode } from "@/hooks/use-server-mode";
import { Sparkles } from "lucide-react";
import { AiStatusHint, useAiConfig } from "@/ai";

const UNHEALTHY_STATUSES = new Set([
  "error", "crashloopbackoff", "failed", "imagepullbackoff",
  "errimagepull", "oomkilled", "notready", "lost", "pending",
  "containercreating",
]);

interface StatusBadgeProps {
  status: string;
  resourceName?: string;
}

export function StatusBadge({ status, resourceName }: StatusBadgeProps) {
  const normalized = status.toLowerCase();
  const { isFastModel } = useAiConfig();
  const { aiEnabled } = useServerMode();
  const isUnhealthy = UNHEALTHY_STATUSES.has(normalized);

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

  const withAi = aiEnabled && isUnhealthy && isFastModel && !!resourceName;
  const badge = (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${textColor} ${bgColor} ${withAi ? "cursor-help" : ""}`}
      tabIndex={withAi ? 0 : undefined}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {status}
      {withAi && <Sparkles className="w-2.5 h-2.5 opacity-50" aria-hidden />}
    </span>
  );
  return withAi ? <AiStatusHint resource={resourceName!} status={status}>{badge}</AiStatusHint> : badge;
}
