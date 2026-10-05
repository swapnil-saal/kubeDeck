import type { FC } from "react";
import { Loader2, RefreshCw, ServerCrash } from "lucide-react";

/** Shown when the selected cluster cannot be reached at all (VPN off, cluster down). */
export const ConnectionGate: FC<{
  context: string;
  retrying: boolean;
  onRetry: () => void;
  otherContexts: string[];
  onSwitch: (context: string) => void;
  detail?: string;
}> = ({ context, retrying, onRetry, otherContexts, onSwitch, detail }) => (
  <div className="rounded-xl border border-destructive/25 bg-destructive/[0.05] p-5" role="alert">
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
        <ServerCrash className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-foreground">Can't reach <span className="font-mono">{context}</span></h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          KubeDeck couldn't connect to this cluster's API server. This usually means you're off the VPN, offline, or the cluster is down.
          Nothing is shown as healthy because nothing could be checked.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {retrying ? "Trying…" : "Try again"}
          </button>
          {otherContexts.length > 0 && <span className="text-xs text-muted-foreground">or open</span>}
          {otherContexts.slice(0, 4).map((c) => (
            <button key={c} type="button" onClick={() => onSwitch(c)} className="rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10">
              {c}
            </button>
          ))}
        </div>
        {detail && <p className="mt-3 truncate font-mono text-[10px] text-muted-foreground/70" title={detail}>{detail}</p>}
      </div>
    </div>
  </div>
);
