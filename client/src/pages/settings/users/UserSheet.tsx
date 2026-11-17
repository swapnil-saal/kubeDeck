/**
 * One person, in a panel from the right: their details and groups (with what that gives them on
 * every cluster), and the account actions. Also how a new person is added.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Ban, KeyRound, Loader2, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { MIN_PASSWORD, type AdminUser, type Role } from "@shared/admin";
import type { Group } from "@shared/groups";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useBanUser, useCreateUser, useDeleteUser, useSetPassword, useSignOutEverywhere, useUpdateUser } from "@/hooks/use-admin";
import { useToast } from "@/hooks/use-toast";
import { InlineConfirm } from "../InlineConfirm";
import { AccessPreview, PermissionsPreview } from "../groups/access-view";
import { GroupPicker } from "./GroupPicker";
import { field, generatePassword, Labeled, PasswordField, RoleSelect } from "./user-fields";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}{hint && <span className="ml-2 font-normal normal-case tracking-normal">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

/** Password, sessions, block and delete: each acts at once, so they sit apart from the form. */
function AccountActions({ user, isMe }: { user: AdminUser; isMe: boolean }) {
  const { toast } = useToast();
  const setPassword = useSetPassword();
  const signOut = useSignOutEverywhere();
  const ban = useBanUser();
  const del = useDeleteUser();
  const [panel, setPanel] = useState<"password" | "delete" | null>(null);
  const [password, setPw] = useState(generatePassword);
  const error = signOut.error ?? ban.error;
  const row = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted/60 disabled:opacity-50";

  return (
    <div className="space-y-1">
      <button type="button" className={row} onClick={() => setPanel(panel === "password" ? null : "password")}><KeyRound className="h-4 w-4 text-muted-foreground" /> Set a new password</button>
      {panel === "password" && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <PasswordField id={`password-${user.id}`} value={password} onChange={setPw} />
          <p className="text-[11px] text-muted-foreground">At least {MIN_PASSWORD} characters. Give it to {user.name}; they keep their sessions.</p>
          {setPassword.error && <p role="alert" className="text-xs text-destructive">{setPassword.error.message}</p>}
          <Button size="sm" disabled={setPassword.isPending || password.length < MIN_PASSWORD} onClick={() => setPassword.mutate({ id: user.id, password }, { onSuccess: () => { toast({ title: `New password set for ${user.email}` }); setPanel(null); } })}>
            {setPassword.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Set password
          </Button>
        </div>
      )}
      <button type="button" className={row} disabled={signOut.isPending} onClick={() => signOut.mutate(user.id, { onSuccess: () => toast({ title: `Signed ${user.email} out everywhere` }) })}>
        <LogOut className="h-4 w-4 text-muted-foreground" /> Sign out everywhere
      </button>
      {!isMe && (
        <>
          <button type="button" className={row} disabled={ban.isPending} onClick={() => ban.mutate({ id: user.id, banned: !user.banned })}>
            <Ban className="h-4 w-4 text-muted-foreground" /> {user.banned ? "Unblock sign-in" : "Block sign-in"}
          </button>
          <button type="button" className={`${row} text-destructive hover:bg-destructive/10`} onClick={() => setPanel(panel === "delete" ? null : "delete")}>
            <Trash2 className="h-4 w-4" /> Delete account
          </button>
          {panel === "delete" && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <InlineConfirm action="Delete" pending={del.isPending} error={del.error} onConfirm={() => del.mutate(user.id)} onCancel={() => setPanel(null)}>
                Delete <strong>{user.email}</strong>? The audit log keeps what they did.
              </InlineConfirm>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error.message}</p>}
    </div>
  );
}

/**
 * `user` set: edit them; `user` null: add someone. `open` false closes it. The groups and prefixes
 * come from the Groups list, so the access preview matches what the server will do.
 */
export function UserSheet({ open, user, isMe, groups, onClose }: {
  open: boolean;
  user: AdminUser | null;
  isMe: boolean;
  groups: Group[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const create = useCreateUser();
  const update = useUpdateUser();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [memberOf, setMemberOf] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(user?.name ?? "");
    setEmail(user?.email ?? "");
    setPassword(user ? "" : generatePassword());
    setRole(user?.role ?? "user");
    setMemberOf(user?.groups ?? []);
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (user) update.mutate({ id: user.id, name, role: isMe ? undefined : role, groups: memberOf }, { onSuccess: onClose });
    else create.mutate({ name, email, password, role, groups: memberOf }, { onSuccess: () => { toast({ title: `Added ${email}`, description: "Give them their password; they can sign in now." }); onClose(); } });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby={undefined}>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            {user ? (
              <div className="flex items-center gap-3">
                <PersonAvatar name={user.name} email={user.email} size="lg" muted={user.banned} />
                <div className="min-w-0">
                  <SheetTitle className="flex flex-wrap items-center gap-2 text-base font-semibold">
                    {user.name}
                    {isMe && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                    {user.role === "admin" && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"><ShieldCheck className="h-3 w-3" /> Admin</span>}
                    {user.banned && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">Blocked</span>}
                  </SheetTitle>
                  <SheetDescription className="truncate text-xs text-muted-foreground">{user.email}{user.banReason ? ` · ${user.banReason}` : ""}</SheetDescription>
                </div>
              </div>
            ) : (
              <>
                <SheetTitle className="text-base font-semibold">Add a person</SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground">They sign in with this email and password. Nobody can sign themselves up.</SheetDescription>
              </>
            )}
          </SheetHeader>

          <SheetBody>
            <Section title="Details">
              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} className={field} autoFocus={!user} /></Labeled>
                <Labeled label="KubeDeck role" hint={isMe ? "not your own" : undefined}><RoleSelect id="sheet-role" value={role} onChange={setRole} disabled={isMe} /></Labeled>
                {!user && (
                  <>
                    <Labeled label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} /></Labeled>
                    <Labeled label="Password" hint={`${MIN_PASSWORD}+ characters`}><PasswordField id="sheet-password" value={password} onChange={setPassword} /></Labeled>
                  </>
                )}
              </div>
            </Section>

            <Section title="Groups" hint="what they act as in each cluster">
              <GroupPicker groups={groups} value={memberOf} onChange={setMemberOf} />
            </Section>

            <Section title="Cluster access" hint={user ? "with these groups" : undefined}>
              <AccessPreview groups={groups} memberOf={memberOf} />
            </Section>

            <Section title="KubeDeck permissions" hint={role === "admin" ? "an admin has all" : "from any of their groups"}>
              <PermissionsPreview groups={groups} memberOf={memberOf} admin={role === "admin"} />
            </Section>

            {user && (
              <Section title="Account">
                <AccountActions user={user} isMe={isMe} />
              </Section>
            )}
          </SheetBody>

          <SheetFooter>
            {error && <p role="alert" className="w-full text-xs text-destructive">{error.message}</p>}
            <Button type="submit" size="sm" disabled={pending}>{pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {user ? "Save changes" : "Add person"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            {user && <span className="ml-auto text-[11px] text-muted-foreground">Applies on their next request.</span>}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
