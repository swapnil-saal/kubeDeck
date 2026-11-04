import { Share2, Square } from "lucide-react";
import { usePortForwards, useStopPortForward } from "@/hooks/use-k8s";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** Active port forwards, on every page: they keep running wherever you are in the app. */
export function PortForwardBar() {
  const { data: forwards } = usePortForwards();
  const stop = useStopPortForward();
  const { toast } = useToast();
  if (!forwards || forwards.length === 0) return null;

  return (
    <div role="region" aria-label="Port forwards" className="flex shrink-0 items-center gap-3 overflow-x-auto border-t border-border bg-card px-4 py-2">
      <Share2 className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">Forwards</span>
      <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
      {forwards.map((fwd) => {
        const dead = fwd.status === "dead" || fwd.status === "error";
        return (
          <div
            key={fwd.id}
            title={dead ? `Error: ${fwd.error || "process died"}` : `Active — ${fwd.connections || 0} connections handled`}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1",
              dead ? "border-red-500/20 bg-red-500/5" : "border-emerald-500/20 bg-emerald-500/5",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", dead ? "bg-red-500" : "bg-emerald-500")} />
            <a
              href={`http://localhost:${fwd.localPort}`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn("font-mono text-[11px] hover:underline", dead ? "text-red-500" : "text-foreground/80")}
            >
              :{fwd.localPort}
            </a>
            <span className="text-[10px] text-muted-foreground">→</span>
            <span className="font-mono text-[11px] text-muted-foreground">{fwd.pod}:{fwd.remotePort}</span>
            {dead && <span className="text-[9px] font-semibold text-red-500">DEAD</span>}
            <button
              type="button"
              onClick={async () => {
                try {
                  await stop.mutateAsync(fwd.id);
                  toast({ title: "Stopped", description: `Port forward to ${fwd.pod} stopped.` });
                } catch {
                  toast({ title: "Error", description: "Failed to stop", variant: "destructive" });
                }
              }}
              aria-label={`Stop port forward to ${fwd.pod}`}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Square className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
