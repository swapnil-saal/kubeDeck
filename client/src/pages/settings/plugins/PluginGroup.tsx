import { useState, type ReactNode } from "react";
import { CATEGORY_LABEL, type PluginCategory, type PluginInfo, type PluginList } from "@shared/plugins";
import { PluginRow } from "./PluginRow";

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

/**
 * One group of plugins under a small heading, each plugin its own card. A page can put a button beside
 * the heading (`action`, e.g. "Add MCP server") and something above the cards (`children`, e.g. the add
 * form); while `children` is shown, an empty group says nothing.
 */
export function Category({ category, plugins, list, rows, action, children, heading = true }: {
  category: PluginCategory;
  plugins: PluginInfo[];
  list: PluginList;
  rows: ReturnType<typeof useOpenRows>;
  action?: ReactNode;
  children?: ReactNode;
  /** false on a page that holds only this group, whose page header already names it */
  heading?: boolean;
}) {
  const id = `plugin-group-${category}`;
  return (
    <section aria-labelledby={heading ? id : undefined} aria-label={heading ? undefined : CATEGORY_LABEL[category]} className="space-y-3">
      {(heading || action) && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          {heading && (
            <div className="min-w-0 flex-1">
              <h3 id={id} className="text-sm font-semibold">{CATEGORY_LABEL[category]}</h3>
              <p className="text-xs text-muted-foreground">{CATEGORY_DESCRIPTION[category]}</p>
            </div>
          )}
          {action}
        </div>
      )}
      {children}
      {plugins.length === 0 ? (
        !children && <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">{EMPTY[category] ?? "Nothing here yet."}</p>
      ) : (
        <ul className="space-y-3">
          {plugins.map((p) => <PluginRow key={p.id} plugin={p} canManage={list.canManage} open={rows.open.has(p.id)} onToggle={() => rows.toggle(p.id)} />)}
        </ul>
      )}
    </section>
  );
}
