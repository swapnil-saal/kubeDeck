/** A plugin's on/off switch: a spinner while it saves, a refusal in words; an always-on plugin explains itself. */
import { Loader2 } from "lucide-react";
import type { PluginInfo } from "@shared/plugins";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUpdatePlugin } from "@/hooks/use-plugins";

export function PluginSwitch({ plugin }: { plugin: PluginInfo }) {
  const update = useUpdatePlugin();
  if (plugin.alwaysOn) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} onClick={(e) => e.stopPropagation()} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Switch checked disabled aria-label={`${plugin.name} is always on`} />
          </span>
        </TooltipTrigger>
        <TooltipContent className="text-xs">Always on: KubeDeck needs it</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="flex items-center gap-2">
        {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
        <Switch checked={plugin.enabled} disabled={update.isPending} aria-label={`${plugin.name}: ${plugin.enabled ? "on" : "off"}`} onCheckedChange={(enabled) => update.mutate({ id: plugin.id, enabled })} />
      </span>
      {update.error && <span role="alert" className="max-w-[14rem] text-right text-[11px] text-destructive">{update.error.message}</span>}
    </span>
  );
}

/** A coloured dot and a word for the plugin's state, for lists and cards. */
export function StatusDot({ plugin }: { plugin: PluginInfo }) {
  const { state } = plugin.status;
  const label = state === "ok" ? (plugin.fields.length ? "Connected" : "On") : state === "error" ? "Error" : state === "unconfigured" ? "Needs settings" : "Off";
  const dot = state === "ok" ? "bg-success" : state === "error" ? "bg-destructive" : state === "unconfigured" ? "bg-warning" : "bg-muted-foreground/40";
  const text = state === "ok" ? "text-muted-foreground" : state === "error" ? "text-destructive" : state === "unconfigured" ? "text-warning" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${text}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
