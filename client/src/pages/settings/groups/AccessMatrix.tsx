/** Every group against every cluster: the service account each uses there, in the order they are tried. */
import type { Group } from "@shared/groups";
import { useClusters } from "@/hooks/use-clusters";
import { AccessBadge, NoAccessBadge } from "./access-view";

export function AccessMatrix({ groups, onOpen }: { groups: Group[]; onOpen: (id: string) => void }) {
  const contexts = (useClusters().data?.clusters ?? []).map((c) => c.name);
  if (groups.length === 0) return <p className="text-sm text-muted-foreground">No groups yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-xs">
        <thead className="bg-muted/30 text-left text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-muted/30 px-4 py-2 font-medium">Group</th>
            {contexts.map((c) => <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 font-mono font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {groups.map((g, i) => (
            <tr key={g.id} className="hover:bg-muted/30">
              <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-normal">
                <button type="button" onClick={() => onOpen(g.id)} className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-medium hover:text-primary">
                  <span className="w-4 text-right text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>{g.name}
                </button>
              </th>
              {contexts.map((c) => {
                const a = g.access.find((x) => x.context === c);
                return <td key={c} className="whitespace-nowrap px-3 py-2">{a ? <AccessBadge access={a} /> : <span className="text-muted-foreground/50">·</span>}</td>;
              })}
            </tr>
          ))}
          <tr className="bg-muted/20">
            <th scope="row" className="sticky left-0 z-10 bg-muted/20 px-4 py-2 text-left text-xs font-normal text-muted-foreground">Not covered</th>
            {contexts.map((c) => <td key={c} className="px-3 py-2"><NoAccessBadge /></td>)}
          </tr>
        </tbody>
      </table>
      <p className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
        Someone in several groups may do what any of their service accounts on a cluster may (tried top to bottom). Where none covers it, they have no access, admins included.
      </p>
    </div>
  );
}
