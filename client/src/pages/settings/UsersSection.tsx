import { useState, type FormEvent, type ReactNode } from "react";
import { Ban, KeyRound, Loader2, LogOut, MoreHorizontal, Pencil, ShieldCheck, Trash2, UserPlus, Wand2 } from "lucide-react";
import { MIN_PASSWORD, type AdminUser, type Role } from "@shared/admin";
import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  useBanUser, useCreateUser, useDeleteUser, useSetPassword, useSignOutEverywhere, useUpdateUser, useUsers,
} from "@/hooks/use-admin";
import { useServerMode } from "@/hooks/use-server-mode";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { InlineConfirm } from "./InlineConfirm";
import { SettingsCard } from "./SettingsCard";

const field = "h-9 rounded-lg border-border bg-muted/50 text-sm focus-visible:ring-primary/20";

/** "shop-editors, viewers" → ["shop-editors", "viewers"] (the server validates each one) */
const parseGroups = (raw: string) => raw.split(/[\s,]+/).map((g) => g.trim().toLowerCase()).filter(Boolean);

/** 24 random characters, for an admin who does not want to invent a password */
function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}

function Labeled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-xs font-medium">
        {label}
        {hint && <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function PasswordField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      <Input id={id} type="text" autoComplete="new-password" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} className={cn(field, "font-mono")} />
      <Button type="button" variant="outline" size="sm" onClick={() => onChange(generatePassword())} title="Make a random password">
        <Wand2 className="h-3.5 w-3.5" /> Generate
      </Button>
      {value && <CopyButton text={value} title="Copy the password" className="shrink-0" />}
    </div>
  );
}

function RoleSelect({ id, value, onChange, disabled }: { id: string; value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  return (
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Role)} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm disabled:opacity-60">
      <option value="user">User</option>
      <option value="admin">Admin: also manages users</option>
    </select>
  );
}

function AddUser({ onDone }: { onDone: () => void }) {
  const create = useCreateUser();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(generatePassword);
  const [role, setRole] = useState<Role>("user");
  const [groups, setGroups] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name, email, password, role, groups: parseGroups(groups) },
      {
        onSuccess: () => {
          toast({ title: `Added ${email}`, description: "Give them their password; they can sign in now." });
          onDone();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="mb-5 space-y-4 rounded-xl border border-primary/30 bg-primary/[0.03] p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Labeled label="Name"><Input id="new-user-name" required value={name} onChange={(e) => setName(e.target.value)} className={field} /></Labeled>
        <Labeled label="Email"><Input id="new-user-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} /></Labeled>
        <Labeled label="Password" hint={`at least ${MIN_PASSWORD} characters`}><PasswordField id="new-user-password" value={password} onChange={setPassword} /></Labeled>
        <Labeled label="KubeDeck role"><RoleSelect id="new-user-role" value={role} onChange={setRole} /></Labeled>
      </div>
      <Labeled label="Groups" hint="comma-separated, e.g. shop-editors, viewers">
        <Input id="new-user-groups" value={groups} onChange={(e) => setGroups(e.target.value)} placeholder="shop-editors" className={cn(field, "font-mono")} />
      </Labeled>
      {create.error && <p role="alert" className="text-xs text-destructive">{create.error.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Add user
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

type Panel = "edit" | "password" | "delete" | null;

function EditUser({ user, isMe, onDone }: { user: AdminUser; isMe: boolean; onDone: () => void }) {
  const update = useUpdateUser();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [groups, setGroups] = useState(user.groups.join(", "));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ id: user.id, name, role: isMe ? undefined : role, groups: parseGroups(groups) }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr]">
        <Labeled label="Name"><Input id={`edit-name-${user.id}`} required value={name} onChange={(e) => setName(e.target.value)} className={field} /></Labeled>
        <Labeled label="KubeDeck role" hint={isMe ? "not your own" : undefined}><RoleSelect id={`edit-role-${user.id}`} value={role} onChange={setRole} disabled={isMe} /></Labeled>
        <Labeled label="Groups"><Input id={`edit-groups-${user.id}`} value={groups} onChange={(e) => setGroups(e.target.value)} className={cn(field, "font-mono")} /></Labeled>
      </div>
      {update.error && <p role="alert" className="text-xs text-destructive">{update.error.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={update.isPending}>{update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Group changes apply on the user's next request; they do not need to sign in again.</p>
    </form>
  );
}

function SetPassword({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const set = useSetPassword();
  const { toast } = useToast();
  const [password, setPassword] = useState(generatePassword);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set.mutate({ id: user.id, password }, { onSuccess: () => { toast({ title: `New password set for ${user.email}` }); onDone(); } });
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Labeled label={`New password for ${user.email}`} hint={`at least ${MIN_PASSWORD} characters`}><PasswordField id={`password-${user.id}`} value={password} onChange={setPassword} /></Labeled>
      {set.error && <p role="alert" className="text-xs text-destructive">{set.error.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={set.isPending}>{set.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Set password</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function ConfirmDelete({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const del = useDeleteUser();
  return (
    <InlineConfirm action="Delete user" pending={del.isPending} error={del.error} onConfirm={() => del.mutate(user.id, { onSuccess: onDone })} onCancel={onDone}>
      Delete <strong>{user.email}</strong>? Their account and sessions are removed; the audit log keeps their past actions.
    </InlineConfirm>
  );
}

function UserRow({ user, isMe, groupPrefix }: { user: AdminUser; isMe: boolean; groupPrefix: string }) {
  const [panel, setPanel] = useState<Panel>(null);
  const ban = useBanUser();
  const signOutAll = useSignOutEverywhere();
  const { toast } = useToast();
  const close = () => setPanel(null);
  return (
    <>
      <tr className={cn("border-t border-border/60 align-middle", user.banned && "opacity-60")}>
        <td className="py-2.5 pr-3">
          <div className="text-sm font-medium">{user.name}{isMe && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(you)</span>}</div>
          <div className="text-xs text-muted-foreground">{user.email}</div>
        </td>
        <td className="py-2.5 pr-3">
          {user.role === "admin" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"><ShieldCheck className="h-3 w-3" /> Admin</span>
          ) : <span className="text-xs text-muted-foreground">User</span>}
        </td>
        <td className="py-2.5 pr-3">
          {user.groups.length ? (
            <div className="flex flex-wrap gap-1">
              {user.groups.map((g) => <span key={g} title={`Kubernetes group ${groupPrefix}${g}`} className="rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 font-mono text-[11px]">{g}</span>)}
            </div>
          ) : <span className="text-xs text-muted-foreground">none: no cluster access</span>}
        </td>
        <td className="py-2.5 pr-3 text-xs">{user.banned ? <span className="text-destructive">Blocked{user.banReason ? `: ${user.banReason}` : ""}</span> : <span className="text-muted-foreground">Active</span>}</td>
        <td className="py-2.5 text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${user.email}`}><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setPanel("edit")}><Pencil className="h-3.5 w-3.5" /> Edit name, role and groups</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPanel("password")}><KeyRound className="h-3.5 w-3.5" /> Set a new password</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => signOutAll.mutate(user.id, { onSuccess: () => toast({ title: `Signed ${user.email} out everywhere` }) })}>
                <LogOut className="h-3.5 w-3.5" /> Sign out everywhere
              </DropdownMenuItem>
              {!isMe && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => ban.mutate({ id: user.id, banned: !user.banned })}>
                    <Ban className="h-3.5 w-3.5" /> {user.banned ? "Unblock" : "Block sign-in"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setPanel("delete")} className="text-destructive focus:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </tr>
      {panel && (
        <tr>
          <td colSpan={5} className="pb-4 pt-1">
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              {panel === "edit" && <EditUser user={user} isMe={isMe} onDone={close} />}
              {panel === "password" && <SetPassword user={user} onDone={close} />}
              {panel === "delete" && <ConfirmDelete user={user} onDone={close} />}
            </div>
          </td>
        </tr>
      )}
      {(ban.error || signOutAll.error) && (
        <tr><td colSpan={5} className="pb-2 text-xs text-destructive" role="alert">{(ban.error ?? signOutAll.error)?.message}</td></tr>
      )}
    </>
  );
}

/** Settings → Users: accounts for KubeDeck's own sign-in, and the groups that become Kubernetes groups. */
export function UsersSection() {
  const { user: me } = useServerMode();
  const users = useUsers();
  const [adding, setAdding] = useState(false);
  const userPrefix = users.data?.userPrefix ?? "kubedeck:";
  const groupPrefix = users.data?.groupPrefix ?? "kubedeck:";
  const example = `kubectl create rolebinding shop-editors --clusterrole=edit --group=${groupPrefix}shop-editors -n shop`;

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Users"
        description="People sign in with their email and password. An admin creates every account; there is no sign-up."
        actions={!adding && <Button size="sm" onClick={() => setAdding(true)}><UserPlus className="h-3.5 w-3.5" /> Add user</Button>}
      >
        {adding && <AddUser onDone={() => setAdding(false)} />}
        {users.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading users…</p>
        ) : users.error ? (
          <p role="alert" className="text-sm text-destructive">{users.error.message}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-medium">Person</th>
                  <th className="pb-2 font-medium">Role</th>
                  <th className="pb-2 font-medium">Groups</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {users.data!.users.map((u) => <UserRow key={u.id} user={u} isMe={u.email === me?.email} groupPrefix={groupPrefix} />)}
              </tbody>
            </table>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="What groups do" description="KubeDeck acts as each person in every cluster, so the cluster's own RBAC decides what they can see and change.">
        <div className="space-y-3 text-xs text-muted-foreground">
          <p>
            A user is sent to Kubernetes as <code className="rounded bg-muted px-1 font-mono text-foreground">{userPrefix}&lt;email&gt;</code>, and each of their groups as{" "}
            <code className="rounded bg-muted px-1 font-mono text-foreground">{groupPrefix}&lt;group&gt;</code>. Bind those groups to roles in each namespace or cluster. Someone with no
            matching binding sees nothing.
          </p>
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
            <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-foreground">{example}</code>
            <CopyButton text={example} title="Copy the command" className="shrink-0" />
          </div>
          <p>The KubeDeck role is separate: an admin manages users and reads the audit log, and has no extra cluster access of their own.</p>
        </div>
      </SettingsCard>
    </div>
  );
}
