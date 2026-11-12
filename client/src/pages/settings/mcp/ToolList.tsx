/** A server's tools, grouped by what the assistant may do with them; hidden ones greyed, with the reason. */
import { BookOpen, EyeOff, ShieldCheck, type LucideIcon } from "lucide-react";
import type { PluginTool } from "@shared/plugins";
import { cn } from "@/lib/utils";
import { ACCESS_LABEL, groupTools, type ToolAccess } from "./mcp-page";

const GROUP: Record<ToolAccess, { icon: LucideIcon; note: string; tone: string }> = {
  read: { icon: BookOpen, note: "The assistant calls these when it needs to.", tone: "text-success" },
  approval: { icon: ShieldCheck, note: "Each call waits until the person in the chat approves it.", tone: "text-warning" },
  hidden: { icon: EyeOff, note: "The assistant never sees these.", tone: "text-muted-foreground" },
};

function Tool({ tool }: { tool: PluginTool }) {
  const hidden = tool.access === "hidden";
  return (
    <li className="min-w-0 py-2">
      <p className={cn("break-all font-mono text-xs font-medium", hidden ? "text-muted-foreground" : "text-foreground")}>{tool.name}</p>
      {tool.description && <p className={cn("mt-0.5 text-xs", hidden ? "text-muted-foreground/80" : "text-muted-foreground")}>{tool.description}</p>}
      {hidden && tool.reason && <p className="mt-0.5 text-[11px] italic text-muted-foreground">{tool.reason}</p>}
    </li>
  );
}

export function ToolList({ catalog, serverName, idPrefix }: { catalog: PluginTool[] | undefined; serverName: string; idPrefix: string }) {
  if (!catalog) {
    return <p className="text-xs text-muted-foreground">The tools show here once {serverName} answers. Switch it on and check its settings.</p>;
  }
  if (catalog.length === 0) return <p className="text-xs text-muted-foreground">{serverName} offers no tools.</p>;
  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      {groupTools(catalog).map(({ access, tools }) => {
        const g = GROUP[access];
        const headingId = `${idPrefix}-tools-${access}`;
        return (
          <section key={access} aria-labelledby={headingId} className={cn("min-w-0 rounded-lg border border-border px-3 pt-2.5", access === "hidden" ? "bg-muted/30" : "bg-background")}>
            <h6 id={headingId} className="flex items-center gap-1.5 text-xs font-semibold">
              <g.icon className={cn("h-3.5 w-3.5 shrink-0", g.tone)} aria-hidden />
              {ACCESS_LABEL[access]}
              <span className="font-normal text-muted-foreground">· {tools.length}</span>
            </h6>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{g.note}</p>
            <ul className="mt-1 divide-y divide-border/60">
              {tools.map((t) => <Tool key={t.name} tool={t} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
