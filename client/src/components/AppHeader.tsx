import { type ReactNode } from "react";
import { useLocation } from "wouter";
import { Monitor, ChevronRight, Settings, LayoutDashboard, Sparkles } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useK8sContexts, useK8sNamespaces } from "@/hooks/use-k8s";

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

  const isActive = (path: string) => location === path;

  return (
    <header className="app-header relative z-10 border-b border-border/60 bg-card/95 backdrop-blur-xl">
      <div className="flex items-center h-12 pl-20 pr-4 gap-0">
        {/* Logo */}
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2.5 pr-4 border-r border-border hover:opacity-80 transition-opacity"
        >
          <Monitor className="w-4 h-4 text-foreground/70" />
          <span className="text-[11px] font-bold tracking-[0.2em] text-foreground/80">KUBEDECK</span>
        </button>

        {/* Nav links */}
        <div className="flex items-center gap-0.5 px-2 border-r border-border">
          <button
            onClick={() => navigate("/")}
            className={`p-1.5 rounded transition-all ${
              isActive("/")
                ? "bg-foreground/8 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
            }`}
            title="Dashboard"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => navigate("/settings")}
            className={`p-1.5 rounded transition-all ${
              isActive("/settings")
                ? "bg-foreground/8 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
            }`}
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Breadcrumbs */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="flex items-center gap-0">
            {breadcrumbs.map((crumb, i) => (
              <div key={i} className="flex items-center">
                <ChevronRight className="w-3 h-3 text-muted-foreground/30 mx-2" />
                {crumb.href ? (
                  <button
                    onClick={() => navigate(crumb.href!)}
                    className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/80">
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
            <ChevronRight className="w-3 h-3 text-muted-foreground/30 mx-2" />
            <div className="flex items-center gap-2 pr-4 border-r border-border">
              <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold">CTX</span>
              <Select value={currentContext} onValueChange={setContext}>
                <SelectTrigger className="w-44 h-7 bg-transparent border-border hover:border-foreground/20 focus:ring-0 focus:ring-offset-0 text-[11px] font-mono text-foreground rounded-sm px-2">
                  <SelectValue placeholder="select context" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-foreground font-mono">
                  {contexts?.map((ctx) => (
                    <SelectItem key={ctx.name} value={ctx.name} className="text-[11px] font-mono focus:bg-foreground/8 focus:text-foreground">
                      <div className="flex items-center gap-2">
                        {ctx.isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-foreground/40" />}
                        {ctx.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ChevronRight className="w-3 h-3 text-muted-foreground/20 mx-3" />

            <div className="flex items-center gap-2">
              <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold">NS</span>
              <Select value={currentNamespace} onValueChange={setNamespace}>
                <SelectTrigger className="w-44 h-7 bg-transparent border-border hover:border-foreground/20 focus:ring-0 focus:ring-offset-0 text-[11px] font-mono text-foreground rounded-sm px-2">
                  <SelectValue placeholder="select namespace" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-foreground font-mono max-h-64">
                  <SelectItem value="all" className="text-[11px] font-mono focus:bg-foreground/8 focus:text-foreground">
                    * all namespaces
                  </SelectItem>
                  {namespaces?.map((ns) => (
                    <SelectItem key={ns.name} value={ns.name} className="text-[11px] font-mono focus:bg-foreground/8 focus:text-foreground">
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
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border/60 bg-foreground/[0.02] text-muted-foreground hover:text-foreground hover:border-foreground/15 transition-colors"
            title="kubectl command palette (⌘K)"
          >
            <Sparkles className="w-3 h-3" />
            <span className="text-[10px] font-mono">kubectl</span>
            <kbd className="text-[8px] font-bold text-muted-foreground/40 border border-border/60 px-1 py-0.5 rounded">⌘K</kbd>
          </button>
          <ThemeToggle />
          {rightSlot}
        </div>
      </div>

    </header>
  );
}
