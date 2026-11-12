/**
 * One MCP server as a card: its name, where it is, whether it answers and how many tools it offers,
 * its switch (for an admin), and, opened, its tools by access and its settings.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2, Trash2, Zap } from "lucide-react";
import type { PluginInfo } from "@shared/plugins";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useRemovePlugin, useTestPlugin, useUpdatePlugin } from "@/hooks/use-plugins";
import { cn } from "@/lib/utils";
import { InlineConfirm } from "../InlineConfirm";
import { PluginForm } from "../plugins/PluginForm";
import { StatusLine, StatusPill } from "../plugins/PluginStatus";
import { hostOf, toolSummary } from "./mcp-page";
import { ToolList } from "./ToolList";

const domId = (plugin: PluginInfo, part: string) => `mcp-${plugin.id}-${part}`.replace(/[^\w-]/g, "-");

/** The on/off switch; while it saves, a spinner; a refusal, in words under it. */
function ServerSwitch({ plugin }: { plugin: PluginInfo }) {
  const update = useUpdatePlugin();
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
      <div className="flex items-center gap-2">
        {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
        <Switch
          checked={plugin.enabled} disabled={update.isPending} aria-label={`Use ${plugin.name}`}
          onCheckedChange={(enabled) => update.mutate({ id: plugin.id, enabled })}
        />
      </div>
      {update.error && <p role="alert" className="max-w-[14rem] text-right text-[11px] text-destructive">{update.error.message}</p>}
    </div>
  );
}

/** Right after adding: say so, and offer a check of the new server. */
function AddedNote({ plugin, onDismiss }: { plugin: PluginInfo; onDismiss: () => void }) {
  const test = useTestPlugin();
  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="text-xs font-medium"><strong>{plugin.name}</strong> is added and on, offering only the tools that read. Test it to check that it answers.</p>
      {test.data && <StatusLine status={test.data} />}
      {test.error && <p role="alert" className="text-xs text-destructive">{test.error.message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => test.mutate(plugin.id)} disabled={test.isPending}>
          {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Test connection
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>Done</Button>
      </div>
    </div>
  );
}

function RemoveServer({ plugin }: { plugin: PluginInfo }) {
  const [asking, setAsking] = useState(false);
  const remove = useRemovePlugin();
  if (!asking) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(true)} className="text-destructive hover:text-destructive">
        <Trash2 className="h-3.5 w-3.5" /> Remove server
      </Button>
    );
  }
  return (
    <div role="group" aria-label={`Remove ${plugin.name}`} className="rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3">
      <InlineConfirm action="Remove" pending={remove.isPending} error={remove.error} onConfirm={() => remove.mutate(plugin.id)} onCancel={() => setAsking(false)}>
        Remove <strong>{plugin.name}</strong>? The assistant stops using its tools and its settings are deleted.
      </InlineConfirm>
    </div>
  );
}

function Panel({ plugin, canManage, justAdded, onSeen }: { plugin: PluginInfo; canManage: boolean; justAdded: boolean; onSeen: () => void }) {
  const showSettings = canManage && plugin.fields.length > 0;
  return (
    <div id={domId(plugin, "panel")} className="space-y-5 border-t border-border/60 px-4 py-4">
      {justAdded && <AddedNote plugin={plugin} onDismiss={onSeen} />}
      <p className="text-xs text-muted-foreground">{plugin.description}</p>
      <section aria-labelledby={domId(plugin, "tools")} className="space-y-2">
        <h5 id={domId(plugin, "tools")} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tools</h5>
        <ToolList catalog={plugin.catalog} serverName={plugin.name} idPrefix={domId(plugin, "t")} />
      </section>
      {showSettings && (
        <section aria-labelledby={domId(plugin, "settings")} className="space-y-2">
          <h5 id={domId(plugin, "settings")} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Settings</h5>
          <PluginForm plugin={plugin} />
        </section>
      )}
      {canManage && plugin.removable && <RemoveServer plugin={plugin} />}
    </div>
  );
}

export function McpServerCard({ plugin, canManage, open, onToggle, justAdded = false, onSeen }: {
  plugin: PluginInfo;
  canManage: boolean;
  open: boolean;
  onToggle: () => void;
  /** just added on this page: the card takes the focus and offers a test */
  justAdded?: boolean;
  onSeen: () => void;
}) {
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!justAdded) return;
    toggle.current?.focus();
    toggle.current?.scrollIntoView({ block: "nearest" });
  }, [justAdded]);

  const { status } = plugin;
  const host = hostOf(plugin.values.url);
  const summary = plugin.enabled ? toolSummary(plugin.catalog) : null;
  const problem = (status.state === "error" || status.state === "unconfigured") && !!status.message;
  // the card says how many tools in its own words; the pill keeps to the state
  const pill = { ...status, detail: undefined };

  return (
    <li>
      <article aria-labelledby={domId(plugin, "name")} className={cn("rounded-xl border bg-card", justAdded ? "border-primary/40" : "border-border")}>
        <div className="flex items-start gap-3 p-4">
          <h4 className="min-w-0 flex-1">
            <button
              ref={toggle} type="button" onClick={onToggle} aria-expanded={open} aria-controls={open ? domId(plugin, "panel") : undefined}
              className="flex w-full min-w-0 items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              <ChevronRight aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground", open && "rotate-90")} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span id={domId(plugin, "name")} className="text-sm font-semibold text-foreground">{plugin.name}</span>
                  {plugin.kind === "builtin" && (
                    <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Built in</span>
                  )}
                  <StatusPill status={pill} connects />
                </span>
                {(host || summary) && (
                  <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-normal text-muted-foreground">
                    {host && <span className="max-w-full truncate font-mono">{host}</span>}
                    {summary && <span>{summary}</span>}
                  </span>
                )}
              </span>
            </button>
          </h4>
          {canManage && !plugin.alwaysOn && <ServerSwitch plugin={plugin} />}
        </div>
        {problem && <div className="-mt-1 px-4 pb-3 pl-10"><StatusLine status={status} /></div>}
        {open && <Panel plugin={plugin} canManage={canManage} justAdded={justAdded} onSeen={onSeen} />}
      </article>
    </li>
  );
}
