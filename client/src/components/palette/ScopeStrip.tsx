import { useMemo, useState } from "react";
import { Box, Layers, MessageSquare, X } from "lucide-react";

// ─── Scope strip ──────────────────────────────────────────────

export function ScopeStrip({
  context, namespace, namespaces, onNamespaceChange, onAskAi,
}: {
  context: string;
  namespace: string;
  namespaces: string[];
  onNamespaceChange: (ns: string) => void;
  onAskAi?: () => void;
}) {
  const [pickingNs, setPickingNs] = useState(false);
  const [nsFilter, setNsFilter] = useState("");
  const filtered = useMemo(() => {
    const q = nsFilter.trim().toLowerCase();
    const all = ["all", ...namespaces];
    if (!q) return all.slice(0, 50);
    return all.filter((n) => n.toLowerCase().includes(q)).slice(0, 50);
  }, [namespaces, nsFilter]);

  return (
    <div className="relative flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/20">
      <span className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground/70">Scope</span>
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono bg-primary/10 text-primary border border-primary/20">
        <Box className="w-2.5 h-2.5" />
        {context || "no-context"}
      </span>
      <span className="text-primary/40 text-[10px]">/</span>
      <button
        onClick={() => setPickingNs((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors"
        title="Change namespace"
      >
        <Layers className="w-2.5 h-2.5" />
        {namespace || "all"}
      </button>
      {onAskAi && (
        <button
          onClick={onAskAi}
          className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
          title="Open this query in AI chat"
        >
          <MessageSquare className="w-2.5 h-2.5" />
          Ask AI
        </button>
      )}

      {pickingNs && (
        <div className="absolute left-2 right-2 top-full mt-1 z-10 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          <input
            autoFocus
            value={nsFilter}
            onChange={(e) => setNsFilter(e.target.value)}
            placeholder="Filter namespaces…"
            className="w-full bg-transparent px-3 py-2 text-xs border-b border-border focus:outline-none"
          />
          <div className="max-h-60 overflow-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">No namespaces match.</div>
            )}
            {filtered.map((n) => (
              <button
                key={n}
                onClick={() => { onNamespaceChange(n); setPickingNs(false); setNsFilter(""); }}
                className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-muted/60 transition-colors ${
                  n === namespace ? "text-primary bg-primary/5" : "text-foreground/80"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
