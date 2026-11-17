/** Choosing a person's groups from the ones defined under Settings → Groups, each with what it gives. */
import { Check } from "lucide-react";
import { NO_PERMISSIONS, type Group } from "@shared/groups";
import { cn } from "@/lib/utils";

export function GroupPicker({ groups, value, onChange }: { groups: Group[]; value: string[]; onChange: (groups: string[]) => void }) {
  // a group the account carries that is gone from the list still shows, so it can be taken off
  const extra: Group[] = value.filter((g) => !groups.some((d) => d.id === g)).map((g, i) => ({ id: g, name: g, description: "No longer defined", access: [], position: 1e6 + i, permissions: NO_PERMISSIONS }));
  const all = [...groups, ...extra];
  const toggle = (g: string) => onChange(value.includes(g) ? value.filter((x) => x !== g) : [...value, g].sort());

  if (all.length === 0) return <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No groups yet. Create them under Settings → Groups.</p>;
  return (
    <ul role="group" aria-label="Groups" className="divide-y divide-border/60 rounded-lg border border-border">
      {all.map((g) => {
        const on = value.includes(g.id);
        const clusters = g.access.map((a) => a.context);
        return (
          <li key={g.id}>
            <button
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(g.id)}
              className={cn("flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", on && "bg-primary/[0.04]")}
            >
              <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                {on && <Check className="h-3 w-3" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{g.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {g.description ? `${g.description} · ` : ""}{clusters.length ? clusters.join(", ") : "no clusters"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
