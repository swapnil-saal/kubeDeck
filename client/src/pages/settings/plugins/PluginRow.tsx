/** One plugin in the list: what it is, whether it works, what it adds, and (for an admin) its switch and settings. */
import { useState } from "react";
import { ChevronDown, Loader2, Settings2, Trash2 } from "lucide-react";
import type { PluginInfo } from "@shared/plugins";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRemovePlugin, useUpdatePlugin } from "@/hooks/use-plugins";
import { cn } from "@/lib/utils";
import { InlineConfirm } from "../InlineConfirm";
import { PluginForm } from "./PluginForm";
import { pluginIcon } from "./plugin-icons";
import { StatusLine, StatusPill } from "./PluginStatus";

const TOOLS_SHOWN = 10;

function Provides({ provides }: { provides: PluginInfo["provides"] }) {
  const [all, setAll] = useState(false);
  const { tools, features } = provides;
  if (!tools.length && !features.length) return null;
  const shown = all ? tools : tools.slice(0, TOOLS_SHOWN);
  return (
    <div className="mt-2.5 space-y-1.5">
      {features.length > 0 && <p className="text-xs text-foreground/80"><span className="text-muted-foreground">Adds </span>{features.join(", ")}</p>}
      {tools.length > 0 && (
        <ul aria-label="Assistant tools" className="flex flex-wrap items-center gap-1">
          <li aria-hidden className="mr-0.5 text-[11px] text-muted-foreground">Tools</li>
          {shown.map((t) => <li key={t} className="rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 font-mono text-[11px]">{t}</li>)}
          {tools.length > TOOLS_SHOWN && (
            <li>
              <button type="button" onClick={() => setAll((v) => !v)} className="rounded px-1 text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {all ? "Show fewer" : `+${tools.length - TOOLS_SHOWN} more`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** On/off; an always-on plugin shows a disabled switch that explains itself. */
function EnabledSwitch({ plugin }: { plugin: PluginInfo }) {
  const update = useUpdatePlugin();
  const label = `${plugin.name}: ${plugin.enabled ? "on" : "off"}`;
  if (plugin.alwaysOn) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Switch checked disabled aria-label={`${plugin.name} is always on`} />
          </span>
        </TooltipTrigger>
        <TooltipContent className="text-xs">Always on: KubeDeck needs it</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Switch checked={plugin.enabled} disabled={update.isPending} aria-label={label} onCheckedChange={(enabled) => update.mutate({ id: plugin.id, enabled })} />
      </div>
      {update.error && <p role="alert" className="max-w-[16rem] text-right text-[11px] text-destructive">{update.error.message}</p>}
    </div>
  );
}

/** Configure, and (for an added server) Remove with an inline confirmation. */
function RowActions({ plugin, open, onToggle }: { plugin: PluginInfo; open: boolean; onToggle: () => void }) {
  const [removing, setRemoving] = useState(false);
  const remove = useRemovePlugin();
  if (!plugin.fields.length && !plugin.removable) return null;
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {plugin.fields.length > 0 && (
          <Button type="button" size="sm" variant="outline" onClick={onToggle} aria-expanded={open}>
            <Settings2 className="h-3.5 w-3.5" /> Configure
            <ChevronDown className={cn("h-3.5 w-3.5", open && "rotate-180")} />
          </Button>
        )}
        {plugin.removable && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving(true)} className="text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
        )}
      </div>
      {removing && (
        <div role="group" aria-label={`Remove ${plugin.name}`} className="mt-3 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-3">
          <InlineConfirm action="Remove" pending={remove.isPending} error={remove.error} onConfirm={() => remove.mutate(plugin.id)} onCancel={() => setRemoving(false)}>
            Remove <strong>{plugin.name}</strong>? The assistant stops using its tools and its settings are deleted.
          </InlineConfirm>
        </div>
      )}
    </>
  );
}

export function PluginRow({ plugin, canManage, open, onToggle }: { plugin: PluginInfo; canManage: boolean; open: boolean; onToggle: () => void }) {
  const { status } = plugin;
  const problem = (status.state === "error" || status.state === "unconfigured") && status.message;
  const Icon = pluginIcon(plugin);
  const live = plugin.enabled && status.state === "ok";
  return (
    <li aria-label={plugin.name} className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            live ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-semibold">{plugin.name}</h4>
            <StatusPill status={status} connects={plugin.fields.length > 0} />
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{plugin.description}</p>
          {problem && <div className="mt-2"><StatusLine status={status} /></div>}
          <Provides provides={plugin.provides} />
          {canManage && <RowActions plugin={plugin} open={open} onToggle={onToggle} />}
        </div>
        {canManage && <EnabledSwitch plugin={plugin} />}
      </div>
      {canManage && open && <div className="mt-4 border-t border-border/60 pt-4"><PluginForm plugin={plugin} /></div>}
    </li>
  );
}
