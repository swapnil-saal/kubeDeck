import type { FC } from "react";
import { Bot, Info, Palette, Server, type LucideIcon } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { useHashParams } from "@/hooks/use-hash-params";
import { useServerMode } from "@/hooks/use-server-mode";
import { cn } from "@/lib/utils";
import { AboutSection } from "./settings/AboutSection";
import { AiSection } from "./settings/AiSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { ClustersSection } from "./settings/ClustersSection";

interface Section {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  render: FC;
  /** only on a KubeDeck whose settings the browser may change (the desktop app) */
  editable?: boolean;
}

const SECTIONS: Section[] = [
  { id: "appearance", label: "Appearance", description: "Light or dark, and the colours of each", icon: Palette, render: AppearanceSection },
  { id: "clusters", label: "Clusters", description: "The kubeconfig files KubeDeck reads", icon: Server, render: ClustersSection, editable: true },
  { id: "ai", label: "AI assistant", description: "Model provider for Ask Deck and AI features", icon: Bot, render: AiSection, editable: true },
  { id: "about", label: "About", description: "Version, source and keyboard shortcuts", icon: Info, render: AboutSection },
];

/** `/settings` — a section rail and one section at a time (`?section=` keeps it linkable). */
export default function Settings() {
  const { get, set } = useHashParams();
  const { features } = useServerMode();
  const sections = SECTIONS.filter((s) => !s.editable || features.settingsEdit);
  const active = sections.find((s) => s.id === get("section")) ?? sections[0];
  const Body = active.render;

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <AppHeader breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: active.label }]} showSelectors={false} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 p-5 sm:p-7 md:flex-row">
          <nav aria-label="Settings sections" className="shrink-0 md:sticky md:top-0 md:w-56 md:self-start">
            <h1 className="mb-3 px-2 text-xl font-bold tracking-tight">Settings</h1>
            <ul className="flex gap-1 overflow-x-auto md:flex-col">
              {sections.map((s) => {
                const on = s.id === active.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => set("section", s.id === sections[0].id ? null : s.id)}
                      aria-current={on ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                        on ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      <s.icon className="h-4 w-4 shrink-0" />
                      {s.label}
                    </button>
                  </li>
                );
              })}
            </ul>
            {!features.settingsEdit && (
              <p className="mt-4 px-2 text-xs text-muted-foreground">Cluster and AI settings are managed by the server on a shared KubeDeck.</p>
            )}
          </nav>

          <div className="min-w-0 flex-1">
            <div className="mb-5">
              <h2 className="text-lg font-semibold tracking-tight">{active.label}</h2>
              <p className="text-xs text-muted-foreground">{active.description}</p>
            </div>
            <Body />
          </div>
        </div>
      </main>
    </div>
  );
}
