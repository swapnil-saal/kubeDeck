import { useLocation } from "wouter";
import { LayoutDashboard, Waypoints, Workflow } from "lucide-react";
import { useScope } from "@/hooks/use-scope";
import { useTracingEnabled } from "@/hooks/use-traces";
import { cn } from "@/lib/utils";

/** Ways to look at the selected scope: the health summary, the map of how things connect, and traces when Tempo is set up. */
export function OverviewViews() {
  const [location, navigate] = useLocation();
  const { context, namespace } = useScope();
  const tracing = useTracingEnabled(context, namespace);
  const path = location.split("?")[0];
  const views = [
    { label: "Summary", icon: LayoutDashboard, href: "/", active: path !== "/map" && path !== "/traces" },
    { label: "Map", icon: Workflow, href: "/map", active: path === "/map" },
    ...(tracing ? [{ label: "Traces", icon: Waypoints, href: "/traces", active: path === "/traces" }] : []),
  ];
  return (
    <div role="tablist" aria-label="Overview view" className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-secondary/40 p-0.5">
      {views.map((v) => (
        <button
          key={v.label}
          type="button"
          role="tab"
          aria-selected={v.active}
          onClick={() => !v.active && navigate(v.href)}
          className={cn(
            "inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
            v.active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <v.icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{v.label}</span>
        </button>
      ))}
    </div>
  );
}
