import { useMemo, useState } from "react";
import { ChevronRight, Loader2, Search, ShieldCheck, UserPlus } from "lucide-react";
import type { AdminUser } from "@shared/admin";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { useUsers } from "@/hooks/use-admin";
import { useGroups } from "@/hooks/use-groups";
import { useServerMode } from "@/hooks/use-server-mode";
import { cn } from "@/lib/utils";
import { PageAction } from "./SettingsCard";
import { UserSheet } from "./users/UserSheet";

type Filter = "all" | "admins" | "blocked";

/** Columns on a wide screen; the header row uses the same template. */
const COLUMNS = "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_5.5rem_5rem_1rem]";

function Segmented({ value, onChange, counts }: { value: Filter; onChange: (f: Filter) => void; counts: Record<Filter, number> }) {
  const items: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, { id: "admins", label: "Admins" }, { id: "blocked", label: "Blocked" }];
  return (
    <div role="tablist" aria-label="Show" className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          role="tab"
          aria-selected={value === i.id}
          onClick={() => onChange(i.id)}
          className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium", value === i.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {i.label}<span className="tabular-nums text-muted-foreground">{counts[i.id]}</span>
        </button>
      ))}
    </div>
  );
}

function UserRow({ user, isMe, groupName, onOpen }: { user: AdminUser; isMe: boolean; groupName: (id: string) => string; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn("grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5", COLUMNS)}
      >
        <span className={cn("flex min-w-0 items-center gap-3", user.banned && "opacity-60")}>
          <PersonAvatar name={user.name} email={user.email} muted={user.banned} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.name}{isMe && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(you)</span>}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
        </span>
        <span className="order-last col-span-2 flex min-w-0 flex-wrap gap-1 pl-11 md:order-none md:col-span-1 md:pl-0">
          {user.groups.length === 0
            ? <span className="text-xs text-muted-foreground">No groups</span>
            : user.groups.map((g) => <span key={g} className="max-w-full truncate rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 text-[11px]">{groupName(g)}</span>)}
        </span>
        <span className="hidden md:block">
          {user.role === "admin"
            ? <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"><ShieldCheck className="h-3 w-3" /> Admin</span>
            : <span className="text-xs text-muted-foreground">User</span>}
        </span>
        <span className="hidden items-center gap-1.5 text-xs md:flex" title={user.banReason ?? undefined}>
          <span className={cn("h-1.5 w-1.5 rounded-full", user.banned ? "bg-destructive" : "bg-success")} />
          <span className={user.banned ? "text-destructive" : "text-muted-foreground"}>{user.banned ? "Blocked" : "Active"}</span>
        </span>
        <ChevronRight className="h-4 w-4 justify-self-end text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}

/** Settings → Users: everyone who can sign in, found by name, role, state or group; each opens in a panel. */
export function UsersSection() {
  const { user: me } = useServerMode();
  const users = useUsers();
  const groups = useGroups();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [group, setGroup] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const all = users.data?.users ?? [];
  const defined = groups.data?.groups ?? [];
  const groupName = (id: string) => defined.find((g) => g.id === id)?.name ?? id;
  const counts = { all: all.length, admins: all.filter((u) => u.role === "admin").length, blocked: all.filter((u) => u.banned).length };
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((u) =>
      (filter === "all" || (filter === "admins" ? u.role === "admin" : u.banned)) &&
      (!group || u.groups.includes(group)) &&
      (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)));
  }, [all, query, filter, group]);
  // a person deleted from their own panel closes it
  const open = openId ? all.find((u) => u.id === openId) ?? null : null;

  return (
    <div className="space-y-4">
      <PageAction>
        <Button size="sm" onClick={() => setAdding(true)}><UserPlus className="h-3.5 w-3.5" /> Add person</Button>
      </PageAction>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find by name or email" aria-label="Find people" className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2.5 text-sm outline-none focus:border-primary/50" />
        </label>
        <Segmented value={filter} onChange={setFilter} counts={counts} />
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Only people in group" className="h-8 rounded-lg border border-border bg-background px-2 text-xs">
          <option value="">Any group</option>
          {defined.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div aria-hidden className={cn("hidden gap-x-4 border-b border-border/60 bg-muted/30 px-5 py-2 text-[11px] font-medium text-muted-foreground md:grid", COLUMNS)}>
          <span>Person</span><span>Groups</span><span>Role</span><span>Status</span><span />
        </div>
        {users.isLoading ? (
          <p className="flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading people…</p>
        ) : users.error ? (
          <p role="alert" className="px-5 py-4 text-sm text-destructive">{users.error.message}</p>
        ) : shown.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nobody matches.</p>
        ) : (
          <ul aria-label="People" className="divide-y divide-border/60">
            {shown.map((u) => <UserRow key={u.id} user={u} isMe={u.email === me?.email} groupName={groupName} onOpen={() => setOpenId(u.id)} />)}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        A person's groups decide the service account they use on each cluster (Settings → Groups). An admin also manages people, groups, plugins and
        the audit log, and uses KubeDeck's own credentials on clusters none of their groups covers.
      </p>

      <UserSheet
        open={adding || open !== null}
        user={adding ? null : open}
        isMe={!adding && open?.email === me?.email}
        groups={defined}
        userPrefix={groups.data?.userPrefix ?? users.data?.userPrefix ?? "kubedeck:"}
        onClose={() => { setAdding(false); setOpenId(null); }}
      />
    </div>
  );
}
