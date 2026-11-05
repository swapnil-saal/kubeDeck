import { useEffect, useState } from "react";
import { BookOpen, ChevronRight, Loader2 } from "lucide-react";
import { useExplain } from "@/hooks/use-k8s";
import { cn } from "@/lib/utils";
import { explainPath, type YamlLocation } from "./yaml-path";

/** Follows the cursor, but not on every keystroke. */
function useSettled<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/**
 * What the field under the cursor means, from `kubectl explain` against the cluster's own schema
 * (so custom resources are documented too). Sub-fields can be opened without moving the cursor.
 */
export function FieldDocs({ context, location }: { context: string; location: YamlLocation | null }) {
  const settled = useSettled(location);
  const fromCursor = settled ? explainPath(settled) : null;
  // a sub-field opened from the list; following the cursor again resets it
  const [browsed, setBrowsed] = useState<string | null>(null);
  useEffect(() => setBrowsed(null), [fromCursor]);
  const path = browsed ?? fromCursor;
  const docs = useExplain(path, settled?.apiVersion, context);

  const segments = path?.split(".") ?? [];

  return (
    <aside aria-label="Field documentation" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <BookOpen className="h-3.5 w-3.5" />
        Field docs
        {docs.isFetching && <Loader2 className="ml-auto h-3 w-3 animate-spin" />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 text-xs">
        {!path ? (
          <p className="text-muted-foreground">Put the cursor on a field to see what it does. Docs come from this cluster, so custom resources are covered too.</p>
        ) : (
          <>
            <nav aria-label="Field path" className="mb-2 flex flex-wrap items-center gap-0.5 font-mono text-[11px]">
              {segments.map((seg, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/60" />}
                  <button
                    type="button"
                    onClick={() => setBrowsed(segments.slice(0, i + 1).join("."))}
                    className={cn("rounded px-0.5 hover:text-primary", i === segments.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground")}
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </nav>
            {docs.isError ? (
              <p className="text-muted-foreground">{docs.error?.message || "No documentation for this field."}</p>
            ) : docs.data ? (
              <>
                {docs.data.type && (
                  <p className="mb-1.5 font-mono text-[11px] text-primary">{docs.data.type}</p>
                )}
                <p className="whitespace-pre-line leading-relaxed text-foreground/85">{docs.data.description || "No description."}</p>
                {docs.data.fields.length > 0 && (
                  <>
                    <h3 className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Fields</h3>
                    <ul className="space-y-0.5">
                      {docs.data.fields.map((f) => (
                        <li key={f.name}>
                          <button
                            type="button"
                            onClick={() => setBrowsed(`${path}.${f.name}`)}
                            title={f.description}
                            className="flex w-full items-baseline gap-1.5 rounded px-1.5 py-1 text-left hover:bg-muted"
                          >
                            <span className="font-mono text-[11.5px] text-foreground">{f.name}</span>
                            {f.required && <span className="rounded bg-destructive/10 px-1 text-[9.5px] font-semibold text-destructive">required</span>}
                            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{f.type}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
