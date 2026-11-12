/** One person in the users list: who, role, groups, status, and their actions menu. */
import { useState } from "react";
import { Ban, KeyRound, LogOut, MoreHorizontal, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import type { AdminUser } from "@shared/admin";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useBanUser, useSignOutEverywhere } from "@/hooks/use-admin";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ConfirmDelete, EditUser, SetPassword } from "./UserForms";

type Panel = "edit" | "password" | "delete" | null;

/** Columns on a wide screen; the header row in UsersSection uses the same template. */
export const USER_COLUMNS = "md:grid-cols-[minmax(0,1.3fr)_5.5rem_minmax(0,1fr)_6rem_2.25rem]";

function Groups({ groups, groupPrefix }: { groups: string[]; groupPrefix: string }) {
  if (!groups.length) return <span className="text-xs text-muted-foreground">No groups: no cluster access</span>;
  return (
    <ul aria-label="Groups" className="flex min-w-0 flex-wrap gap-1">
      {groups.map((g) => (
        <li key={g} title={`Kubernetes group ${groupPrefix}${g}`} className="max-w-full truncate rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 font-mono text-[11px]">{g}</li>
      ))}
    </ul>
  );
}

function Actions({ user, isMe, setPanel, ban, signOutAll }: {
  user: AdminUser;
  isMe: boolean;
  setPanel: (p: Panel) => void;
  ban: ReturnType<typeof useBanUser>;
  signOutAll: ReturnType<typeof useSignOutEverywhere>;
}) {
  const { toast } = useToast();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${user.email}`}><MoreHorizontal className="h-4 w-4" /></Button>
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
    </>
  );
}

/**
 * Wide screens: one row of columns. A phone: name and menu, then role, status and groups under it
 * (the wrapper is `display: contents` on wide screens, so its children become the middle columns).
 */
export function UserRow({ user, isMe, groupPrefix }: { user: AdminUser; isMe: boolean; groupPrefix: string }) {
  const [panel, setPanel] = useState<Panel>(null);
  const ban = useBanUser();
  const signOutAll = useSignOutEverywhere();
  const error = ban.error ?? signOutAll.error;
  const close = () => setPanel(null);
  return (
    <li className="py-3">
      <div className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5", USER_COLUMNS)}>
        <div className={cn("min-w-0", user.banned && "opacity-60")}>
          <div className="truncate text-sm font-medium">{user.name}{isMe && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(you)</span>}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </div>
        <div className="order-last col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 md:contents">
          <div className={cn(user.role !== "admin" && "hidden md:block")}>
            {user.role === "admin" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"><ShieldCheck className="h-3 w-3" /> Admin</span>
            ) : <span className="text-xs text-muted-foreground">User</span>}
          </div>
          <div className="min-w-0"><Groups groups={user.groups} groupPrefix={groupPrefix} /></div>
          <div className={cn("min-w-0 text-xs md:order-none", !user.banned && "hidden md:block")}>
            {user.banned
              ? <span className="text-destructive" title={user.banReason ?? undefined}>Blocked{user.banReason ? `: ${user.banReason}` : ""}</span>
              : <span className="text-muted-foreground">Active</span>}
          </div>
        </div>
        <div className="justify-self-end"><Actions user={user} isMe={isMe} setPanel={setPanel} ban={ban} signOutAll={signOutAll} /></div>
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs text-destructive">{error.message}</p>}
      {panel && (
        <div className="mt-3 rounded-xl border border-border bg-muted/30 p-4">
          {panel === "edit" && <EditUser user={user} isMe={isMe} onDone={close} />}
          {panel === "password" && <SetPassword user={user} onDone={close} />}
          {panel === "delete" && <ConfirmDelete user={user} onDone={close} />}
        </div>
      )}
    </li>
  );
}
