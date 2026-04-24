import { type ReactNode } from "react";
import { useLocation } from "wouter";
import { ChevronRight, Settings, LayoutDashboard, Sparkles, Bot, Box, MessageSquare } from "lucide-react";
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
    <header className="app-header relative z-10 border-b border-border bg-card/95 backdrop-blur-xl">
      <div className="flex items-center h-14 pl-20 pr-5 gap-0">
        {/* Logo */}
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2.5 pr-5 border-r border-border hover:opacity-80 transition-opacity"
        >
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Box className="w-4 h-4 text-primary" />
          </div>
          <span className="text-[13px] font-bold text-foreground tracking-tight">KubeDeck</span>
        </button>

        {/* Nav links */}
        <div className="flex items-center gap-1 px-3 border-r border-border">
          <button
            onClick={() => navigate("/")}
            className={`p-2 rounded-lg transition-all ${
              isActive("/")
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title="Dashboard"
          >
            <LayoutDashboard className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate("/ai")}
            className={`p-2 rounded-lg transition-all ${
              isActive("/ai")
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title="AI Assistant"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate("/settings")}
            className={`p-2 rounded-lg transition-all ${
              isActive("/settings")
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* Breadcrumbs */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="flex items-center gap-0">
            {breadcrumbs.map((crumb, i) => (
              <div key={i} className="flex items-center">
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 mx-2" />
                {crumb.href ? (
                  <button
                    onClick={() => navigate(crumb.href!)}
                    className="text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className="text-[12px] font-semibold text-foreground">
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
            <div className="w-px h-6 bg-border mx-3" />
            <div className="flex items-center gap-2 pr-4">
              <span className="text-[10px] font-semibold text-muted-foreground">Context</span>
              <Select value={currentContext} onValueChange={setContext}>
                <SelectTrigger className="w-44 h-8 bg-muted/50 border-border hover:border-primary/30 focus:ring-1 focus:ring-primary/20 focus:ring-offset-0 text-[12px] text-foreground rounded-lg px-2.5">
                  <SelectValue placeholder="select context" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-foreground rounded-xl">
                  {contexts?.map((ctx) => (
                    <SelectItem key={ctx.name} value={ctx.name} className="text-[12px] focus:bg-primary/10 focus:text-foreground rounded-lg">
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
              <span className="text-[10px] font-semibold text-muted-foreground">Namespace</span>
              <Select value={currentNamespace} onValueChange={setNamespace}>
                <SelectTrigger className="w-44 h-8 bg-muted/50 border-border hover:border-primary/30 focus:ring-1 focus:ring-primary/20 focus:ring-offset-0 text-[12px] text-foreground rounded-lg px-2.5">
                  <SelectValue placeholder="select namespace" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border text-foreground rounded-xl max-h-64">
                  <SelectItem value="all" className="text-[12px] focus:bg-primary/10 focus:text-foreground rounded-lg">
                    All namespaces
                  </SelectItem>
                  {namespaces?.map((ns) => (
                    <SelectItem key={ns.name} value={ns.name} className="text-[12px] focus:bg-primary/10 focus:text-foreground rounded-lg">
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
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all"
            title="kubectl command palette (⌘K)"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium">kubectl</span>
            <kbd className="text-[9px] font-medium text-muted-foreground/50 bg-background border border-border px-1.5 py-0.5 rounded-md ml-1">⌘K</kbd>
          </button>
          <button
            onClick={() => navigate("/ai")}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-lg border transition-all ${
              isActive("/ai")
                ? "bg-primary/15 text-primary border-primary/30"
                : "bg-primary/10 text-primary hover:bg-primary/15 border-primary/20"
            }`}
            title="AI Assistant"
          >
            <Bot className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium">AI</span>
          </button>
          <ThemeToggle />
          {rightSlot}
        </div>
      </div>
    </header>
  );
}
