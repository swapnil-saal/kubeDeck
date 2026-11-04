import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/** "Refresh now" plus the live indicator. Refreshing re-reads every cluster list on screen. */
export function LiveRefresh() {
  const queryClient = useQueryClient();
  const [spinning, setSpinning] = useState(false);
  const refresh = async () => {
    setSpinning(true);
    await queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/k8s") });
    setSpinning(false);
  };
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={refresh}
        aria-label="Refresh"
        title="Refresh now"
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary"
      >
        <RefreshCw size={15} className={cn(spinning && "animate-spin")} />
      </button>
      <span
        className="hidden items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 sm:flex"
        title="Refreshes automatically every 10s"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Live
      </span>
    </div>
  );
}
