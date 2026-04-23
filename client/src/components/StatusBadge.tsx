interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const normalized = status.toLowerCase();

  let dotColor = "bg-muted-foreground/40";
  let textColor = "text-muted-foreground";
  let bgColor = "bg-foreground/[0.03]";
  let borderColor = "border-border";

  if (["running", "ready", "active", "succeeded", "bound", "complete", "available"].includes(normalized)) {
    dotColor = "bg-foreground/50";
    textColor = "text-foreground/70";
    bgColor = "bg-foreground/[0.04]";
    borderColor = "border-foreground/10";
  } else if (["pending", "containercreating", "terminating", "waiting"].includes(normalized)) {
    dotColor = "bg-foreground/30";
    textColor = "text-muted-foreground";
    bgColor = "bg-foreground/[0.03]";
    borderColor = "border-border";
  } else if (["error", "crashloopbackoff", "failed", "imagepullbackoff", "errimagepull", "oomkilled", "notready", "lost"].includes(normalized)) {
    dotColor = "bg-destructive/60";
    textColor = "text-destructive/80";
    bgColor = "bg-destructive/5";
    borderColor = "border-destructive/15";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wide border ${textColor} ${bgColor} ${borderColor}`}>
      <span className={`w-1 h-1 rounded-full ${dotColor}`} />
      {status}
    </span>
  );
}
