import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { AuditEntry } from "@shared/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAudit } from "@/hooks/use-admin";
import { useServerMode } from "@/hooks/use-server-mode";
import { cn } from "@/lib/utils";
import { SettingsCard } from "./SettingsCard";

const VERB: Record<string, string> = { POST: "Ran", PUT: "Replaced", PATCH: "Changed", DELETE: "Deleted" };

/** "POST /api/k8s/deployments/web/scale" → "deployments/web/scale" */
const what = (e: AuditEntry) => e.path.replace(/^\/api\/(k8s\/)?/, "");

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Row({ e }: { e: AuditEntry }) {
  const ok = e.status < 400;
  return (
    <tr className="border-t border-border/60 align-top text-xs">
      <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-muted-foreground" title={e.at}>{when(e.at)}</td>
      <td className="py-2 pr-3">
        <div className="font-medium">{e.userEmail || e.userName || "unknown"}</div>
        {e.groups && <div className="font-mono text-[11px] text-muted-foreground">{e.groups.split(",").join(", ")}</div>}
      </td>
      <td className="py-2 pr-3">
        <div><span className="text-muted-foreground">{VERB[e.method] ?? e.method}</span> <span className="font-mono">{what(e)}</span></div>
        {e.detail && <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{e.detail}</div>}
      </td>
      <td className="whitespace-nowrap py-2 pr-3 font-mono text-[11px] text-muted-foreground">{[e.context, e.namespace].filter(Boolean).join(" / ") || "–"}</td>
      <td className="py-2">
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums", ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
          {ok ? "Done" : e.status === 403 ? "Refused" : "Failed"} · {e.status}
        </span>
      </td>
    </tr>
  );
}

/** Settings → Audit log: every change made through KubeDeck, newest first. */
export function AuditSection() {
  const [user, setUser] = useState("");
  const [filter, setFilter] = useState("");
  const audit = useAudit(filter);
  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? [];
  // the desktop has one user, with no email to filter by
  const shared = useServerMode().mode === "web";

  return (
    <SettingsCard
      title="Audit log"
      description="Every change made through KubeDeck: scaling, edits, deletes, kubectl commands and the assistant's actions, with who made it and whether the cluster allowed it."
    >
      {shared && <form
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(ev) => { ev.preventDefault(); setFilter(user.trim().toLowerCase()); }}
      >
        <Input id="audit-user" type="email" placeholder="Filter by email" value={user} onChange={(ev) => setUser(ev.target.value)} className="h-8 w-64 rounded-lg text-xs" />
        <Button type="submit" size="sm" variant="outline">Filter</Button>
        {filter && <Button type="button" size="sm" variant="ghost" onClick={() => { setUser(""); setFilter(""); }}>Show everyone</Button>}
      </form>}
      {audit.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : audit.error ? (
        <p role="alert" className="text-sm text-destructive">{audit.error.message}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{filter ? `No changes by ${filter} yet.` : "No changes yet. Scaling, editing or deleting anything shows up here."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 font-medium">When</th>
                <th className="pb-2 font-medium">Who</th>
                <th className="pb-2 font-medium">What</th>
                <th className="pb-2 font-medium">Where</th>
                <th className="pb-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>{entries.map((e) => <Row key={e.id} e={e} />)}</tbody>
          </table>
          {audit.hasNextPage && (
            <Button size="sm" variant="outline" className="mt-4" disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
              {audit.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Show older
            </Button>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
