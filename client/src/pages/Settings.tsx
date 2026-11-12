import { useState, type FC } from "react";
import { Blocks, Bot, Cable, Info, Palette, ScrollText, Server, Users, type LucideIcon } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { useHashParams } from "@/hooks/use-hash-params";
import { useServerMode } from "@/hooks/use-server-mode";
import { cn } from "@/lib/utils";
import { AboutSection } from "./settings/AboutSection";
import { AiSection } from "./settings/AiSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { AuditSection } from "./settings/AuditSection";
import { UsersSection } from "./settings/UsersSection";
import { ClustersSection } from "./settings/ClustersSection";
import { McpSection, PluginsSection } from "./settings/PluginsSection";
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
}

const SECTIONS: Section[] = [
  { id: "appearance", label: "Appearance", description: "Light or dark, and the colours of each. Saved in this browser only.", icon: Palette, render: AppearanceSection },
  { id: "clusters", label: "Clusters", description: "The kubeconfig files KubeDeck reads", icon: Server, render: ClustersSection, editable: true },
  { id: "ai", label: "AI assistant", description: "Model provider for Ask Deck and AI features", icon: Bot, render: AiSection, manage: true },
  // everyone sees what is on and whether it works; only someone who may manage plugins changes them
  { id: "plugins", label: "Plugins", description: "Built-in integrations: traces from Tempo, logs from Loki, the assistant's Kubernetes tools", icon: Blocks, render: PluginsSection },
  { id: "mcp", label: "MCP servers", description: "Tool servers the assistant may call: Grafana, and any you add", icon: Cable, render: McpSection },
  { id: "users", label: "Users", description: "Who can sign in (an admin creates every account) and the groups that give them cluster access", icon: Users, render: UsersSection, feature: "users" },
  { id: "audit", label: "Audit log", description: "Every change made through KubeDeck, who made it, and whether it went through", icon: ScrollText, render: AuditSection, feature: "audit" },
  { id: "about", label: "About", description: "Version, source and keyboard shortcuts", icon: Info, render: AboutSection },
];

/** The rail's headings, in order; a heading whose sections are all hidden is left out. */
const GROUPS: { label: string; ids: string[] }[] = [
  { label: "Personal", ids: ["appearance"] },
  { label: "Connections", ids: ["clusters", "ai"] },
  { label: "Integrations", ids: ["plugins", "mcp"] },
  { label: "Administration", ids: ["users", "audit"] },
  { label: "KubeDeck", ids: ["about"] },
];

function RailLink({ section, on, onSelect }: { section: Section; on: boolean; onSelect: () => void }) {
  const Icon = section.icon;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={on ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          on ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        {section.label}
      </button>
    </li>
  );
}

/** The section rail: grouped under small headings on wide screens, one scrolling row on a phone. */
function Rail({ sections, active, onSelect, note }: { sections: Section[]; active: Section; onSelect: (s: Section) => void; note?: string }) {
  const groups = GROUPS.map((g) => ({ ...g, sections: sections.filter((s) => g.ids.includes(s.id)) })).filter((g) => g.sections.length > 0);
  return (
    <nav aria-label="Settings sections" className="min-w-0 shrink-0 md:sticky md:top-0 md:w-52 md:self-start">
      <h1 className="mb-3 px-2 text-xl font-bold tracking-tight">Settings</h1>
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:gap-4 md:overflow-visible md:px-0 md:pb-0">
        {groups.map((g) => (
          <div key={g.label} role="group" aria-labelledby={`settings-group-${g.label}`} className="contents md:block">
            <h2 id={`settings-group-${g.label}`} className="sr-only px-2.5 pb-1 text-[11px] font-medium text-muted-foreground/80 md:not-sr-only md:block">
              {g.label}
            </h2>
            <ul className="contents md:flex md:flex-col md:gap-0.5">
              {g.sections.map((s) => <RailLink key={s.id} section={s} on={s.id === active.id} onSelect={() => onSelect(s)} />)}
            </ul>
          </div>
        ))}
      </div>
      {note && <p className="mt-5 hidden px-2.5 text-[11px] leading-relaxed text-muted-foreground md:block">{note}</p>}
    </nav>
  );
}

/** `/settings` — a section rail and one section at a time (`?section=` keeps it linkable). */
export default function Settings() {
  const { get, set } = useHashParams();
  const { mode, features } = useServerMode();
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  const mayManage = features.settingsEdit || features.users;
  const sections = SECTIONS.filter((s) =>
    (!s.editable || features.settingsEdit) && (!s.manage || mayManage) && (!s.feature || features[s.feature]));
  const active = sections.find((s) => s.id === get("section")) ?? sections[0];
  const Body = active.render;

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <AppHeader breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: active.label }]} showSelectors={false} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-5 sm:p-7 md:flex-row md:gap-8">
          <Rail
            sections={sections}
            active={active}
            note={mode !== "web" ? undefined : features.users
              ? "Clusters come from the server's environment."
              : "Clusters and the AI provider are set up by this KubeDeck's admins."}
            onSelect={(s) => set("section", s.id === sections[0].id ? null : s.id)}
          />

          <div className="min-w-0 flex-1">
            <header className="mb-5 flex flex-wrap items-start gap-x-4 gap-y-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold tracking-tight">{active.label}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{active.description}</p>
              </div>
              <div ref={setActionSlot} className="flex shrink-0 items-center gap-2 empty:hidden" />
            </header>
            <PageActionSlot.Provider value={actionSlot}>
              <Body key={active.id} />
            </PageActionSlot.Provider>
          </div>
        </div>
      </main>
    </div>
  );
}
