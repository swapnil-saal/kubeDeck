import { useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { AuditEntry } from "@shared/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAudit, useUsers } from "@/hooks/use-admin";
import { useServerMode } from "@/hooks/use-server-mode";
import { cn } from "@/lib/utils";
import { auditExactTime, auditOutcome, auditWhen, describeAudit, type AuditOutcome, type EmailOf } from "./audit-format";
import { SettingsCard } from "./SettingsCard";

const OUTCOME: Record<AuditOutcome, { label: string; className: string }> = {
  done: { label: "Done", className: "border-success/30 bg-success/10 text-success" },
  refused: { label: "Refused", className: "border-warning/30 bg-warning/10 text-warning" },
  failed: { label: "Failed", className: "border-destructive/30 bg-destructive/10 text-destructive" },
};

function OutcomeChip({ status }: { status: number }) {
  const o = OUTCOME[auditOutcome(status)];
  return (
    <span title={`HTTP ${status}`} className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", o.className)}>
      {o.label}
      <span className="sr-only"> (HTTP {status})</span>
    </span>
  );
}

function What({ e, emailOf }: { e: AuditEntry; emailOf?: EmailOf }) {
  const a = describeAudit(e, emailOf);
  return (
    <div className="min-w-0 text-[13px] leading-snug">
      <span>{a.lead}</span>
      {a.target && <> <span className="break-all font-mono text-xs">{a.target}</span></>}
      {a.tail}
      {a.command && <code className="mt-1 block w-fit max-w-full rounded-md [overflow-wrap:anywhere] bg-muted/60 px-1.5 py-1 font-mono text-[11px] text-foreground">{a.command}</code>}
    </div>
  );
}

const who = (e: AuditEntry) => e.userEmail || e.userName || "unknown";
const where = (e: AuditEntry) => [e.context, e.namespace].filter(Boolean).join(" / ");

/**
 * One change. Wide screens: when · who · what (where under it) · result. Narrower: what and result,
 * then who, where and when on one muted line.
 */
function Row({ e, emailOf }: { e: AuditEntry; emailOf?: EmailOf }) {
  const groups = e.groups ? e.groups.split(",").join(", ") : "";
  const place = where(e);
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3 xl:grid-cols-[6.5rem_12rem_minmax(0,1fr)_5rem] xl:items-start"
    >
      <time dateTime={e.at} title={auditExactTime(e.at)} className="hidden pt-px text-xs tabular-nums text-muted-foreground xl:block">
        {auditWhen(e.at)}
      </time>
      <div className="hidden min-w-0 xl:block">
        <div className="truncate text-xs font-medium" title={who(e)}>{who(e)}</div>
        {groups && <div className="truncate font-mono text-[11px] text-muted-foreground" title={`Groups: ${groups}`}>{groups}</div>}
      </div>
      <div className="min-w-0">
        <What e={e} emailOf={emailOf} />
        {place && <div className="mt-0.5 hidden truncate font-mono text-[11px] text-muted-foreground xl:block" title={place}>{place}</div>}
      </div>
      <div className="xl:pt-px"><OutcomeChip status={e.status} /></div>
      <p className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground xl:hidden">
        <span className="font-medium text-foreground/80" title={groups ? `Groups: ${groups}` : undefined}>{who(e)}</span>
        {place && <><span aria-hidden>·</span><span className="break-all font-mono">{place}</span></>}
        <span aria-hidden>·</span>
        <time dateTime={e.at} title={auditExactTime(e.at)} className="tabular-nums">{auditWhen(e.at)}</time>
      </p>
    </li>
  );
}

/** Person (shared KubeDeck only: the desktop has one user) and "Only failures". */
function Filters({ shared, person, onPerson, failures, onFailures, people }: {
  shared: boolean;
  person: string;
  onPerson: (email: string) => void;
  failures: boolean;
  onFailures: (v: boolean) => void;
  people: string[];
}) {
  const [draft, setDraft] = useState(person);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {shared && (
        <form className="flex min-w-0 items-center gap-2" onSubmit={(ev) => { ev.preventDefault(); onPerson(draft.trim().toLowerCase()); }}>
          <label htmlFor="audit-user" className="sr-only">Filter by person</label>
          <Input
            id="audit-user"
            type="email"
            list="audit-people"
            placeholder="Filter by email"
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            className="h-8 w-56 min-w-0 rounded-lg text-xs"
          />
          <datalist id="audit-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
          <Button type="submit" size="sm" variant="outline">Filter</Button>
          {person && (
            <Button type="button" size="sm" variant="ghost" onClick={() => { setDraft(""); onPerson(""); }}>
              <X className="h-3.5 w-3.5" /> Everyone
            </Button>
          )}
        </form>
      )}
      <label className="ml-auto inline-flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={failures} onChange={(ev) => onFailures(ev.target.checked)} className="h-3.5 w-3.5 accent-primary" />
        Only failures
      </label>
    </div>
  );
}

/** Admins who manage users already have the list: use it to name the user an action was about. */
function usePeople(enabled: boolean) {
  const users = useUsers(enabled);
  return useMemo(() => {
    const list = users.data?.users ?? [];
    const byId = new Map(list.map((u) => [u.id, u.email]));
    const emailOf: EmailOf | undefined = users.data ? (id) => byId.get(id) : undefined;
    return { emailOf, emails: list.map((u) => u.email) };
  }, [users.data]);
}

function emptyText(failures: boolean, person: string, loaded: number, more: boolean): string {
  if (failures) return `No failures among the latest ${loaded} change${loaded === 1 ? "" : "s"}${more ? "; older ones are not loaded yet" : ""}.`;
  return person ? `No changes by ${person} yet.` : "No changes yet. Scaling, editing or deleting anything shows up here.";
}

/** Settings → Audit log: every change made through KubeDeck, newest first. */
export function AuditSection() {
  const { mode, features } = useServerMode();
  const [person, setPerson] = useState("");
  const [failures, setFailures] = useState(false);
  const audit = useAudit(person);
  const { emailOf, emails } = usePeople(!!features.users);

  const all = audit.data?.pages.flatMap((p) => p.entries) ?? [];
  const entries = failures ? all.filter((e) => e.status >= 400) : all;

  return (
    <SettingsCard>
      <Filters
        // the desktop has one user, with no email to filter by
        shared={mode === "web"}
        person={person}
        onPerson={setPerson}
        failures={failures}
        onFailures={setFailures}
        people={emails}
      />
      {audit.isLoading ? (
        <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : audit.error ? (
        <p role="alert" className="py-3 text-sm text-destructive">{audit.error.message}</p>
      ) : (
        <>
          <div aria-hidden className="hidden grid-cols-[6.5rem_12rem_minmax(0,1fr)_5rem] gap-x-3 border-b border-border/60 pb-2 text-[11px] font-medium text-muted-foreground xl:grid">
            <span>When</span><span>Who</span><span>What</span><span>Result</span>
          </div>
          {entries.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">{emptyText(failures, person, all.length, !!audit.hasNextPage)}</p>
          ) : (
            <ul aria-label="Changes, newest first" className="divide-y divide-border/60">
              {entries.map((e) => <Row key={e.id} e={e} emailOf={emailOf} />)}
            </ul>
          )}
          {audit.hasNextPage && (
            <Button size="sm" variant="outline" className="mt-3" disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
              {audit.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Show older
            </Button>
          )}
        </>
      )}
    </SettingsCard>
  );
}
