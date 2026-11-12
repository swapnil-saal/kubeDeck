import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { PluginCategory } from "@shared/plugins";
import { usePlugins } from "@/hooks/use-plugins";
import { Category, useOpenRows } from "./plugins/PluginGroup";

/** The groups each page shows: built-in integrations here, MCP servers on their own page. */
const PAGES: Record<"plugins" | "mcp", PluginCategory[]> = { plugins: ["core", "observability", "ai"], mcp: ["mcp"] };

function PluginPage({ page }: { page: keyof typeof PAGES }) {
  const plugins = usePlugins();
  const rows = useOpenRows();
  const [adding, setAdding] = useState(false);

  if (plugins.isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (plugins.error) return <p role="alert" className="text-sm text-destructive">Could not load the plugins: {plugins.error.message}</p>;
  const list = plugins.data!;
  const byCategory = (c: PluginCategory) => list.plugins.filter((p) => p.category === c);
  // a group shows when it has plugins, or (MCP servers) when one can be added
  const shown = PAGES[page].filter((c) => byCategory(c).length > 0 || (c === "mcp" && list.canManage && list.addable.includes("mcp")));

  return (
    <div className="space-y-6">
      {!list.canManage && <p className="text-xs text-muted-foreground">Only a KubeDeck admin can switch these on or off and change their settings.</p>}
      {shown.map((c) => (
        <Category key={c} category={c} plugins={byCategory(c)} list={list} adding={adding} setAdding={setAdding} rows={rows} />
      ))}
    </div>
  );
}

/** Settings → Plugins: the built-in integrations (Kubernetes tools, Tempo, Loki). */
export const PluginsSection = () => <PluginPage page="plugins" />;

/** Settings → MCP servers: Grafana and the servers an admin added, whose tools the assistant may call. */
export const McpSection = () => <PluginPage page="mcp" />;
