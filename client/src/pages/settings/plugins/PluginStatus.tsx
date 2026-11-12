import { AlertTriangle, CheckCircle2, CircleOff, XCircle } from "lucide-react";
import type { PluginStatus } from "@shared/plugins";
import { cn } from "@/lib/utils";

const PILL: Record<PluginStatus["state"], { label: string; className: string }> = {
  ok: { label: "Connected", className: "border-success/30 bg-success/10 text-success" },
  error: { label: "Error", className: "border-destructive/30 bg-destructive/10 text-destructive" },
  unconfigured: { label: "Needs settings", className: "border-warning/30 bg-warning/10 text-warning" },
  off: { label: "Off", className: "border-border bg-muted text-muted-foreground" },
};

/**
 * The plugin's state in a word, plus its short fact ("12 tools"). A plugin with nothing to connect to
 * (no settings) is "On" rather than "Connected".
 */
export function StatusPill({ status, connects }: { status: PluginStatus; connects: boolean }) {
  const pill = PILL[status.state];
  const label = status.state === "ok" && !connects ? "On" : pill.label;
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", pill.className)}>
      <span className="truncate">{label}{status.state === "ok" && status.detail ? ` · ${status.detail}` : ""}</span>
    </span>
  );
}

const LINE_ICON = { ok: CheckCircle2, error: XCircle, unconfigured: AlertTriangle, off: CircleOff } as const;
const LINE_COLOR = { ok: "text-success", error: "text-destructive", unconfigured: "text-warning", off: "text-muted-foreground" } as const;

/** What a check found, in a sentence: under a card, or after "Test connection" and Save. */
export function StatusLine({ status, connects = true }: { status: PluginStatus; connects?: boolean }) {
  const Icon = LINE_ICON[status.state];
  const text = status.message
    ?? (status.state === "ok" ? [connects ? "Connected" : "On", status.detail].filter(Boolean).join(" · ")
      : status.state === "off" ? "Switched off." : status.state === "unconfigured" ? "Some settings are missing." : "It did not answer.");
  return (
    <p role="status" className={cn("flex items-start gap-1.5 text-xs font-medium", LINE_COLOR[status.state])}>
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}
