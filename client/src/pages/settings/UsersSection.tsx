import { useState } from "react";
import { ChevronRight, Loader2, UserPlus } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { useUsers } from "@/hooks/use-admin";
import { useServerMode } from "@/hooks/use-server-mode";
import { cn } from "@/lib/utils";
import { PageAction, SettingsCard } from "./SettingsCard";
import { AddUser } from "./users/UserForms";
import { USER_COLUMNS, UserRow } from "./users/UserRow";

/** How a user's groups reach the cluster, folded away until someone asks. */
function GroupsHelp({ userPrefix, groupPrefix }: { userPrefix: string; groupPrefix: string }) {
  const example = `kubectl create rolebinding shop-editors --clusterrole=edit --group=${groupPrefix}shop-editors -n shop`;
  const code = "rounded bg-muted px-1 font-mono text-foreground";
  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-open:rotate-90" aria-hidden />
        What groups do
        <span className="hidden font-normal text-muted-foreground sm:inline">· the cluster's RBAC decides what each person can do</span>
      </summary>
      <div className="space-y-3 border-t border-border/60 px-4 py-3.5 text-xs text-muted-foreground sm:px-5">
        <p>
          KubeDeck acts as each person in every cluster. A user is sent to Kubernetes as <code className={code}>{userPrefix}&lt;email&gt;</code>, and each of
          their groups as <code className={code}>{groupPrefix}&lt;group&gt;</code>. Bind those groups to roles in each namespace or cluster; someone with no
          matching binding sees nothing.
        </p>
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
          <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-foreground">{example}</code>
          <CopyButton text={example} title="Copy the command" className="shrink-0" />
        </div>
        <p>The KubeDeck role is separate: an admin manages users and reads the audit log, and has no extra cluster access of their own.</p>
      </div>
    </details>
  );
}

/** Settings → Users: accounts for KubeDeck's own sign-in, and the groups that become Kubernetes groups. */
export function UsersSection() {
  const { user: me } = useServerMode();
  const users = useUsers();
  const [adding, setAdding] = useState(false);
  const userPrefix = users.data?.userPrefix ?? "kubedeck:";
  const groupPrefix = users.data?.groupPrefix ?? "kubedeck:";

  return (
    <div className="space-y-4">
      <PageAction>
        <Button size="sm" onClick={() => setAdding(true)} disabled={adding}><UserPlus className="h-3.5 w-3.5" /> Add user</Button>
      </PageAction>
      {adding && <AddUser onDone={() => setAdding(false)} />}

      <SettingsCard>
        {users.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading users…</p>
        ) : users.error ? (
          <p role="alert" className="text-sm text-destructive">{users.error.message}</p>
        ) : (
          <>
            <div aria-hidden className={cn("hidden gap-x-3 border-b border-border/60 pb-2 text-[11px] font-medium text-muted-foreground md:grid", USER_COLUMNS)}>
              <span>Person</span><span>Role</span><span>Groups</span><span>Status</span><span />
            </div>
            <ul aria-label="Users" className="-my-3 divide-y divide-border/60 md:my-0">
              {users.data!.users.map((u) => <UserRow key={u.id} user={u} isMe={u.email === me?.email} groupPrefix={groupPrefix} />)}
            </ul>
          </>
        )}
      </SettingsCard>

      <GroupsHelp userPrefix={userPrefix} groupPrefix={groupPrefix} />
    </div>
  );
}
