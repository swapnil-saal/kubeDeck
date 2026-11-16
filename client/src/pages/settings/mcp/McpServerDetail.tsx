/** The selected MCP server: where it is, whether it answers, its tools by access, and (for an admin) its switch and settings. */
import { Loader2, Settings2, Zap } from "lucide-react";
import type { PluginInfo } from "@shared/plugins";
import { Button } from "@/components/ui/button";
import { useTestPlugin } from "@/hooks/use-plugins";
import { cn } from "@/lib/utils";
import { pluginIcon } from "../plugins/plugin-icons";
import { StatusLine } from "../plugins/PluginStatus";
import { PluginSwitch, StatusDot } from "../plugins/PluginSwitch";
import { hostOf, toolSummary } from "./mcp-page";
import { ToolList } from "./ToolList";

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

export function McpServerDetail({ plugin, canManage, justAdded, onSeen, onSettings }: {
  plugin: PluginInfo;
  canManage: boolean;
  justAdded: boolean;
  onSeen: () => void;
  onSettings: () => void;
}) {
  const Icon = pluginIcon(plugin);
  const host = hostOf(plugin.values.url);
  const summary = plugin.enabled ? toolSummary(plugin.catalog) : null;
  const problem = plugin.status.state === "error" || plugin.status.state === "unconfigured";
  const live = plugin.enabled && plugin.status.state === "ok";

  return (
    <div className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-start gap-3">
        <span aria-hidden className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", live ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {plugin.name}
            {plugin.kind === "builtin" && <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Built in</span>}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <StatusDot plugin={plugin} />
            {host && <span className="truncate font-mono">{host}</span>}
            {summary && <span>{summary}</span>}
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-3">
            {plugin.fields.length > 0 && <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onSettings}><Settings2 className="h-3.5 w-3.5" /> Settings</Button>}
            {!plugin.alwaysOn && <PluginSwitch plugin={plugin} />}
          </div>
        )}
      </header>

      {justAdded && <AddedNote plugin={plugin} onDismiss={onSeen} />}
      {problem && <StatusLine status={plugin.status} />}
      <p className="text-xs text-muted-foreground">{plugin.description}</p>

      <section aria-label="Tools" className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tools</h4>
        <ToolList catalog={plugin.catalog} serverName={plugin.name} idPrefix={`mcp-${plugin.id}`.replace(/[^\w-]/g, "-")} />
      </section>
    </div>
  );
}
