import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const normalized = status.toLowerCase();
  
  let variant = "status-neutral";
  
  if (["running", "ready", "active", "succeeded"].includes(normalized)) {
    variant = "status-success";
  } else if (["pending", "containercreating", "terminating"].includes(normalized)) {
    variant = "status-warning";
  } else if (["error", "crashloopbackoff", "failed", "imagepullbackoff"].includes(normalized)) {
    variant = "status-error";
  }

  return (
    <span className={cn("status-badge", variant)}>
      {status}
    </span>
  );
}
