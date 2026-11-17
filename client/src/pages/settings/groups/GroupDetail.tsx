/** The selected group: what it acts as on each cluster, and who is in it. */
import { useState } from "react";
import { ChevronDown, Link, Link2, Loader2, MoreHorizontal, Pencil, Shield, ShieldCheck, Trash2, UserCog, UserMinus, UserPlus } from "lucide-react";
import { useLocation } from "wouter";
import type { AdminUser } from "@shared/admin";
import { APP_PERMISSIONS, type ClusterAccess, type Group } from "@shared/groups";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAccess } from "@/hooks/use-access";
import { useUpdateUser } from "@/hooks/use-admin";
import { useDeleteGroup } from "@/hooks/use-groups";
import { InlineConfirm } from "../InlineConfirm";
import { AccessBadge } from "./access-view";

/** The service account a group's access names: picked, or read off an uploaded kubeconfig's identity. */
function accountOf(a: ClusterAccess): { namespace: string; name: string } | null {
  if (a.as === "serviceaccount") return { namespace: a.namespace, name: a.serviceAccount };
  const m = /^system:serviceaccount:([^:]+):(.+)$/.exec(a.identity ?? "");
  return m ? { namespace: m[1], name: m[2] } : null;
}

/** The menu's items, checked against your own access on that cluster when the menu opens. */
function RbacItems({ access, sa }: { access: ClusterAccess; sa: { namespace: string; name: string } | null }) {
  const [, navigate] = useLocation();
  const ns = sa?.namespace ?? "default";
  const { denied } = useAccess(access.context, [ns]);
  const at = (path: string, namespace?: string) =>
    navigate(`${path}?context=${encodeURIComponent(access.context)}${namespace ? `&namespace=${encodeURIComponent(namespace)}` : ""}`);
  const items = [
    sa && { show: !denied(ns, "get", "serviceaccounts"), icon: UserCog, label: `Service account ${sa.namespace}/${sa.name}`, go: () => at(`/resource/serviceaccounts/${encodeURIComponent(sa.name)}`, sa.namespace) },
    sa && { show: !denied(ns, "list", "rolebindings", "rbac.authorization.k8s.io"), icon: Link2, label: `Role bindings in ${sa.namespace}`, go: () => at("/resources/rolebindings", sa.namespace) },
    sa && { show: !denied(ns, "list", "roles", "rbac.authorization.k8s.io"), icon: Shield, label: `Roles in ${sa.namespace}`, go: () => at("/resources/roles", sa.namespace) },
    { show: !denied(ns, "list", "rolebindings", "rbac.authorization.k8s.io"), icon: Link2, label: "Role bindings, all namespaces", go: () => at("/resources/rolebindings", "all") },
    { show: !denied(ns, "list", "clusterrolebindings", "rbac.authorization.k8s.io"), icon: Link, label: "Cluster role bindings", go: () => at("/resources/clusterrolebindings") },
  ].filter((i): i is NonNullable<typeof i> => !!i && i.show);
  if (denied(ns, "get", "serviceaccounts") === "Checking your access…") {
    return <p className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking your access on {access.context}…</p>;
  }
  if (items.length === 0) {
    return <p className="px-2 py-1.5 text-[11px] text-muted-foreground">Your own access on {access.context} cannot read these. A cluster admin checks them with kubectl.</p>;
  }
  return <>{items.map(({ icon: Icon, label, go }) => <DropdownMenuItem key={label} onSelect={go}><Icon className="h-3.5 w-3.5" /> {label}</DropdownMenuItem>)}</>;
}

/** The cluster's own RBAC decides what a service account may do: open it in KubeDeck's resource pages. */
function RbacLinks({ access }: { access: ClusterAccess }) {
  const sa = accountOf(access);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" aria-label={`RBAC on ${access.context}`}><ShieldCheck className="h-3 w-3" /> RBAC <ChevronDown className="h-3 w-3" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          What {sa ? <code className="font-mono">{sa.name}</code> : "this account"} may do is set by Roles and RoleBindings on {access.context}.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <RbacItems access={access} sa={sa} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccessTable({ group }: { group: Group }) {
  if (group.access.length === 0) {
    return <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No clusters yet: its people reach no cluster through it.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full table-fixed text-xs">
        <thead className="bg-muted/30 text-left text-[11px] text-muted-foreground">
          <tr><th className="w-[30%] px-3 py-1.5 font-medium">Cluster</th><th className="px-3 py-1.5 font-medium">Service account</th><th className="w-28 px-3 py-1.5" /></tr>
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
              <td className="px-3 py-2 text-right"><RbacLinks access={a} /></td>
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

export function GroupDetail({ group, users, rank, onEdit }: { group: Group; users: AdminUser[]; rank: number; onEdit: () => void }) {
  const del = useDeleteGroup();
  const [confirm, setConfirm] = useState(false);
  const members = users.filter((u) => u.groups.includes(group.id)).length;

  return (
    <div className="min-w-0 space-y-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">{group.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {group.description ? `${group.description} · ` : ""}tried {rank === 1 ? "first" : `${rank}${rank === 2 ? "nd" : rank === 3 ? "rd" : "th"}`}
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
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">KubeDeck permissions</h4>
        <ul aria-label="KubeDeck permissions" className="flex flex-wrap gap-1.5">
          {APP_PERMISSIONS.map((p) => (
            <li key={p.key} title={p.help} className={group.permissions[p.key]
              ? "rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
              : "rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground line-through"}>
              {p.label}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">People <span className="font-normal tabular-nums">{members}</span></h4>
        <People group={group} users={users} />
      </section>
    </div>
  );
}
