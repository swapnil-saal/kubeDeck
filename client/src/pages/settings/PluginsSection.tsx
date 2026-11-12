import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus } from "lucide-react";
import type { PluginCategory, PluginInfo } from "@shared/plugins";
import { Button } from "@/components/ui/button";
import { usePlugins } from "@/hooks/use-plugins";
import { cn } from "@/lib/utils";
import { AddMcpServer } from "./plugins/AddMcpServer";
import { Category, useOpenRows } from "./plugins/PluginGroup";
import { summarisePlugins } from "./plugins/plugin-summary";
import { PageAction } from "./SettingsCard";

/** The groups each page shows: built-in integrations here, MCP servers on their own page. */
const PAGES: Record<"plugins" | "mcp", PluginCategory[]> = { plugins: ["core", "observability", "ai"], mcp: ["mcp"] };

/** "2 of 3 on · all working", or which plugins need attention. */
function Summary({ plugins, canManage }: { plugins: PluginInfo[]; canManage: boolean }) {
  const s = summarisePlugins(plugins);
  const Icon = s.attention ? AlertTriangle : CheckCircle2;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <p role="status" className={cn("inline-flex items-center gap-1.5 font-medium", s.attention ? "text-warning" : "text-foreground/80")}>
        <Icon className={cn("h-3.5 w-3.5 shrink-0", !s.attention && "text-success")} aria-hidden />
        {s.text}
      </p>
      {!canManage && <p className="text-muted-foreground">Only a KubeDeck admin can switch these on or off and change their settings.</p>}
    </div>
  );
}

function PluginPage({ page }: { page: keyof typeof PAGES }) {
  const plugins = usePlugins();
  const rows = useOpenRows();
  const [adding, setAdding] = useState(false);

  if (plugins.isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (plugins.error) return <p role="alert" className="text-sm text-destructive">Could not load the plugins: {plugins.error.message}</p>;
  const list = plugins.data!;
  const byCategory = (c: PluginCategory) => list.plugins.filter((p) => p.category === c);
  const canAdd = list.canManage && list.addable.includes("mcp");
  // a group shows when it has plugins, or (MCP servers) when one can be added
  const shown = PAGES[page].filter((c) => byCategory(c).length > 0 || (c === "mcp" && canAdd));
  const onPage = shown.flatMap(byCategory);

  return (
    <div className="space-y-7">
      {page === "plugins" ? <Summary plugins={onPage} canManage={list.canManage} />
        : !list.canManage && <p className="text-xs text-muted-foreground">Only a KubeDeck admin can add servers or change their settings.</p>}
      {page === "mcp" && canAdd && (
        <PageAction>
          <Button size="sm" disabled={adding} onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add MCP server</Button>
        </PageAction>
      )}
      {shown.map((c) => (
        <Category key={c} category={c} plugins={byCategory(c)} list={list} rows={rows} heading={page === "plugins"}>
          {c === "mcp" && canAdd && adding && <AddMcpServer onCancel={() => setAdding(false)} onAdded={(id) => { setAdding(false); rows.show(id); }} />}
        </Category>
      ))}
    </div>
  );
}

/** Settings → Plugins: the built-in integrations (Kubernetes tools, Tempo, Loki). */
export const PluginsSection = () => <PluginPage page="plugins" />;

/** Settings → MCP servers: Grafana and the servers an admin added, whose tools the assistant may call. */
export const McpSection = () => <PluginPage page="mcp" />;
