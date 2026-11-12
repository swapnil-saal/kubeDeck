/**
 * Settings → MCP servers: what MCP servers do and how KubeDeck keeps them safe, Grafana (built in),
 * then the servers an admin added, each a card with its tools and settings. Everyone sees what is on,
 * whether it answers and its tools; only an admin adds, switches and configures.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Cable, Globe, Loader2, Plus, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import type { PluginInfo } from "@shared/plugins";
import { Button } from "@/components/ui/button";
import { usePlugins } from "@/hooks/use-plugins";
import { useOpenRows } from "../plugins/PluginGroup";
import { AddMcpServer } from "./AddMcpServer";
import { McpServerCard } from "./McpServerCard";
import { splitServers } from "./mcp-page";

const SAFETY: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: BookOpen, title: "Read-only by default", text: "Only tools that read are offered until an admin turns on Allow changes for a server." },
  { icon: ShieldCheck, title: "Changes need approval", text: "With Allow changes on, every call of a tool that may change something waits for approval in the chat." },
  { icon: Users, title: "Per-group access", text: "A server can be limited to some KubeDeck groups; nobody else's assistant sees its tools." },
  { icon: Globe, title: "Remote servers only", text: "KubeDeck connects over HTTP(S) and never runs a local (stdio) server on its host." },
];

function Intro({ action, canManage }: { action: ReactNode; canManage: boolean }) {
  return (
    <section aria-labelledby="mcp-intro" className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-prose">
          <h3 id="mcp-intro" className="text-sm font-semibold">Tools for the assistant</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            An MCP server offers tools over the Model Context Protocol: runbooks, tickets, metrics, code. The assistant calls the ones
            allowed here while it answers, as the person asking.
            {!canManage && " Only a KubeDeck admin can add servers, switch them and change their settings."}
          </p>
        </div>
        {action}
      </div>
      <ul className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">
        {SAFETY.map((s) => (
          <li key={s.title} className="flex min-w-0 items-start gap-2.5">
            <s.icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="min-w-0 text-xs">
              <span className="font-medium text-foreground">{s.title}.</span> <span className="text-muted-foreground">{s.text}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const EMPTY_TEXT = {
  admin: "Add one by its URL, and the assistant gets the tools it allows: start with one your team already runs.",
  viewer: "When an admin adds one, its tools show here.",
};

/** No added servers: what adding one does, and the button to do it. */
function Empty({ action, canManage }: { action: ReactNode; canManage: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <Cable aria-hidden className="h-10 w-10 rounded-full bg-primary/10 p-2.5 text-primary" />
      <p className="max-w-sm text-xs text-muted-foreground">
        <strong className="mb-1 block text-sm font-medium text-foreground">No servers added yet</strong>
        {EMPTY_TEXT[canManage ? "admin" : "viewer"]}
      </p>
      {action}
    </div>
  );
}

/** Which cards are open (as on the Plugins page); a server added here opens and is marked until its note is dismissed. */
function useCards() {
  const { open, toggle, show } = useOpenRows();
  const [justAdded, setJustAdded] = useState<string | null>(null);
  return { open, toggle, justAdded, added: (id: string) => { show(id); setJustAdded(id); }, seen: () => setJustAdded(null) };
}

function ServerList({ title, servers, canManage, cards }: { title: string; servers: PluginInfo[]; canManage: boolean; cards: ReturnType<typeof useCards> }) {
  const id = `mcp-group-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="space-y-2.5">
      <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="space-y-3">
        {servers.map((p) => (
          <McpServerCard
            key={p.id} plugin={p} canManage={canManage} open={cards.open.has(p.id)} onToggle={() => cards.toggle(p.id)}
            justAdded={cards.justAdded === p.id} onSeen={cards.seen}
          />
        ))}
      </ul>
    </section>
  );
}

export function McpSection() {
  const plugins = usePlugins();
  const cards = useCards();
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  // closing the form without adding puts the focus back on the button that opened it
  useEffect(() => {
    if (!adding && returnFocus.current) addButton.current?.focus();
    returnFocus.current = false;
  }, [adding]);

  if (plugins.isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (plugins.error) return <p role="alert" className="text-sm text-destructive">Could not load the MCP servers: {plugins.error.message}</p>;
  const list = plugins.data!;
  const { builtin, added } = splitServers(list.plugins);
  const canAdd = list.canManage && list.addable.includes("mcp");
  const add = canAdd && !adding && (
    <Button ref={addButton} size="sm" className="shrink-0 self-start" onClick={() => setAdding(true)}>
      <Plus className="h-3.5 w-3.5" /> Add MCP server
    </Button>
  );

  return (
    <div className="space-y-6">
      <Intro action={add} canManage={list.canManage} />
      {canAdd && adding && (
        <AddMcpServer
          onCancel={() => { returnFocus.current = true; setAdding(false); }}
          onAdded={(id) => { setAdding(false); cards.added(id); }}
        />
      )}
      {builtin.length > 0 && <ServerList title="Built in" servers={builtin} canManage={list.canManage} cards={cards} />}
      {added.length > 0 ? (
        <ServerList title="Added" servers={added} canManage={list.canManage} cards={cards} />
      ) : (
        !adding && (
          <section aria-label="Added servers">
            <Empty canManage={list.canManage} action={canAdd && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add your first server</Button>} />
          </section>
        )
      )}
    </div>
  );
}

export default McpSection;
