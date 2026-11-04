import { useEffect, useMemo, type FC, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Gauge, PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from "lucide-react";
import { AiAvatar } from "@/ai";
import { KubeDeckLogo, KubeDeckMark } from "@/components/KubeDeckLogo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useK8sDeployments, useK8sPods } from "@/hooks/use-k8s";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useServerMode } from "@/hooks/use-server-mode";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { RESOURCE_GROUPS, RESOURCE_KINDS, listHref } from "@/lib/resource-kinds";
import { cn } from "@/lib/utils";

/** The Electron window hides the title bar on macOS: the traffic-light buttons sit over the top-left corner. */
const inElectron = typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent);

interface Badge {
  value: number;
  tone: "bad" | "muted";
  title: string;
}

/**
 * Health badges for pods and deployments. The alert watcher already polls these exact
 * queries on every page, so the sidebar adds no requests of its own.
 */
function useHealthBadges(): Record<string, Badge | undefined> {
  const { context, namespace } = useTerminalStore();
  const pods = useK8sPods(context, namespace).data;
  const deployments = useK8sDeployments(context, namespace).data;
  return useMemo(() => {
    const badges: Record<string, Badge | undefined> = {};
    if (pods) {
      const failing = pods.filter((p) => !["Running", "Completed", "Succeeded"].includes(p.status)).length;
      badges.pods = failing > 0
        ? { value: failing, tone: "bad", title: `${failing} of ${pods.length} pods not running` }
        : { value: pods.length, tone: "muted", title: `${pods.length} pods, all running` };
    }
    if (deployments) {
      const notReady = deployments.filter((d) => {
        const [ready, want] = d.ready.split("/").map(Number);
        return ready < want;
      }).length;
      badges.deployments = notReady > 0
        ? { value: notReady, tone: "bad", title: `${notReady} of ${deployments.length} deployments not ready` }
        : { value: deployments.length, tone: "muted", title: `${deployments.length} deployments, all ready` };
    }
    return badges;
  }, [pods, deployments]);
}

const NavItem: FC<{
  label: string;
  icon: ReactNode;
  active: boolean;
  collapsed: boolean;
  badge?: Badge;
  onClick: () => void;
}> = ({ label, icon, active, collapsed, badge, onClick }) => {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? (badge ? `${label}, ${badge.title}` : label) : undefined}
      className={cn(
        "group relative flex h-8 w-full items-center gap-2.5 rounded-lg text-[13px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        collapsed ? "justify-center px-0" : "px-2.5",
        active ? "bg-primary/12 font-semibold text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {active && <span aria-hidden className="absolute -left-2 top-1.5 h-5 w-[3px] rounded-r-full bg-primary" />}
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {badge && !collapsed && (
        <span
          title={badge.title}
          className={cn(
            "shrink-0 rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
            badge.tone === "bad" ? "bg-destructive/15 text-destructive" : "text-muted-foreground/70",
          )}
        >
          {badge.value}
        </span>
      )}
      {badge?.tone === "bad" && collapsed && (
        <span aria-hidden className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" />
      )}
    </button>
  );
  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {label}
        {badge && <span className={cn("ml-1.5", badge.tone === "bad" ? "text-destructive" : "text-muted-foreground")}>· {badge.title}</span>}
      </TooltipContent>
    </Tooltip>
  );
};

/**
 * App navigation: overview, the assistant, every resource list grouped the way Kubernetes
 * users think about them, and settings. Collapses to an icon rail (Ctrl/⌘ B); the choice is remembered.
 */
export function AppSidebar() {
  const [location, navigate] = useLocation();
  const [expanded, setExpanded] = usePersistedState("kubedeck.sidebar.expanded", true);
  const serverMode = useServerMode();
  const badges = useHealthBadges();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setExpanded((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setExpanded]);

  const path = location.split("?")[0];
  const activeKind = path.startsWith("/resources/") ? path.split("/")[2] : undefined;
  // on a detail page, highlight the list it belongs to
  const detailType = path.startsWith("/resource/") ? path.split("/")[2] : undefined;
  const isKindActive = (key: string, type: string) => activeKind === key || detailType === type;

  // small screens always get the icon rail; the labelled panel is for wider windows
  const wide = useMediaQuery("(min-width: 768px)");
  const collapsed = !expanded || !wide;

  return (
    <aside
      aria-label="Navigation"
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-14" : "w-[14.5rem]",
      )}
    >
      {/* app-header: the window can be dragged from here in Electron (see index.css) */}
      <div className={cn("app-header flex h-14 shrink-0 items-center px-3", inElectron && "h-20 pt-6", collapsed && "justify-center px-0")}>
        <button type="button" onClick={() => navigate("/")} aria-label="KubeDeck — go to overview" className="flex items-center rounded-md transition-opacity hover:opacity-85">
          {collapsed ? <KubeDeckMark size={30} /> : <KubeDeckLogo size="lg" />}
        </button>
      </div>

      <nav aria-label="Main" className="no-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        <NavItem label="Overview" icon={<Gauge className="h-4 w-4" />} active={path === "/"} collapsed={collapsed} onClick={() => navigate("/")} />
        {serverMode.aiEnabled && (
          <NavItem
            label="Ask Deck"
            icon={<AiAvatar size={18} title="Ask Deck" animated={false} />}
            active={path === "/ai"}
            collapsed={collapsed}
            onClick={() => navigate("/ai")}
          />
        )}

        {RESOURCE_GROUPS.map((group) => (
          <section key={group} aria-label={group} className="mt-3">
            {collapsed ? (
              <div aria-hidden className="mx-2 mb-1.5 h-px bg-border" />
            ) : (
              <h2 className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">{group}</h2>
            )}
            {RESOURCE_KINDS.filter((k) => k.group === group).map((k) => (
              <NavItem
                key={k.key}
                label={k.label}
                icon={<k.icon className="h-4 w-4" />}
                active={isKindActive(k.key, k.type)}
                collapsed={collapsed}
                badge={badges[k.key]}
                onClick={() => navigate(listHref(k.key))}
              />
            ))}
          </section>
        ))}
      </nav>

      <div className="flex shrink-0 flex-col gap-0.5 border-t border-border px-2 py-2">
        {/* always shown: appearance is per browser, even on a read-only shared KubeDeck */}
        <NavItem
          label="Settings"
          icon={<SlidersHorizontal className="h-4 w-4" />}
          active={path === "/settings"}
          collapsed={collapsed}
          onClick={() => navigate("/settings")}
        />
        {wide && <NavItem
          label={collapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
          icon={collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          active={false}
          collapsed={collapsed}
          onClick={() => setExpanded((v) => !v)}
        />}
      </div>
    </aside>
  );
}
