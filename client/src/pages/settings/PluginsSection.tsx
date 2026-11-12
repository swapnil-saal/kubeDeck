import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { CATEGORY_LABEL, PLUGIN_CATEGORIES, type PluginCategory, type PluginInfo, type PluginList } from "@shared/plugins";
import { Button } from "@/components/ui/button";
import { usePlugins } from "@/hooks/use-plugins";
import { AddMcpServer } from "./plugins/AddMcpServer";
import { PluginRow } from "./plugins/PluginRow";
import { SettingsCard } from "./SettingsCard";

const CATEGORY_DESCRIPTION: Record<PluginCategory, string> = {
  core: "Part of every KubeDeck.",
  observability: "Traces, logs and dashboards from your monitoring stack, on workload pages and for the assistant.",
  ai: "More tools the assistant may use.",
  mcp: "Servers that speak the Model Context Protocol; the assistant may call the tools you allow.",
};

const EMPTY: Partial<Record<PluginCategory, string>> = {
  mcp: "No MCP servers yet. Add one to give the assistant more tools.",
};

/** Which plugins' settings are open; adding a server opens its own. */
function useOpenRows() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const show = (id: string) => setOpen((s) => new Set(s).add(id));
  return { open, toggle, show };
}

function Category({ category, plugins, list, adding, setAdding, rows }: {
  category: PluginCategory;
  plugins: PluginInfo[];
  list: PluginList;
  adding: boolean;
  setAdding: (v: boolean) => void;
  rows: ReturnType<typeof useOpenRows>;
}) {
  const canAdd = category === "mcp" && list.canManage && list.addable.includes("mcp");
  return (
    <SettingsCard
      title={CATEGORY_LABEL[category]}
      description={CATEGORY_DESCRIPTION[category]}
      actions={canAdd && !adding && <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add MCP server</Button>}
    >
      {canAdd && adding && <AddMcpServer onCancel={() => setAdding(false)} onAdded={(id) => { setAdding(false); rows.show(id); }} />}
      {plugins.length === 0 ? (
        !adding && <p className="text-xs text-muted-foreground">{EMPTY[category] ?? "Nothing here yet."}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {plugins.map((p) => <PluginRow key={p.id} plugin={p} canManage={list.canManage} open={rows.open.has(p.id)} onToggle={() => rows.toggle(p.id)} />)}
        </ul>
      )}
    </SettingsCard>
  );
}

/** Settings → Plugins: everyone sees what is on and whether it works; an admin switches and configures. */
export function PluginsSection() {
  const plugins = usePlugins();
  const rows = useOpenRows();
  const [adding, setAdding] = useState(false);

  if (plugins.isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading plugins…</p>;
  if (plugins.error) return <p role="alert" className="text-sm text-destructive">Could not load the plugins: {plugins.error.message}</p>;
  const list = plugins.data!;
  const byCategory = (c: PluginCategory) => list.plugins.filter((p) => p.category === c);
  // a category shows when it has plugins, or (MCP servers) when one can be added
  const shown = PLUGIN_CATEGORIES.filter((c) => byCategory(c).length > 0 || (c === "mcp" && list.canManage && list.addable.includes("mcp")));

  return (
    <div className="space-y-6">
      {!list.canManage && <p className="text-xs text-muted-foreground">Only a KubeDeck admin can switch plugins on or off and change their settings.</p>}
      {shown.map((c) => (
        <Category key={c} category={c} plugins={byCategory(c)} list={list} adding={adding} setAdding={setAdding} rows={rows} />
      ))}
    </div>
  );
}
