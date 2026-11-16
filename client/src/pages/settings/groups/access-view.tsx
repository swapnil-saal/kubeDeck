/** How the pages show cluster access: one badge per kind, and a person's answer for every cluster. */
import { FileKey2, UserCog, UserRound } from "lucide-react";
import { accessOn, shortIdentity, type ClusterAccess, type Group } from "@shared/groups";
import { useK8sContexts } from "@/hooks/use-k8s";
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

/** Acting as the person (no group covers the cluster). */
export function SelfBadge({ label = "as themselves" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <UserRound className="h-3 w-3" aria-hidden /> {label}
    </span>
  );
}

/** For each cluster: what someone in `memberOf` acts as there, and through which group. */
export function AccessPreview({ groups, memberOf, userPrefix, email, admin = false }: { groups: Group[]; memberOf: string[]; userPrefix: string; email: string; admin?: boolean }) {
  const contexts = (useK8sContexts().data ?? []).map((c) => c.name);
  if (contexts.length === 0) return <p className="text-xs text-muted-foreground">No clusters.</p>;
  return (
    <ul className="divide-y divide-border/60 rounded-lg border border-border">
      {contexts.map((c) => {
        const hit = accessOn(groups, memberOf, c);
        return (
          <li key={c} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2">
            <span className="truncate font-mono text-xs">{c}</span>
            {hit ? <AccessBadge access={hit.access} /> : <SelfBadge label={admin ? "KubeDeck's own" : "as themselves"} />}
            <span className="col-span-2 truncate text-[11px] text-muted-foreground">
              {hit ? <>through {hit.group.name}</> : admin ? <>an admin: KubeDeck's own credentials for this cluster</> : <>as <code className="font-mono">{userPrefix}{email || "…"}</code>, where RoleBindings allow</>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
