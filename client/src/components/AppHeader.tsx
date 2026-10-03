import { type ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import {
  ChevronRight, Settings, LayoutDashboard, Sparkles, Bot,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useK8sContexts, useK8sNamespaces } from "@/hooks/use-k8s";
import { KubeDeckLogo } from "@/components/KubeDeckLogo";
import { ThemeToggle } from "@/components/ThemeToggle";

interface Breadcrumb {
  label: string;
  href?: string;
}

interface AppHeaderProps {
  breadcrumbs?: Breadcrumb[];
  rightSlot?: ReactNode;
  showSelectors?: boolean;
}

export function AppHeader({ breadcrumbs, rightSlot, showSelectors = true }: AppHeaderProps) {
  const [location, navigate] = useLocation();
  const { context: currentContext, namespace: currentNamespace, setContext, setNamespace } = useTerminalStore();
  const { data: contexts } = useK8sContexts();
  const { data: namespaces } = useK8sNamespaces(currentContext);

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

  return (
    <header className="app-header relative z-10 border-b border-border bg-card shrink-0">
      <div className="flex items-center h-14 pl-20 pr-5 gap-0">
        {/* Logo */}
        <button
          onClick={() => navigate("/")}
          className="flex items-center pr-5 border-r border-border hover:opacity-85 transition-opacity py-1"
        >
          <KubeDeckLogo size="xl" />
        </button>

        {/* Nav links */}
        <div className="flex items-center gap-1 px-3 border-r border-border">
          <button
            onClick={() => navigate("/")}
            className={`p-2 rounded-lg transition-colors ${
              isActive("/")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
            title="Dashboard"
            aria-label="Dashboard"
            aria-current={isActive("/") ? "page" : undefined}
          >
            <LayoutDashboard size={16} />
          </button>
          <button
            onClick={() => navigate("/settings")}
            className={`p-2 rounded-lg transition-colors ${
              isActive("/settings")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
            title="Settings"
            aria-label="Settings"
            aria-current={isActive("/settings") ? "page" : undefined}
          >
            <Settings size={16} />
          </button>
        </div>

        {/* Breadcrumbs */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="flex items-center gap-0 min-w-0">
            {breadcrumbs.map((crumb, i) => (
              <div key={i} className="flex items-center min-w-0">
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 mx-2 shrink-0" />
                {crumb.href ? (
                  <button
                    onClick={() => navigate(crumb.href!)}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors truncate"
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className="text-xs font-semibold text-foreground truncate">
                    {crumb.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Context/Namespace selectors */}
        {showSelectors && (
          <>
            <div className="w-px h-6 bg-border/50 mx-3" />
            <div className="flex items-center gap-2 pr-4">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Context</span>
              <Select value={currentContext} onValueChange={setContext}>
                <SelectTrigger className="w-44 h-8 bg-secondary/50 border-border/50 hover:border-primary/30 focus:ring-1 focus:ring-primary/20 focus:ring-offset-0 text-xs text-foreground rounded-lg px-2.5">
                  <SelectValue placeholder="select context" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-foreground rounded-xl">
                  {contexts?.map((ctx) => (
                    <SelectItem key={ctx.name} value={ctx.name} className="text-xs focus:bg-primary/10 focus:text-foreground rounded-lg">
                      <div className="flex items-center gap-2">
                        {ctx.isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                        {ctx.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Namespace</span>
              <Select value={currentNamespace} onValueChange={setNamespace}>
                <SelectTrigger className="w-44 h-8 bg-secondary/50 border-border/50 hover:border-primary/30 focus:ring-1 focus:ring-primary/20 focus:ring-offset-0 text-xs text-foreground rounded-lg px-2.5">
                  <SelectValue placeholder="select namespace" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-foreground rounded-xl max-h-64">
                  <SelectItem value="all" className="text-xs focus:bg-primary/10 focus:text-foreground rounded-lg">
                    All namespaces
                  </SelectItem>
                  {namespaces?.map((ns) => (
                    <SelectItem key={ns.name} value={ns.name} className="text-xs focus:bg-primary/10 focus:text-foreground rounded-lg">
                      {ns.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* Right side */}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            className="flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/10 transition-colors text-xs font-semibold"
            title="kubectl command palette (⌘K)"
          >
            <Sparkles size={13} />
            <span>kubectl</span>
            <kbd className="text-[9px] font-medium text-muted-foreground/70 bg-background border border-border px-1.5 py-0.5 rounded-md ml-0.5">⌘K</kbd>
          </button>
          <button
            onClick={() => navigate("/ai")}
            aria-current={isActive("/ai") ? "page" : undefined}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-full border transition-colors text-xs font-semibold ${
              isActive("/ai")
                ? "bg-primary text-primary-foreground border-primary"
                : "text-primary bg-primary/10 border-primary/25 hover:bg-primary/15"
            }`}
            title="AI Assistant"
          >
            <Bot size={13} />
            <span>AI</span>
          </button>
          {rightSlot}
        </div>
      </div>
    </header>
  );
}
