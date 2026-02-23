interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const normalized = status.toLowerCase();
  
  let dotColor = "bg-slate-500";
  let textColor = "text-slate-400";
  let bgColor = "bg-slate-500/5";
  let borderColor = "border-slate-500/10";
  
  if (["running", "ready", "active", "succeeded", "bound", "complete", "available"].includes(normalized)) {
    dotColor = "bg-emerald-400";
    textColor = "text-emerald-400";
    bgColor = "bg-emerald-500/5";
    borderColor = "border-emerald-500/10";
  } else if (["pending", "containercreating", "terminating", "waiting"].includes(normalized)) {
    dotColor = "bg-amber-400";
    textColor = "text-amber-400";
    bgColor = "bg-amber-500/5";
    borderColor = "border-amber-500/10";
  } else if (["error", "crashloopbackoff", "failed", "imagepullbackoff", "errimagepull", "oomkilled", "notready", "lost"].includes(normalized)) {
    dotColor = "bg-red-400";
    textColor = "text-red-400";
    bgColor = "bg-red-500/5";
    borderColor = "border-red-500/10";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wide border ${textColor} ${bgColor} ${borderColor}`}>
      <span className={`w-1 h-1 rounded-full ${dotColor} ${
        ["running", "active"].includes(normalized) ? 'shadow-[0_0_4px_currentColor]' : ''
      }`} />
      {status}
    </span>
  );
}
