import { useEffect } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard, MessageSquare, Settings, Server, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useK8sContexts, useK8sNamespaces } from "@/hooks/use-k8s";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { KubeDeckLogo } from "@/components/KubeDeckLogo";

const NAV = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/ai", label: "AI Assistant", icon: MessageSquare },
  { path: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppSidebar() {
  const [location, navigate] = useLocation();
  const { context: currentContext, namespace: currentNamespace, setContext, setNamespace } = useTerminalStore();
  const { data: contexts, isLoading: contextsLoading } = useK8sContexts();
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

  const openPalette = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  };

  return (
    <aside className="w-60 border-r border-sidebar-border bg-sidebar flex flex-col justify-between shrink-0 h-full text-sidebar-foreground">
      {/* Electron traffic-light drag strip */}
      <div className="app-header h-11 shrink-0" />

      <div className="flex-1 flex flex-col min-h-0 px-3 pb-3 gap-5">
        {/* Branding */}
        <button
          onClick={() => navigate("/")}
          className="app-no-drag flex flex-col items-start gap-1.5 px-1 hover:opacity-85 transition-opacity"
        >
          <KubeDeckLogo size="xl" />
          <p className="text-[10px] text-sidebar-foreground/50 font-medium pl-0.5">
            Kubernetes navigator
          </p>
        </button>

        {/* Navigation */}
        <div>
          <p className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-widest px-1 mb-1.5">
            Navigate
          </p>
          <nav className="space-y-0.5">
            {NAV.map((item) => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors text-sm",
                    active
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Cluster scope */}
        <div className="space-y-3">
          <p className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-widest px-1 mb-1.5">
            Cluster
          </p>

          <div className="space-y-1.5 px-0.5">
            <label className="text-[10px] font-semibold text-sidebar-foreground/50 px-0.5">Context</label>
            <Select value={currentContext} onValueChange={setContext}>
              <SelectTrigger className="w-full h-8 bg-sidebar-accent/50 border-sidebar-border hover:border-primary/30 focus:ring-1 focus:ring-primary/20 focus:ring-offset-0 text-xs text-sidebar-foreground rounded-lg px-2.5">
                <SelectValue placeholder="Select context" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border text-foreground rounded-xl">
                {contextsLoading ? (
                  <div className="p-2 space-y-1">
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-6 w-full" />
                  </div>
                ) : (
                  contexts?.map((ctx) => (
                    <SelectItem key={ctx.name} value={ctx.name} className="text-xs focus:bg-primary/10 focus:text-foreground rounded-lg">
                      <div className="flex items-center gap-2">
                        <Server size={12} className="text-muted-foreground shrink-0" />
                        {ctx.isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                        <span className="truncate">{ctx.name}</span>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 px-0.5">
            <label className="text-[10px] font-semibold text-sidebar-foreground/50 px-0.5">Namespace</label>
            <Select value={currentNamespace} onValueChange={setNamespace}>
              <SelectTrigger className="w-full h-8 bg-sidebar-accent/50 border-sidebar-border hover:border-primary/30 focus:ring-1 focus:ring-primary/20 focus:ring-offset-0 text-xs text-sidebar-foreground rounded-lg px-2.5">
                <SelectValue placeholder="Select namespace" />
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

          {contexts && contexts.length > 1 && (
            <ScrollArea className="max-h-28 mt-1">
              <div className="space-y-0.5 pr-2">
                {contexts.map((ctx) => (
                  <button
                    key={ctx.name}
                    onClick={() => setContext(ctx.name)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors",
                      currentContext === ctx.name
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Server size={12} className="shrink-0" />
                    <span className="truncate flex-1 text-left">{ctx.name}</span>
                    {currentContext === ctx.name && (
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)] shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className="p-3 border-t border-sidebar-border space-y-1">
        <button
          onClick={openPalette}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          title="kubectl command palette (⌘K)"
        >
          <Sparkles size={16} />
          <span className="flex-1 text-left">kubectl</span>
          <kbd className="text-[9px] font-medium text-sidebar-foreground/50 bg-sidebar-accent border border-sidebar-border px-1.5 py-0.5 rounded-md">⌘K</kbd>
        </button>
      </div>
    </aside>
  );
}
