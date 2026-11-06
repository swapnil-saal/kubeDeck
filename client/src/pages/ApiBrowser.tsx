import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Inbox, LayoutGrid, Loader2, Plus, Puzzle, Search } from "lucide-react";
import { CreateResourceDialog } from "@/components/yaml/CreateResourceDialog";
import { useServerMode } from "@/hooks/use-server-mode";
import { YAML_TEMPLATES } from "@/lib/yaml-templates";
import type { ApiResource } from "@shared/routes";
import { AppHeader } from "@/components/AppHeader";
import { useApiResources } from "@/hooks/use-k8s";
import { useHashParams } from "@/hooks/use-hash-params";
import { useScopeFromUrl } from "@/hooks/use-scope-from-url";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { RESOURCE_KINDS } from "@/lib/resource-kinds";
import { cn } from "@/lib/utils";

/** API groups that ship with Kubernetes; everything else came from a CRD or an aggregated API. */
function isBuiltInGroup(group: string): boolean {
  return group === "" || !group.includes(".") || group.endsWith(".k8s.io");
}

/** A built-in kind in the sidebar opens that list (pvc, hpa…); anything else opens by its api-resource id. */
function listKeyFor(r: ApiResource): string {
  if (!isBuiltInGroup(r.group)) return r.id;
  const known = RESOURCE_KINDS.find((k) => k.key === r.name || k.kubectl === r.name || r.shortNames.includes(k.kubectl));
  return known?.key ?? r.id;
}

const matches = (r: ApiResource, q: string) =>
  !q ||
  [r.name, r.kind, r.group, ...r.shortNames].some((s) => s.toLowerCase().includes(q));

/** `/resources` — every kind the cluster can list, built-in and custom, grouped by API group. */
export default function ApiBrowser() {
  useScopeFromUrl();
  const { context, namespace } = useTerminalStore();
  const { canWrite } = useServerMode();
  const [creating, setCreating] = useState(false);
  const [, navigate] = useLocation();
  const { get, set } = useHashParams();
  const q = (get("q") || "").trim().toLowerCase();
  const discovery = useApiResources(context);

  const sections = useMemo(() => {
    const byGroup = new Map<string, ApiResource[]>();
    for (const r of discovery.data ?? []) {
      if (!matches(r, q)) continue;
      const list = byGroup.get(r.group) ?? [];
      list.push(r);
      byGroup.set(r.group, list);
    }
    const groups = [...byGroup.entries()].map(([group, items]) => ({ group, items, builtIn: isBuiltInGroup(group) }));
    return {
      custom: groups.filter((g) => !g.builtIn),
      builtIn: groups.filter((g) => g.builtIn).sort((a, b) => (a.group === "" ? -1 : b.group === "" ? 1 : a.group.localeCompare(b.group))),
    };
  }, [discovery.data, q]);

  const open = (r: ApiResource) => navigate(`/resources/${encodeURIComponent(listKeyFor(r))}`);
  const total = (discovery.data ?? []).length;
  const customCount = sections.custom.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <AppHeader breadcrumbs={[{ label: "Overview", href: "/" }, { label: "All resources" }]} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-4 px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LayoutGrid className="h-4 w-4" />
            </span>
            <h1 className="flex items-baseline gap-2 text-lg font-bold tracking-tight">
              All resources
              {total > 0 && <span className="text-sm font-medium tabular-nums text-muted-foreground">{total}</span>}
            </h1>
            <span className="text-xs text-muted-foreground">
              {context || "…"} · every kind this cluster can list{customCount ? `, ${customCount} of them custom` : ""}
            </span>
            {canWrite && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
              >
                <Plus className="h-3.5 w-3.5" />Create
              </button>
            )}
            <label className={cn("focus-frame flex h-8 w-72 max-w-full items-center gap-2 rounded-lg border border-border bg-secondary/50 px-2.5 focus-within:border-primary/40", !canWrite && "ml-auto")}>
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={get("q") || ""}
                onChange={(e) => set("q", e.target.value || null)}
                placeholder="Find a kind, short name or group…"
                aria-label="Find a resource kind"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
              />
            </label>
          </div>

          {discovery.isLoading ? (
            <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Reading the cluster's resource kinds…</p>
          ) : discovery.isError ? (
            <p className="py-10 text-sm text-destructive">{discovery.error?.message}</p>
          ) : sections.custom.length + sections.builtIn.length === 0 ? (
            <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Inbox className="h-4 w-4" />No kind matches “{q}”.</p>
          ) : (
            <>
              {sections.custom.length > 0 && <Section title="Custom resources" icon groups={sections.custom} onOpen={open} />}
              <Section title="Built-in" groups={sections.builtIn} onOpen={open} />
            </>
          )}
        </div>
      </main>
      {canWrite && (
        <CreateResourceDialog open={creating} onClose={() => setCreating(false)} context={context} namespace={namespace} initialYaml={YAML_TEMPLATES[0].yaml} />
      )}
    </div>
  );
}

function Section({ title, groups, onOpen, icon }: {
  title: string;
  groups: { group: string; items: ApiResource[] }[];
  onOpen: (r: ApiResource) => void;
  icon?: boolean;
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
      {/* masonry: short groups do not leave holes next to long ones */}
      <div className="gap-3 sm:columns-2 xl:columns-3">
        {groups.map(({ group, items }) => (
          <div key={group} className="card-elevated mb-3 overflow-hidden break-inside-avoid">
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
              {icon && <Puzzle className="h-3.5 w-3.5 text-primary" />}
              <span className="truncate font-mono text-xs font-semibold text-foreground">{group || "core"}</span>
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
            </div>
            <ul className="divide-y divide-border/40">
              {items.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(r)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-primary/[0.04]"
                  >
                    <span className="min-w-0 flex-1 truncate text-foreground">{r.kind}</span>
                    {r.shortNames.length > 0 && <span className="font-mono text-[10.5px] text-muted-foreground">{r.shortNames.join(", ")}</span>}
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", r.namespaced ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-primary")}>
                      {r.namespaced ? "namespaced" : "cluster"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
