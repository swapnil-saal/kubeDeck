import { useState } from "react";
import { Plus } from "lucide-react";
import { CATEGORY_LABEL, type PluginCategory, type PluginInfo, type PluginList } from "@shared/plugins";
import { Button } from "@/components/ui/button";
import { AddMcpServer } from "./AddMcpServer";
import { PluginRow } from "./PluginRow";
import { SettingsCard } from "../SettingsCard";

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
export function useOpenRows() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const show = (id: string) => setOpen((s) => new Set(s).add(id));
  return { open, toggle, show };
}

/** One group of plugins in a card; the MCP group can add a server. */
export function Category({ category, plugins, list, adding, setAdding, rows }: {
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
