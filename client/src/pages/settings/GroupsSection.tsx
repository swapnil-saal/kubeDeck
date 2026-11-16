import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Grid3x3, List, Loader2, Plus } from "lucide-react";
import { AvatarStack } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { useUsers } from "@/hooks/use-admin";
import { useGroups, useReorderGroups } from "@/hooks/use-groups";
import { cn } from "@/lib/utils";
import { PageAction } from "./SettingsCard";
import { AccessMatrix } from "./groups/AccessMatrix";
import { GroupDetail } from "./groups/GroupDetail";
import { GroupSheet } from "./groups/GroupSheet";

/** How a person's groups pick whom KubeDeck acts as, folded away until someone asks. */
function HowItWorks({ userPrefix, groupPrefix }: { userPrefix: string; groupPrefix: string }) {
  const code = "rounded bg-muted px-1 font-mono text-foreground";
  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-open:rotate-90" aria-hidden />
        How groups decide access
      </summary>
      <ul className="list-disc space-y-1.5 border-t border-border/60 py-3.5 pl-9 pr-4 text-xs text-muted-foreground sm:pr-5">
        <li><strong className="text-foreground">Service account:</strong> pick one from the cluster and KubeDeck impersonates it (<code className={code}>--as=system:serviceaccount:&lt;ns&gt;:&lt;name&gt;</code>). KubeDeck's credentials for that cluster need the <code className={code}>impersonate</code> permission on it.</li>
        <li><strong className="text-foreground">Uploaded kubeconfig:</strong> where KubeDeck may not impersonate, upload the service account's kubeconfig (a token or client certificate). It is kept encrypted and people in the group run with it on that cluster.</li>
        <li>When several of someone's groups cover the same cluster, the higher group in the list wins. Use the arrows to order them.</li>
        <li>On a cluster none of their groups covers, a KubeDeck admin uses KubeDeck's own credentials; anyone else acts as themselves, <code className={code}>{userPrefix}&lt;email&gt;</code> in groups <code className={code}>{groupPrefix}&lt;group&gt;</code>, so RoleBindings to those names apply.</li>
        <li>The palette and the assistant refuse <code className={code}>--user</code>, <code className={code}>--cluster</code>, <code className={code}>--as</code> and <code className={code}>--token</code>, so nobody steps outside what their group gives them.</li>
      </ul>
    </details>
  );
}

type View = "groups" | "clusters";

/** Settings → Groups: the groups in priority order beside the selected one, or all of them against every cluster. */
export function GroupsSection() {
  const groups = useGroups();
  const users = useUsers();
  const reorder = useReorderGroups();
  const [view, setView] = useState<View>("groups");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"new" | "edit" | null>(null);

  const list = groups.data?.groups ?? [];
  const people = users.data?.users ?? [];
  const selected = list.find((g) => g.id === selectedId) ?? list[0];
  const rank = selected ? list.indexOf(selected) + 1 : 0;
  const prefixes = { userPrefix: groups.data?.userPrefix ?? "kubedeck:", groupPrefix: groups.data?.groupPrefix ?? "kubedeck:" };
  const move = (i: number, by: -1 | 1) => {
    const ids = list.map((g) => g.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    reorder.mutate(ids);
  };

  return (
    <div className="space-y-4">
      <PageAction>
        <Button size="sm" onClick={() => setSheet("new")}><Plus className="h-3.5 w-3.5" /> New group</Button>
      </PageAction>

      <div role="tablist" aria-label="View" className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {([["groups", "Groups", List], ["clusters", "By cluster", Grid3x3]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
            className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium", view === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {groups.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading groups…</p>
      ) : groups.error ? (
        <p role="alert" className="text-sm text-destructive">{groups.error.message}</p>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm font-medium">No groups yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">Create a group such as Developers, give it a service account on each cluster, then add people.</p>
          <Button size="sm" className="mt-4" onClick={() => setSheet("new")}><Plus className="h-3.5 w-3.5" /> New group</Button>
        </div>
      ) : view === "clusters" ? (
        <AccessMatrix groups={list} onOpen={(id) => { setSelectedId(id); setView("groups"); }} />
      ) : (
        <div className="grid overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[15rem_minmax(0,1fr)]">
          <ol aria-label="Groups, highest priority first" className="divide-y divide-border/60 border-b border-border md:border-b-0 md:border-r">
            {list.map((g, i) => {
              const members = people.filter((u) => u.groups.includes(g.id));
              const on = g.id === selected?.id;
              return (
                <li key={g.id} className={cn("group/item relative", on && "bg-primary/[0.06]")}>
                  {on && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                  <button type="button" onClick={() => setSelectedId(g.id)} aria-current={on ? "true" : undefined} className="flex w-full items-start gap-2.5 px-3.5 py-3 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span className="mt-0.5 w-3.5 text-right text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className={cn("block truncate text-sm font-medium", on && "text-primary")}>{g.name}</span>
                      <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {g.access.length} {g.access.length === 1 ? "cluster" : "clusters"}
                        {members.length > 0 ? <AvatarStack people={members} max={3} /> : <span>· nobody</span>}
                      </span>
                    </span>
                  </button>
                  <span className="absolute right-1.5 top-2 flex flex-col opacity-0 focus-within:opacity-100 group-hover/item:opacity-100">
                    <button type="button" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} aria-label={`Move ${g.name} up`} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                    <button type="button" disabled={i === list.length - 1 || reorder.isPending} onClick={() => move(i, 1)} aria-label={`Move ${g.name} down`} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="p-4 sm:p-5">
            {selected && <GroupDetail group={selected} users={people} groupPrefix={prefixes.groupPrefix} rank={rank} onEdit={() => setSheet("edit")} />}
          </div>
        </div>
      )}
      {reorder.error && <p role="alert" className="text-xs text-destructive">{reorder.error.message}</p>}
      <HowItWorks {...prefixes} />

      <GroupSheet
        open={sheet !== null}
        group={sheet === "edit" ? selected ?? null : null}
        groupPrefix={prefixes.groupPrefix}
        onClose={() => setSheet(null)}
        onSaved={(id) => setSelectedId(id)}
      />
    </div>
  );
}
