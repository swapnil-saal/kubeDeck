/** How the pages show cluster access: one badge per kind, and a person's answer for every cluster. */
import { Ban, FileKey2, UserCog } from "lucide-react";
import { ALL_PERMISSIONS, APP_PERMISSIONS, permissionsOf, shortIdentity, type ClusterAccess, type Group } from "@shared/groups";
import { useClusters } from "@/hooks/use-clusters";
import { cn } from "@/lib/utils";

/** The service account a group uses on a cluster, compact enough for a table cell. */
export function AccessBadge({ access, className }: { access: ClusterAccess; className?: string }) {
  const base = "inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium";
  if (access.as === "credentials") {
    const who = access.identity ? shortIdentity(access.identity) : "uploaded kubeconfig";
    return (
      <span title={`Uploaded kubeconfig${access.identity ? `, signs in as ${access.identity}` : ""}${access.server ? ` at ${access.server}` : ""}`} className={cn(base, "bg-violet-500/10 text-violet-700 dark:text-violet-300", className)}>
        <FileKey2 className="h-3 w-3 shrink-0" aria-hidden /> <span className="truncate font-mono">{who}</span>
      </span>
    );
  }
  return (
    <span title={`Service account ${access.namespace}/${access.serviceAccount}, impersonated`} className={cn(base, "bg-sky-500/10 text-sky-700 dark:text-sky-300", className)}>
      <UserCog className="h-3 w-3 shrink-0" aria-hidden /> <span className="truncate font-mono">{access.namespace}/{access.serviceAccount}</span>
    </span>
  );
}

/** No group of the person's covers the cluster: no access there. */
export function NoAccessBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <Ban className="h-3 w-3" aria-hidden /> no access
    </span>
  );
}

/** For each cluster: every service account someone in `memberOf` has there (tried in order), or no access. */
export function AccessPreview({ groups, memberOf }: { groups: Group[]; memberOf: string[] }) {
  const clusters = (useClusters().data?.clusters ?? []).map((c) => c.name);
  if (clusters.length === 0) return <p className="text-xs text-muted-foreground">No clusters yet. Add them under Settings → Clusters.</p>;
  const ordered = [...groups].sort((a, b) => a.position - b.position).filter((g) => memberOf.includes(g.id));
  return (
    <ul className="divide-y divide-border/60 rounded-lg border border-border">
      {clusters.map((c) => {
        const hits = ordered.flatMap((g) => g.access.filter((a) => a.context === c).map((a) => ({ group: g, access: a })));
        return (
          <li key={c} className="space-y-1 px-3 py-2">
            <span className="block truncate font-mono text-xs">{c}</span>
            {hits.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1.5">
                {hits.map((h) => <span key={h.group.id} className="inline-flex items-center gap-1"><AccessBadge access={h.access} /><span className="text-[11px] text-muted-foreground">via {h.group.name}</span></span>)}
                {hits.length > 1 && <span className="w-full text-[11px] text-muted-foreground">permissions add up: each is tried until the cluster allows the call</span>}
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-1.5">
                <NoAccessBadge />
                <span className="text-[11px] text-muted-foreground">none of their groups has a service account here</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** What someone in `memberOf` may use in KubeDeck: on (green) or off, from their groups; an admin has all. */
export function PermissionsPreview({ groups, memberOf, admin = false }: { groups: Group[]; memberOf: string[]; admin?: boolean }) {
  const may = admin ? ALL_PERMISSIONS : permissionsOf(groups, memberOf);
  return (
    <ul aria-label="KubeDeck permissions" className="flex flex-wrap gap-1.5">
      {APP_PERMISSIONS.map((p) => (
        <li key={p.key} title={p.help} className={may[p.key]
          ? "rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
          : "rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground line-through"}>
          {p.label}
        </li>
      ))}
    </ul>
  );
}
