/** Adding a user, and the panels a user's row opens: edit, new password, delete. */
import { useState, type FormEvent } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { MIN_PASSWORD, type AdminUser, type Role } from "@shared/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateUser, useDeleteUser, useSetPassword, useUpdateUser } from "@/hooks/use-admin";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { InlineConfirm } from "../InlineConfirm";
import { field, generatePassword, Labeled, parseGroups, PasswordField, RoleSelect } from "./user-fields";

export function AddUser({ onDone }: { onDone: () => void }) {
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
    <form onSubmit={submit} aria-label="Add a user" className="space-y-4 rounded-xl border border-primary/30 bg-primary/[0.03] p-4">
      <h3 className="text-sm font-semibold">New user</h3>
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

export function EditUser({ user, isMe, onDone }: { user: AdminUser; isMe: boolean; onDone: () => void }) {
  const update = useUpdateUser();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [groups, setGroups] = useState(user.groups.join(", "));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ id: user.id, name, role: isMe ? undefined : role, groups: parseGroups(groups) }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} aria-label={`Edit ${user.email}`} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr]">
        <Labeled label="Name"><Input id={`edit-name-${user.id}`} required value={name} onChange={(e) => setName(e.target.value)} className={field} /></Labeled>
        <Labeled label="KubeDeck role" hint={isMe ? "not your own" : undefined}><RoleSelect id={`edit-role-${user.id}`} value={role} onChange={setRole} disabled={isMe} /></Labeled>
        <Labeled label="Groups"><Input id={`edit-groups-${user.id}`} value={groups} onChange={(e) => setGroups(e.target.value)} className={cn(field, "font-mono")} /></Labeled>
      </div>
      {update.error && <p role="alert" className="text-xs text-destructive">{update.error.message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={update.isPending}>{update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <span className="text-[11px] text-muted-foreground">Group changes apply on their next request; no need to sign in again.</span>
      </div>
    </form>
  );
}

export function SetPassword({ user, onDone }: { user: AdminUser; onDone: () => void }) {
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

export function ConfirmDelete({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const del = useDeleteUser();
  return (
    <InlineConfirm action="Delete user" pending={del.isPending} error={del.error} onConfirm={() => del.mutate(user.id, { onSuccess: onDone })} onCancel={onDone}>
      Delete <strong>{user.email}</strong>? Their account and sessions are removed; the audit log keeps their past actions.
    </InlineConfirm>
  );
}
