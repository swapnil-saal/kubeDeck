import { type ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { Bot, ChevronRight, LayoutDashboard, Settings, Sparkles } from "lucide-react";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useK8sContexts } from "@/hooks/use-k8s";
import { KubeDeckLogo, KubeDeckMark } from "@/components/KubeDeckLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ScopeSwitcher } from "@/components/header/ScopeSwitcher";
import { cn } from "@/lib/utils";

interface Breadcrumb {
  label: string;
  href?: string;
}

interface AppHeaderProps {
  breadcrumbs?: Breadcrumb[];
  /** page-specific actions, shown after the global ones (refresh, live indicator, …) */
  rightSlot?: ReactNode;
  showSelectors?: boolean;
}

/** The Electron window hides the title bar on macOS, so the traffic-light buttons sit over the header. */
const inElectron = typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent);

const NAV = [
  { path: "/", label: "Overview", icon: LayoutDashboard },
  { path: "/ai", label: "AI Operator", icon: Bot },
  { path: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppHeader({ breadcrumbs, rightSlot, showSelectors = true }: AppHeaderProps) {
  const [location, navigate] = useLocation();
  const { context: currentContext, setContext } = useTerminalStore();
  const { data: contexts } = useK8sContexts();

  useEffect(() => {
    if (currentContext) return;
    if (!contexts || contexts.length === 0) return;
    const initial = contexts.find((c) => c.isCurrent) ?? contexts[0];
    if (initial) setContext(initial.name);
  }, [contexts, currentContext, setContext]);

  const isActive = (path: string) => {
    if (path === "/") return location === "/" || location.startsWith("/resource");
    return location === path || location.startsWith(path + "/");
  };

  // One crumb just repeats the page name that the navigation already shows.
  const crumbs = breadcrumbs && breadcrumbs.length > 1 ? breadcrumbs : [];

  return (
    <header className="app-header relative z-10 shrink-0 border-b border-border bg-card">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4",
          "md:h-14 md:flex-nowrap md:py-0",
          inElectron && "md:pl-20",
        )}
      >
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex shrink-0 items-center rounded-md py-1 transition-opacity hover:opacity-85"
          aria-label="KubeDeck — go to overview"
        >
          <KubeDeckMark size={34} className="sm:hidden" />
          <KubeDeckLogo size="xl" className="hidden sm:inline-flex" />
        </button>

        {/* Primary navigation: labelled, with a clear current page. Drops to its own row on small screens. */}
        <nav aria-label="Main" className="order-last flex w-full items-center gap-1 md:order-none md:w-auto">
          {NAV.map(({ path, label, icon: Icon }) => {
            const active = isActive(path);
            return (
              <button
                key={path}
                type="button"
                onClick={() => navigate(path)}
                aria-current={active ? "page" : undefined}
                title={label}
                className={cn(
                  "flex h-9 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors md:flex-none",
                  active
                    ? "bg-primary/12 text-primary ring-1 ring-primary/25"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Icon size={15} className="shrink-0" />
                <span className="md:hidden xl:inline">{label}</span>
              </button>
            );
          })}
        </nav>

        {showSelectors && <ScopeSwitcher className="min-w-0 flex-1 md:max-w-[22rem] md:flex-none" />}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-secondary/40 px-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-secondary hover:text-foreground lg:px-3"
            title="Run kubectl or describe what you want (⌘K)"
            aria-label="Open the kubectl command palette"
          >
            <Sparkles size={14} className="shrink-0 text-primary" />
            <span className="hidden xl:inline">Run kubectl…</span>
            <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium lg:inline">⌘K</kbd>
          </button>
          <ThemeToggle className="h-9 w-9 rounded-lg" />
          {rightSlot}
        </div>
      </div>

      {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex h-9 items-center gap-0 overflow-x-auto border-t border-border/60 bg-background/40 px-3 sm:px-4">
          {crumbs.map((crumb, i) => (
            <div key={i} className="flex min-w-0 shrink-0 items-center">
              {i > 0 && <ChevronRight className="mx-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40" aria-hidden />}
              {crumb.href ? (
                <button
                  type="button"
                  onClick={() => navigate(crumb.href!)}
                  className="truncate text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </button>
              ) : (
                <span className="truncate text-xs font-semibold text-foreground" aria-current="page">{crumb.label}</span>
              )}
            </div>
          ))}
        </nav>
      )}
    </header>
  );
}
