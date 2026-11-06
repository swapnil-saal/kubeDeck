import { useLocation } from "wouter";
import { LayoutDashboard, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

/** Two ways to look at the selected scope: the health summary, or the map of how things connect. */
export function OverviewViews() {
  const [location, navigate] = useLocation();
  const onMap = location.split("?")[0] === "/map";
  const views = [
    { label: "Summary", icon: LayoutDashboard, href: "/", active: !onMap },
    { label: "Map", icon: Workflow, href: "/map", active: onMap },
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
