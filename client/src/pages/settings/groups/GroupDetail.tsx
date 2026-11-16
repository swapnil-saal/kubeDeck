/** The selected group: what it acts as on each cluster, and who is in it. */
import { useState } from "react";
import { Loader2, MoreHorizontal, Pencil, Trash2, UserMinus, UserPlus } from "lucide-react";
import type { AdminUser } from "@shared/admin";
import type { Group } from "@shared/groups";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useUpdateUser } from "@/hooks/use-admin";
import { useDeleteGroup } from "@/hooks/use-groups";
import { InlineConfirm } from "../InlineConfirm";
import { AccessBadge } from "./access-view";

function AccessTable({ group }: { group: Group }) {
  if (group.access.length === 0) {
    return <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No clusters. Its people act as themselves everywhere.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full table-fixed text-xs">
        <thead className="bg-muted/30 text-left text-[11px] text-muted-foreground">
          <tr><th className="w-[34%] px-3 py-1.5 font-medium">Cluster</th><th className="px-3 py-1.5 font-medium">Service account</th></tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {group.access.map((a) => (
            <tr key={a.context}>
              <td className="truncate px-3 py-2 align-top font-mono">{a.context}</td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <AccessBadge access={a} />
                  <span className="text-[11px] text-muted-foreground">{a.as === "serviceaccount" ? "impersonated" : `uploaded kubeconfig${a.server ? ` · ${a.server}` : ""}`}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function People({ group, users }: { group: Group; users: AdminUser[] }) {
  const update = useUpdateUser();
  const [adding, setAdding] = useState("");
  const members = users.filter((u) => u.groups.includes(group.id));
  const others = users.filter((u) => !u.groups.includes(group.id));
  const setIn = (u: AdminUser, inGroup: boolean) =>
    update.mutate({ id: u.id, groups: inGroup ? [...u.groups, group.id] : u.groups.filter((g) => g !== group.id) }, { onSuccess: () => setAdding("") });

  return (
    <div className="space-y-2">
      {members.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">Nobody yet.</p>
      ) : (
        <ul aria-label={`People in ${group.name}`} className="divide-y divide-border/60 rounded-lg border border-border">
          {members.map((u) => (
            <li key={u.id} className="flex items-center gap-2.5 px-3 py-2">
              <PersonAvatar name={u.name} email={u.email} size="sm" muted={u.banned} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{u.name}{u.banned && <span className="ml-1.5 text-[11px] text-destructive">blocked</span>}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{u.email}</span>
              </span>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" disabled={update.isPending} onClick={() => setIn(u, false)} aria-label={`Take ${u.email} out of ${group.name}`} title="Take out of the group">
                <UserMinus className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <div className="flex gap-2">
          <select aria-label={`Add someone to ${group.name}`} value={adding} onChange={(e) => setAdding(e.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-xs">
            <option value="">Add someone…</option>
            {others.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
          </select>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1" disabled={!adding || update.isPending} onClick={() => { const u = others.find((x) => x.id === adding); if (u) setIn(u, true); }}>
            {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Add
          </Button>
        </div>
      )}
      {update.error && <p role="alert" className="text-xs text-destructive">{update.error.message}</p>}
    </div>
  );
}

export function GroupDetail({ group, users, groupPrefix, rank, onEdit }: { group: Group; users: AdminUser[]; groupPrefix: string; rank: number; onEdit: () => void }) {
  const del = useDeleteGroup();
  const [confirm, setConfirm] = useState(false);
  const members = users.filter((u) => u.groups.includes(group.id)).length;

  return (
    <div className="min-w-0 space-y-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">{group.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {group.description ? `${group.description} · ` : ""}priority {rank} · <code className="font-mono">{groupPrefix}{group.id}</code>
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`More for ${group.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setConfirm(true)} className="text-destructive focus:text-destructive"><Trash2 className="h-3.5 w-3.5" /> Delete group</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {confirm && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          {members > 0 ? (
            <div className="flex items-center gap-3 text-xs">
              <p className="flex-1">Take its {members} {members === 1 ? "person" : "people"} out of {group.name} first.</p>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>OK</Button>
            </div>
          ) : (
            <InlineConfirm action="Delete group" pending={del.isPending} error={del.error} onConfirm={() => del.mutate(group.id)} onCancel={() => setConfirm(false)}>
              Delete <strong>{group.name}</strong> and its cluster access?
            </InlineConfirm>
          )}
        </div>
      )}

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cluster access</h4>
        <AccessTable group={group} />
      </section>
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">People <span className="font-normal tabular-nums">{members}</span></h4>
        <People group={group} users={users} />
      </section>
    </div>
  );
}
