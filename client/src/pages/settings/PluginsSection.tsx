import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { PluginCategory, PluginInfo } from "@shared/plugins";
import { usePlugins } from "@/hooks/use-plugins";
import { cn } from "@/lib/utils";
import { Category, useOpenRows } from "./plugins/PluginGroup";
import { summarisePlugins } from "./plugins/plugin-summary";

/** The groups this page shows; MCP servers have their own page. */
const CATEGORIES: PluginCategory[] = ["core", "observability", "ai"];

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

/** Settings → Plugins: the built-in integrations (Kubernetes tools, Tempo, Loki). MCP servers have their own page (mcp/). */
export function PluginsSection() {
  const plugins = usePlugins();
  const rows = useOpenRows();

  if (plugins.isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (plugins.error) return <p role="alert" className="text-sm text-destructive">Could not load the plugins: {plugins.error.message}</p>;
  const list = plugins.data!;
  const byCategory = (c: PluginCategory) => list.plugins.filter((p) => p.category === c);
  const shown = CATEGORIES.filter((c) => byCategory(c).length > 0);

  return (
    <div className="space-y-7">
      <Summary plugins={shown.flatMap(byCategory)} canManage={list.canManage} />
      {shown.map((c) => <Category key={c} category={c} plugins={byCategory(c)} list={list} rows={rows} />)}
    </div>
  );
}
