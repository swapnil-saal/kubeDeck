/**
 * The Overview when this person has no cluster at all. On a shared KubeDeck an admin gets the three
 * setup steps with where each stands; anyone else learns who gives access. On the desktop: add a
 * kubeconfig.
 */
import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowRight, BookOpen, Check, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClusters } from "@/hooks/use-clusters";
import { useGroups } from "@/hooks/use-groups";
import { useServerMode } from "@/hooks/use-server-mode";
import { cn } from "@/lib/utils";

const openDocs = (path: string) => window.open(new URL(`/docs/${path}`, window.location.origin).href, "_blank", "noopener");

function Step({ n, done, title, text, action }: { n: number; done: boolean; title: string; text: string; action?: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
        done ? "border-success/40 bg-success/10 text-success" : "border-primary/40 bg-primary/10 text-primary",
      )}>
        {done ? <Check className="h-3.5 w-3.5" aria-label="done" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 pb-1">
        <p className={cn("text-sm font-semibold", done && "text-muted-foreground line-through decoration-muted-foreground/40")}>{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{text}</p>
        {!done && action}
      </div>
    </li>
  );
}

function AdminSetup({ onRefresh }: { onRefresh: () => void }) {
  const [, navigate] = useLocation();
  const { user } = useServerMode();
  const clusters = useClusters();
  const groups = useGroups();
  const hasCluster = (clusters.data?.clusters.length ?? 0) > 0;
  const groupsWithAccess = (groups.data?.groups ?? []).filter((g) => g.access.length > 0);
  const hasGroup = groupsWithAccess.length > 0;
  const mine = groupsWithAccess.some((g) => user?.groups?.includes(g.id));
  const go = (section: string) => navigate(`/settings?section=${section}`);
  const next = (label: string, section: string) => (
    <Button size="sm" onClick={() => go(section)} className="gap-1.5">{label} <ArrowRight className="h-3.5 w-3.5" /></Button>
  );

  return (
    <>
      <ol className="space-y-4">
        <Step n={1} done={hasCluster} title="Add a cluster"
          text="Settings → Clusters: upload a kubeconfig KubeDeck uses for the cluster (or, inside the cluster, use KubeDeck's own service account)."
          action={next("Add a cluster", "cluster-connections")} />
        <Step n={2} done={hasGroup} title="Give a group a service account on it"
          text="Settings → Groups: pick a service account from the cluster, or upload one's kubeconfig. People in the group act as it."
          action={hasCluster ? next("Set up a group", "groups") : undefined} />
        <Step n={3} done={mine} title="Put yourself in that group"
          text="Admins reach clusters through groups too. Add yourself, then everyone else who needs the cluster."
          action={hasGroup ? next("Add people", "users") : undefined} />
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5" /> Check again</Button>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => openDocs("web/clusters/")}><BookOpen className="h-3.5 w-3.5" /> How clusters and groups work</Button>
      </div>
    </>
  );
}

export function NoClusters({ onRefresh }: { onRefresh: () => void }) {
  const [, navigate] = useLocation();
  const mode = useServerMode();
  const web = mode.mode === "web";
  const admin = mode.user?.role === "admin";

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6 sm:p-10">
      <section aria-labelledby="no-clusters" className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Server className="h-6 w-6" aria-hidden /></span>
          <div>
            <h2 id="no-clusters" className="text-lg font-semibold tracking-tight">
              {web ? (admin ? "Set up your first cluster" : "No clusters for you yet") : "No clusters in your kubeconfig"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {web
                ? admin
                  ? "This KubeDeck reads no kubeconfig from its server. Clusters come from three steps, after which they appear here."
                  : "You reach a cluster through your KubeDeck groups. A KubeDeck admin adds the cluster and puts you in a group that has access to it."
                : "KubeDeck found no contexts in your kubeconfig files. Add a kubeconfig file, or point KubeDeck at the one you use."}
            </p>
          </div>
        </div>

        {web && admin ? (
          <AdminSetup onRefresh={onRefresh} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {!web && <Button size="sm" className="gap-1.5" onClick={() => navigate("/settings?section=clusters")}>Open Settings → Clusters <ArrowRight className="h-3.5 w-3.5" /></Button>}
            <Button size="sm" variant={web ? "default" : "outline"} className="gap-1.5" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5" /> Check again</Button>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => openDocs(web ? "web/groups/" : "getting-started/quick-start/")}><BookOpen className="h-3.5 w-3.5" /> Docs</Button>
          </div>
        )}
      </section>
    </div>
  );
}
