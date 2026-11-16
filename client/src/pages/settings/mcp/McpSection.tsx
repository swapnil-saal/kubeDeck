/**
 * Settings → MCP servers: Grafana (built in) and the servers an admin added, listed beside the selected
 * one's tools. Everyone sees what is on, whether it answers and its tools; only an admin adds, switches
 * and configures. How KubeDeck keeps them safe folds away at the bottom.
 */
import { useState } from "react";
import { BookOpen, Cable, ChevronRight, Globe, Loader2, Plus, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import type { PluginInfo } from "@shared/plugins";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { usePlugins } from "@/hooks/use-plugins";
import { cn } from "@/lib/utils";
import { PageAction } from "../SettingsCard";
import { pluginIcon } from "../plugins/plugin-icons";
import { PluginSheet } from "../plugins/PluginSheet";
import { StatusDot } from "../plugins/PluginSwitch";
import { AddMcpServer } from "./AddMcpServer";
import { McpServerDetail } from "./McpServerDetail";
import { hostOf, splitServers, toolSummary } from "./mcp-page";

const SAFETY: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: BookOpen, title: "Read-only by default", text: "Only tools that read are offered until an admin turns on Allow changes for a server." },
  { icon: ShieldCheck, title: "Changes need approval", text: "With Allow changes on, every call of a tool that may change something waits for approval in the chat." },
  { icon: Users, title: "Per-group access", text: "A server can be limited to some KubeDeck groups; nobody else's assistant sees its tools." },
  { icon: Globe, title: "Remote servers only", text: "KubeDeck connects over HTTP(S) and never runs a local (stdio) server on its host." },
];

function HowItWorks() {
  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-open:rotate-90" aria-hidden />
        How MCP servers stay safe
      </summary>
      <div className="space-y-3 border-t border-border/60 px-4 py-3.5 sm:px-5">
        <p className="text-xs text-muted-foreground">An MCP server offers tools over the Model Context Protocol: runbooks, tickets, metrics, code. The assistant calls the ones allowed here while it answers, as the person asking.</p>
        <ul className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          {SAFETY.map((s) => (
            <li key={s.title} className="flex min-w-0 items-start gap-2.5">
              <s.icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="min-w-0 text-xs"><span className="font-medium text-foreground">{s.title}.</span> <span className="text-muted-foreground">{s.text}</span></p>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function ServerItem({ plugin, on, onSelect }: { plugin: PluginInfo; on: boolean; onSelect: () => void }) {
  const Icon = pluginIcon(plugin);
  const host = hostOf(plugin.values.url);
  const summary = plugin.enabled ? toolSummary(plugin.catalog) : null;
  return (
    <li className={cn("relative", on && "bg-primary/[0.06]")}>
      {on && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      <button type="button" onClick={onSelect} aria-current={on ? "true" : undefined} className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <Icon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className={cn("block truncate text-sm font-medium", on && "text-primary")}>{plugin.name}</span>
          <StatusDot plugin={plugin} />
          {(host || summary) && <span className="block truncate text-[11px] text-muted-foreground">{[host, summary].filter(Boolean).join(" · ")}</span>}
        </span>
      </button>
    </li>
  );
}

export function McpSection() {
  const plugins = usePlugins();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  if (plugins.isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (plugins.error) return <p role="alert" className="text-sm text-destructive">Could not load the MCP servers: {plugins.error.message}</p>;
  const list = plugins.data!;
  const { builtin, added } = splitServers(list.plugins);
  const all = [...builtin, ...added];
  const selected = all.find((p) => p.id === selectedId) ?? all[0];
  const canAdd = list.canManage && list.addable.includes("mcp");
  const settings = all.find((p) => p.id === settingsId) ?? null;
  const heading = (text: string) => <li aria-hidden className="bg-muted/30 px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{text}</li>;

  return (
    <div className="space-y-4">
      {canAdd && (
        <PageAction>
          <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add MCP server</Button>
        </PageAction>
      )}
      {!list.canManage && <p className="text-xs text-muted-foreground">Only a KubeDeck admin can add servers, switch them and change their settings.</p>}

      {all.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <Cable aria-hidden className="h-10 w-10 rounded-full bg-primary/10 p-2.5 text-primary" />
          <p className="max-w-sm text-xs text-muted-foreground">
            <strong className="mb-1 block text-sm font-medium text-foreground">No MCP servers yet</strong>
            {canAdd ? "Add one by its URL, and the assistant gets the tools it allows." : "When an admin adds one, its tools show here."}
          </p>
          {canAdd && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add your first server</Button>}
        </div>
      ) : (
        <div className="grid overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[16rem_minmax(0,1fr)]">
          <ul aria-label="MCP servers" className="divide-y divide-border/60 border-b border-border md:border-b-0 md:border-r">
            {builtin.length > 0 && heading("Built in")}
            {builtin.map((p) => <ServerItem key={p.id} plugin={p} on={p.id === selected?.id} onSelect={() => setSelectedId(p.id)} />)}
            {heading("Added")}
            {added.map((p) => <ServerItem key={p.id} plugin={p} on={p.id === selected?.id} onSelect={() => setSelectedId(p.id)} />)}
            {added.length === 0 && <li className="px-3.5 py-3 text-[11px] text-muted-foreground">None yet.</li>}
          </ul>
          <div className="p-4 sm:p-5">
            {selected && (
              <McpServerDetail
                plugin={selected} canManage={list.canManage} justAdded={justAdded === selected.id}
                onSeen={() => setJustAdded(null)} onSettings={() => setSettingsId(selected.id)}
              />
            )}
          </div>
        </div>
      )}

      <HowItWorks />

      <Sheet open={adding} onOpenChange={(o) => !o && setAdding(false)}>
        <SheetContent aria-describedby={undefined}>
          {adding && <AddMcpServer onCancel={() => setAdding(false)} onAdded={(id) => { setAdding(false); setSelectedId(id); setJustAdded(id); }} />}
        </SheetContent>
      </Sheet>
      <PluginSheet plugin={settings} canManage={list.canManage} onClose={() => setSettingsId(null)} />
    </div>
  );
}

export default McpSection;
