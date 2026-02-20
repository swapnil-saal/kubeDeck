import { useK8sContexts } from "@/hooks/use-k8s";
import { cn } from "@/lib/utils";
import { Server, Activity, HardDrive, Box, Cloud, Settings } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface SidebarProps {
  currentContext: string;
  onContextChange: (ctx: string) => void;
}

export function Sidebar({ currentContext, onContextChange }: SidebarProps) {
  const { data: contexts, isLoading } = useK8sContexts();

  return (
    <div className="w-64 border-r border-border/50 bg-card/50 flex flex-col h-screen">
      <div className="p-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/20 rounded-lg">
            <Activity className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">KubeDeck</h1>
            <p className="text-xs text-muted-foreground font-mono">v1.2.0-rc</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-4 py-4">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4 px-2">
            Contexts
          </h2>
          <ScrollArea className="h-[calc(100vh-250px)]">
            <div className="space-y-1 pr-4">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full bg-secondary/50 mb-2" />
                ))
              ) : (
                contexts?.map((ctx) => (
                  <button
                    key={ctx.name}
                    onClick={() => onContextChange(ctx.name)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
                      currentContext === ctx.name
                        ? "bg-primary/15 text-primary shadow-sm ring-1 ring-primary/20"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    )}
                  >
                    <Server className={cn(
                      "w-4 h-4 transition-colors",
                      currentContext === ctx.name ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                    )} />
                    <span className="truncate flex-1 text-left">{ctx.name}</span>
                    {currentContext === ctx.name && (
                      <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      <div className="p-4 border-t border-border/50 bg-secondary/10">
        <div className="space-y-1">
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}
