import type { FC } from "react";
import { Clock, Pin, X } from "lucide-react";
import { usePins } from "@/hooks/use-pins";
import type { ResourceRef } from "@/lib/pins";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  pod: "pod", deployment: "deploy", service: "svc", statefulset: "sts", daemonset: "ds",
  job: "job", cronjob: "cron", configmap: "cm", secret: "secret", ingress: "ing", node: "node",
};

/** Quick jump to what you pinned and what you opened lately (this cluster only). */
export const PinnedRecent: FC<{ context: string; onOpen: (ref: ResourceRef) => void }> = ({ context, onOpen }) => {
  const { pins, recents, toggle } = usePins(context);
  if (pins.length === 0 && recents.length === 0) return null;

  const chip = (ref: ResourceRef, pinned: boolean) => (
    <span key={`${pinned}-${ref.type}-${ref.namespace}-${ref.name}`} className="group inline-flex max-w-[16rem] items-center rounded-lg border border-border bg-card/60 text-xs transition-colors hover:border-primary/40">
      <button type="button" onClick={() => onOpen(ref)} className="flex min-w-0 items-center gap-1.5 py-1.5 pl-2.5 pr-2" title={`${ref.type} ${ref.name} · ${ref.namespace}`}>
        <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] font-semibold uppercase text-muted-foreground">{TYPE_LABEL[ref.type] ?? ref.type}</span>
        <span className="truncate font-mono text-foreground">{ref.name}</span>
      </button>
      {pinned && (
        <button type="button" onClick={() => toggle(ref)} aria-label={`Unpin ${ref.name}`} className="pr-2 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Pinned and recent resources">
      {pins.length > 0 && <Pin className="h-3.5 w-3.5 text-primary" aria-label="Pinned" />}
      {pins.map((p) => chip(p, true))}
      {recents.length > 0 && <Clock className={cn("h-3.5 w-3.5 text-muted-foreground", pins.length > 0 && "ml-2")} aria-label="Recent" />}
      {recents.slice(0, 5).map((r) => chip(r, false))}
    </div>
  );
};
