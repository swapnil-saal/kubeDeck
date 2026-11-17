/**
 * A group's service account on each cluster: one KubeDeck impersonates, picked from the cluster, or a
 * kubeconfig an admin uploads (for clusters where KubeDeck may not impersonate).
 */
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, UserCog, X } from "lucide-react";
import { shortIdentity, type ClusterAccess } from "@shared/groups";
import { Button } from "@/components/ui/button";
import { useServiceAccounts } from "@/hooks/use-groups";
import { KubeconfigInput } from "@/components/KubeconfigInput";
import { useClusterNamespaces, useClusters } from "@/hooks/use-clusters";
import { useHashParams } from "@/hooks/use-hash-params";
import { cn } from "@/lib/utils";

const select = "h-9 min-w-0 rounded-lg border border-border bg-background px-2 text-sm";
const input = "h-9 min-w-0 rounded-lg border border-border bg-background px-2.5 font-mono text-xs outline-none focus:border-primary/50";

type ServiceAccountAccess = Extract<ClusterAccess, { as: "serviceaccount" }>;
type CredentialsAccess = Extract<ClusterAccess, { as: "credentials" }>;

function Note({ tone = "muted", children }: { tone?: "muted" | "ok" | "warn"; children: ReactNode }) {
  const Icon = tone === "warn" ? AlertTriangle : tone === "ok" ? CheckCircle2 : null;
  return (
    <p className={cn("flex items-start gap-1.5 text-[11px]",
      tone === "warn" ? "rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-800 dark:text-amber-300" : tone === "ok" ? "text-success" : "text-muted-foreground")}>
      {Icon && <Icon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
      <span>{children}</span>
    </p>
  );
}

/** Namespace and service account from what KubeDeck sees, and whether it may impersonate there. */
function ServiceAccountFields({ access, onChange, onUpload }: { access: ServiceAccountAccess; onChange: (a: ClusterAccess) => void; onUpload: () => void }) {
  const namespaces = useClusterNamespaces(access.context).data?.namespaces ?? [];
  const info = useServiceAccounts(access.context, access.namespace || undefined, access.serviceAccount);
  const names = info.data?.names;
  const nsList = namespaces.length ? namespaces : access.namespace ? [access.namespace] : [];
  const uploadInstead = (label: string) => <button type="button" onClick={onUpload} className="font-medium underline underline-offset-2">{label}</button>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <UserCog className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {nsList.length ? (
          <select aria-label="Namespace" value={access.namespace} onChange={(e) => onChange({ ...access, namespace: e.target.value, serviceAccount: "" })} className={cn(select, "flex-1 basis-32 font-mono text-xs")}>
            <option value="">namespace…</option>
            {nsList.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        ) : (
          <input aria-label="Namespace" placeholder="namespace" value={access.namespace} onChange={(e) => onChange({ ...access, namespace: e.target.value.trim(), serviceAccount: "" })} className={cn(input, "flex-1 basis-32")} />
        )}
        <span className="text-muted-foreground">/</span>
        {names && names.length > 0 ? (
          <select aria-label="Service account" value={access.serviceAccount} onChange={(e) => onChange({ ...access, serviceAccount: e.target.value })} className={cn(select, "flex-1 basis-32 font-mono text-xs")}>
            <option value="">service account…</option>
            {[...new Set([...(access.serviceAccount ? [access.serviceAccount] : []), ...names])].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        ) : (
          <input aria-label="Service account" placeholder={info.isLoading ? "loading…" : "service account"} disabled={!access.namespace} value={access.serviceAccount} onChange={(e) => onChange({ ...access, serviceAccount: e.target.value.trim() })} className={cn(input, "flex-1 basis-32 disabled:opacity-60")} />
        )}
      </div>
      {!access.namespace ? (
        <Note>Pick a namespace to see its service accounts.</Note>
      ) : info.isLoading ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking {access.context}…</p>
      ) : info.error ? (
        <Note tone="warn">{info.error.message}</Note>
      ) : info.data && !info.data.canImpersonate ? (
        <Note tone="warn">KubeDeck may not impersonate service accounts in {access.namespace} on {access.context}. {uploadInstead("Upload a kubeconfig instead")}.</Note>
      ) : info.data?.listError ? (
        <Note>{info.data.listError} Type the name, or {uploadInstead("upload a kubeconfig instead")}.</Note>
      ) : names?.length === 0 ? (
        <Note>No service accounts in {access.namespace}.</Note>
      ) : (
        <Note tone="ok">KubeDeck can act as this service account.</Note>
      )}
    </div>
  );
}

/** Uploading (or replacing) the kubeconfig a group uses on one cluster. */
function CredentialsFields({ access, onChange }: { access: CredentialsAccess; onChange: (a: ClusterAccess) => void }) {
  const stored = access.kubeconfig === undefined && !!access.server;
  return (
    <div className="space-y-2">
      {stored && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
          <span>Signs in as <code className="font-mono">{access.identity ? shortIdentity(access.identity) : "an identity the cluster did not name"}</code></span>
          <span className="truncate text-muted-foreground">{access.server}</span>
        </div>
      )}
      <KubeconfigInput
        value={access.kubeconfig ?? ""}
        onChange={(text) => onChange({ ...access, kubeconfig: text || (stored ? undefined : "") })}
        prompt={stored ? "Replace it: drop a kubeconfig here," : "Drop the service account's kubeconfig here,"}
        checkedWith={access.context}
      />
      <Note>A token or an inline client certificate only; exec plugins and file paths are refused. Kept encrypted, never shown again.</Note>
    </div>
  );
}

function AccessRow({ access, contexts, onChange, onRemove }: {
  access: ClusterAccess;
  contexts: string[];
  onChange: (a: ClusterAccess) => void;
  onRemove: () => void;
}) {
  const asServiceAccount = (): ClusterAccess => ({ context: access.context, as: "serviceaccount", namespace: "", serviceAccount: "" });
  const asCredentials = (): ClusterAccess => ({ context: access.context, as: "credentials", kubeconfig: "" });
  const tab = (on: boolean) => cn("rounded-md px-2.5 py-1 text-xs font-medium", on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");

  return (
    <li className="space-y-2.5 rounded-lg border border-border bg-background/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Cluster" value={access.context} onChange={(e) => onChange(access.as === "serviceaccount" ? { ...access, context: e.target.value, namespace: "", serviceAccount: "" } : { context: e.target.value, as: "credentials", kubeconfig: "" })} className={cn(select, "flex-1 basis-40 font-mono text-xs")}>
          {[access.context, ...contexts.filter((c) => c !== access.context)].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div role="tablist" aria-label={`How the group signs in to ${access.context}`} className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
          <button type="button" role="tab" aria-selected={access.as === "serviceaccount"} onClick={() => access.as !== "serviceaccount" && onChange(asServiceAccount())} className={tab(access.as === "serviceaccount")}>Service account</button>
          <button type="button" role="tab" aria-selected={access.as === "credentials"} onClick={() => access.as !== "credentials" && onChange(asCredentials())} className={tab(access.as === "credentials")}>Upload kubeconfig</button>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onRemove} aria-label={`Remove ${access.context}`}><X className="h-3.5 w-3.5" /></Button>
      </div>
      {access.as === "serviceaccount"
        ? <ServiceAccountFields access={access} onChange={onChange} onUpload={() => onChange(asCredentials())} />
        : <CredentialsFields access={access} onChange={onChange} />}
    </li>
  );
}

/** True while an entry still needs something before the group can be saved. */
export const accessIncomplete = (access: ClusterAccess[]) =>
  access.some((a) => (a.as === "serviceaccount" ? !a.namespace || !a.serviceAccount : a.kubeconfig === "" || (a.kubeconfig === undefined && !a.server)));

export function AccessEditor({ value, onChange }: { value: ClusterAccess[]; onChange: (v: ClusterAccess[]) => void }) {
  const clusters = useClusters();
  const { set: setHash } = useHashParams();
  const contexts = (clusters.data?.clusters ?? []).map((c) => c.name);
  const free = contexts.filter((c) => !value.some((a) => a.context === c));
  const set = (i: number, a: ClusterAccess) => onChange(value.map((x, j) => (j === i ? a : x)));
  return (
    <div className="space-y-2">
      {contexts.length === 0 && !clusters.isLoading
        ? <p className="text-xs text-muted-foreground">No clusters yet. Add them under Settings → Clusters, then give this group a service account on each.</p>
        : value.length === 0 && <p className="text-xs text-muted-foreground">No clusters yet: people in this group reach no cluster through it.</p>}
      <ul className="space-y-2">
        {value.map((a, i) => (
          <AccessRow key={i} access={a} contexts={free} onChange={(next) => set(i, next)} onRemove={() => onChange(value.filter((_, j) => j !== i))} />
        ))}
      </ul>
      {contexts.length === 0 && !clusters.isLoading ? (
        // no clusters yet: the only way forward is the Clusters page (this panel closes with the Groups page)
        <Button type="button" variant="outline" size="sm" onClick={() => setHash("section", "cluster-connections")} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Add a cluster in Settings → Clusters
        </Button>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={free.length === 0} onClick={() => onChange([...value, { context: free[0], as: "serviceaccount", namespace: "", serviceAccount: "" }])} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> Add a cluster
          </Button>
          {free.length === 0 && <span className="text-[11px] text-muted-foreground">Every cluster already has a service account here. Add more under Settings → Clusters.</span>}
        </span>
      )}
    </div>
  );
}
