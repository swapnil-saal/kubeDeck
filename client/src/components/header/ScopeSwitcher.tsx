import { useMemo, useState } from "react";
import { Check, ChevronDown, Lock, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useK8sContexts, useK8sNamespaces } from "@/hooks/use-k8s";
import { useNamespaceAccess } from "@/hooks/use-cluster-extras";
import { cn } from "@/lib/utils";

/**
 * One control for "where am I looking": cluster and namespace together. Namespaces your user
 * cannot read are shown last and dimmed (picking one would only produce "Access denied"), so the
 * list itself tells you where you can go.
 */
export function ScopeSwitcher({ className }: { className?: string }) {
  const { context, namespace, setContext, setNamespace } = useTerminalStore();
  const { data: contexts } = useK8sContexts();
  const { data: namespaces } = useK8sNamespaces(context);
  const { data: access } = useNamespaceAccess(context);
  const [open, setOpen] = useState(false);
  const [nsQuery, setNsQuery] = useState("");
  const [ctxQuery, setCtxQuery] = useState("");

  const readable = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const n of access?.namespaces ?? []) map.set(n.name, n.canListPods);
    return map;
  }, [access]);

  const nsRows = useMemo(() => {
    const q = nsQuery.trim().toLowerCase();
    const rows = (namespaces ?? []).map((n) => ({ name: n.name, ok: access ? readable.get(n.name) !== false : true }));
    const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
    return [...filtered.filter((r) => r.ok), ...filtered.filter((r) => !r.ok)];
  }, [namespaces, readable, access, nsQuery]);

  const ctxRows = useMemo(() => {
    const q = ctxQuery.trim().toLowerCase();
    return (contexts ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [contexts, ctxQuery]);

  const allDenied = !!access && !access.all;
  const currentDenied = !!access && (namespace === "all" ? !access.all : readable.get(namespace) === false);
  const dot = !context ? "bg-muted-foreground/40" : currentDenied ? "bg-amber-500" : "bg-emerald-500";
  const readableCount = nsRows.filter((r) => r.ok).length;

  const pickNamespace = (ns: string) => {
    setNamespace(ns);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setNsQuery(""); setCtxQuery(""); } }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Scope: cluster ${context || "none"}, namespace ${namespace === "all" ? "all" : namespace}. Change scope`}
          className={cn(
            "group flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 text-xs",
            "transition-colors hover:border-primary/40 hover:bg-secondary data-[state=open]:border-primary/50",
            className,
          )}
        >
          <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
          <span className="max-w-[9rem] shrink-0 truncate font-semibold text-foreground">{context || "Select cluster"}</span>
          <span className="text-muted-foreground/50">/</span>
          <span className={cn("min-w-0 truncate font-mono", currentDenied ? "text-amber-500" : "text-muted-foreground")}>
            {namespace === "all" ? "all namespaces" : namespace}
          </span>
          {currentDenied && <Lock className="h-3 w-3 shrink-0 text-amber-500" aria-hidden />}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[min(24rem,calc(100vw-1.5rem))] p-0" align="start">
        {/* Cluster */}
        <div className="border-b border-border p-2">
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cluster</span>
            <span className="text-[10px] text-muted-foreground">{contexts?.length ?? 0}</span>
          </div>
          {(contexts?.length ?? 0) > 6 && (
            <SearchBox value={ctxQuery} onChange={setCtxQuery} placeholder="Find a cluster…" />
          )}
          <ul className="max-h-40 overflow-y-auto" role="listbox" aria-label="Clusters">
            {ctxRows.map((c) => (
              <li key={c.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.name === context}
                  onClick={() => { setContext(c.name); }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                    c.name === context && "bg-primary/10 text-foreground",
                  )}
                >
                  <Check className={cn("h-3.5 w-3.5 shrink-0 text-primary", c.name === context ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{c.name}</span>
                  {c.isCurrent && <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-px text-[9px] text-muted-foreground">kubeconfig default</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Namespace */}
        <div className="p-2">
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Namespace</span>
            {access && access.listed && (
              <span className="text-[10px] text-muted-foreground">{readableCount} of {access.namespaces.length} readable</span>
            )}
          </div>
          <SearchBox value={nsQuery} onChange={setNsQuery} placeholder="Find a namespace…" autoFocus />
          <ul className="mt-1 max-h-60 overflow-y-auto" role="listbox" aria-label="Namespaces">
            {!nsQuery && (
              <NamespaceRow
                name="All namespaces"
                active={namespace === "all"}
                denied={allDenied}
                deniedHint="Your user can't list pods across all namespaces"
                onPick={() => pickNamespace("all")}
              />
            )}
            {nsRows.map((r) => (
              <NamespaceRow
                key={r.name}
                name={r.name}
                mono
                active={namespace === r.name}
                denied={!r.ok}
                deniedHint="No permission to list pods in this namespace"
                onPick={() => pickNamespace(r.name)}
              />
            ))}
            {nsRows.length === 0 && (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">No namespace matches “{nsQuery}”.</li>
            )}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SearchBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <label className="mb-1 flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 focus-within:border-primary/50">
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-transparent text-xs text-foreground outline-none focus-visible:!outline-none placeholder:text-muted-foreground"
        aria-label={placeholder}
      />
    </label>
  );
}

function NamespaceRow({ name, active, denied, deniedHint, onPick, mono }: {
  name: string; active: boolean; denied: boolean; deniedHint: string; onPick: () => void; mono?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        title={denied ? deniedHint : undefined}
        onClick={onPick}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
          active && "bg-primary/10",
          denied && "text-muted-foreground/70",
        )}
      >
        <Check className={cn("h-3.5 w-3.5 shrink-0 text-primary", active ? "opacity-100" : "opacity-0")} />
        <span className={cn("truncate", mono && "font-mono")}>{name}</span>
        {denied && <Lock className="ml-auto h-3 w-3 shrink-0" aria-label="No permission" />}
      </button>
    </li>
  );
}
