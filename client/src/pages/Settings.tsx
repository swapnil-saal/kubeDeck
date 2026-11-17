import { useState, type FC } from "react";
import { Blocks, Bot, Cable, Info, Palette, ScrollText, Server, Users, UsersRound, type LucideIcon } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { useHashParams } from "@/hooks/use-hash-params";
import { useServerMode } from "@/hooks/use-server-mode";
import { cn } from "@/lib/utils";
import { AboutSection } from "./settings/AboutSection";
import { AiSection } from "./settings/AiSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { AuditSection } from "./settings/AuditSection";
import { UsersSection } from "./settings/UsersSection";
import { GroupsSection } from "./settings/GroupsSection";
import { ClusterConnectionsSection } from "./settings/ClusterConnectionsSection";
import { ClustersSection } from "./settings/ClustersSection";
import { PluginsSection } from "./settings/PluginsSection";
import McpSection from "./settings/mcp/McpSection";
import { PageActionSlot } from "./settings/SettingsCard";

interface Section {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  render: FC;
  /** only on a KubeDeck whose settings the browser may change (the desktop app) */
  editable?: boolean;
  /** only for someone who may manage this KubeDeck: the desktop's user, or a web-mode admin */
  manage?: boolean;
  /** only when the server offers this feature to the current user */
  feature?: "users" | "audit";
  /** lists and tables use the full width; forms stay at a readable width */
  wide?: boolean;
}

const SECTIONS: Section[] = [
  { id: "appearance", label: "Appearance", description: "Light or dark, and the colours of each. Saved in this browser only.", icon: Palette, render: AppearanceSection },
  { id: "clusters", label: "Clusters", description: "The kubeconfig files KubeDeck reads", icon: Server, render: ClustersSection, editable: true },
  { id: "ai", label: "AI assistant", description: "Model provider for Ask Deck and AI features", icon: Bot, render: AiSection, manage: true },
  // everyone sees what is on and whether it works; only someone who may manage plugins changes them
  { id: "plugins", label: "Plugins", description: "Built-in integrations: traces from Tempo, logs from Loki, the assistant's Kubernetes tools", icon: Blocks, render: PluginsSection, wide: true },
  { id: "mcp", label: "MCP servers", description: "Tool servers the assistant may call: Grafana, and any you add", icon: Cable, render: McpSection, wide: true },
  { id: "cluster-connections", label: "Clusters", description: "The clusters this KubeDeck knows and its connection to each; groups give people access to them", icon: Server, render: ClusterConnectionsSection, feature: "users", wide: true },
  { id: "users", label: "Users", description: "Who can sign in (an admin creates every account) and the groups they are in", icon: Users, render: UsersSection, feature: "users", wide: true },
  { id: "groups", label: "Groups", description: "Teams, and the service account each uses on every cluster", icon: UsersRound, render: GroupsSection, feature: "users", wide: true },
  { id: "audit", label: "Audit log", description: "Every change made through KubeDeck, who made it, and whether it went through", icon: ScrollText, render: AuditSection, feature: "audit", wide: true },
  { id: "about", label: "About", description: "Version, source and keyboard shortcuts", icon: Info, render: AboutSection },
];

/** The rail's headings, in order; a heading whose sections are all hidden is left out. */
const GROUPS: { label: string; ids: string[] }[] = [
  { label: "Personal", ids: ["appearance"] },
  { label: "Connections", ids: ["clusters", "ai"] },
  { label: "Integrations", ids: ["plugins", "mcp"] },
  { label: "Administration", ids: ["cluster-connections", "users", "groups", "audit"] },
  { label: "KubeDeck", ids: ["about"] },
];

/**
 * The sections as tabs across the top, in their groups (a thin divider between groups, the group's
 * name on hover). One row that scrolls sideways when it does not fit.
 */
function SectionTabs({ sections, active, onSelect }: { sections: Section[]; active: Section; onSelect: (s: Section) => void }) {
  const groups = GROUPS.map((g) => ({ ...g, sections: sections.filter((s) => g.ids.includes(s.id)) })).filter((g) => g.sections.length > 0);
  return (
    <nav aria-label="Settings sections" className="-mb-px flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none]">
      {groups.map((g, gi) => (
        <div key={g.label} role="group" aria-label={g.label} title={g.label} className="flex shrink-0 items-stretch">
          {gi > 0 && <span aria-hidden className="mx-2 my-2.5 w-px bg-border" />}
          {g.sections.map((s) => {
            const on = s.id === active.id;
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  on ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {s.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** `/settings` — tabs across the top and one section at a time (`?section=` keeps it linkable). */
export default function Settings() {
  const { get, set } = useHashParams();
  const { mode, features } = useServerMode();
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  const mayManage = features.settingsEdit || features.users;
  const sections = SECTIONS.filter((s) =>
    (!s.editable || features.settingsEdit) && (!s.manage || mayManage) && (!s.feature || features[s.feature]));
  const active = sections.find((s) => s.id === get("section")) ?? sections[0];
  const Body = active.render;
  const note = mode !== "web" ? undefined : features.users
    ? "Clusters come from the server's environment."
    : "Clusters and the AI provider are set up by this KubeDeck's admins.";

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <AppHeader breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: active.label }]} showSelectors={false} />
      <div className="shrink-0 border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl items-end gap-6 px-4 sm:px-7">
          <SectionTabs sections={sections} active={active} onSelect={(s) => set("section", s.id === sections[0].id ? null : s.id)} />
          {note && <p className="ml-auto hidden shrink-0 pb-3 text-[11px] text-muted-foreground xl:block">{note}</p>}
        </div>
      </div>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-7 sm:py-6">
          <header className={cn("mb-5 flex flex-wrap items-start gap-x-4 gap-y-3", !active.wide && "max-w-4xl")}>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold tracking-tight">{active.label}</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">{active.description}</p>
            </div>
            <div ref={setActionSlot} className="flex shrink-0 items-center gap-2 empty:hidden" />
          </header>
          <PageActionSlot.Provider value={actionSlot}>
            <div className={active.wide ? undefined : "max-w-4xl"}>
              <Body key={active.id} />
            </div>
          </PageActionSlot.Provider>
        </div>
      </main>
    </div>
  );
}
