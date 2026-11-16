import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { CATEGORY_LABEL, type PluginCategory, type PluginInfo } from "@shared/plugins";
import { usePlugins } from "@/hooks/use-plugins";
import { cn } from "@/lib/utils";
import { pluginIcon } from "./plugins/plugin-icons";
import { summarisePlugins } from "./plugins/plugin-summary";
import { PluginSheet } from "./plugins/PluginSheet";
import { StatusDot, PluginSwitch } from "./plugins/PluginSwitch";

/** The groups this page shows; MCP servers have their own page. */
const CATEGORIES: PluginCategory[] = ["core", "observability", "ai"];
const CATEGORY_DESCRIPTION: Partial<Record<PluginCategory, string>> = {
  core: "Part of every KubeDeck.",
  observability: "Traces, logs and dashboards from your monitoring stack, on workload pages and for the assistant.",
  ai: "More tools the assistant may use.",
};

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

/** What a plugin adds, in one line: "3 tools · Traces tab, Overview → Traces". */
function adds(p: PluginInfo): string {
  const tools = p.provides.tools.length;
  return [tools ? `${tools} assistant ${tools === 1 ? "tool" : "tools"}` : "", p.provides.features.join(", ")].filter(Boolean).join(" · ");
}

function PluginCard({ plugin, canManage, onOpen }: { plugin: PluginInfo; canManage: boolean; onOpen: () => void }) {
  const Icon = pluginIcon(plugin);
  const live = plugin.enabled && plugin.status.state === "ok";
  const problem = (plugin.status.state === "error" || plugin.status.state === "unconfigured") && plugin.status.message;
  return (
    <li className="group relative flex min-h-[9.5rem] flex-col rounded-xl border border-border bg-card p-4 hover:border-primary/40">
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", live ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold">
            <button type="button" onClick={onOpen} className="text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring">
              {plugin.name}
            </button>
          </h4>
          <StatusDot plugin={plugin} />
        </div>
        {canManage && <span className="relative z-10"><PluginSwitch plugin={plugin} /></span>}
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{problem || plugin.description}</p>
      <div className="mt-auto flex items-center gap-2 pt-3 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{adds(plugin)}</span>
        <span className="inline-flex items-center gap-0.5 font-medium text-primary opacity-0 group-hover:opacity-100">
          {canManage && plugin.fields.length ? "Settings" : "Details"} <ChevronRight className="h-3 w-3" aria-hidden />
        </span>
      </div>
    </li>
  );
}

/** Settings → Plugins: the built-in integrations as cards by category; each opens in a panel. MCP servers have their own page. */
export function PluginsSection() {
  const plugins = usePlugins();
  const [openId, setOpenId] = useState<string | null>(null);

  if (plugins.isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (plugins.error) return <p role="alert" className="text-sm text-destructive">Could not load the plugins: {plugins.error.message}</p>;
  const list = plugins.data!;
  const byCategory = (c: PluginCategory) => list.plugins.filter((p) => p.category === c);
  const shown = CATEGORIES.filter((c) => byCategory(c).length > 0);
  const open = list.plugins.find((p) => p.id === openId) ?? null;

  return (
    <div className="space-y-6">
      <Summary plugins={shown.flatMap(byCategory)} canManage={list.canManage} />
      {shown.map((c) => (
        <section key={c} aria-labelledby={`plugins-${c}`} className="space-y-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 id={`plugins-${c}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY_LABEL[c]}</h3>
            <p className="text-xs text-muted-foreground">{CATEGORY_DESCRIPTION[c]}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {byCategory(c).map((p) => <PluginCard key={p.id} plugin={p} canManage={list.canManage} onOpen={() => setOpenId(p.id)} />)}
          </ul>
        </section>
      ))}
      <PluginSheet plugin={open} canManage={list.canManage} onClose={() => setOpenId(null)} />
    </div>
  );
}
