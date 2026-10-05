import type { FC } from "react";
import { ArrowRight, Lock } from "lucide-react";
import type { NamespaceAccess } from "@/hooks/use-cluster-extras";

/**
 * Shown instead of a health verdict when this user cannot read pods in the selected scope.
 * Names the scope and offers the namespaces that do work — never an empty "Access denied".
 */
export const AccessGate: FC<{
  context: string;
  namespace: string;
  access?: NamespaceAccess;
  onPick: (namespace: string) => void;
}> = ({ context, namespace, access, onPick }) => {
  const scope = namespace === "all" ? "all namespaces" : `namespace ${namespace}`;
  const readable = (access?.namespaces ?? []).filter((n) => n.canListPods && n.name !== namespace);

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
          <Lock className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">No health verdict: can't read pods in {scope}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Your user on <span className="font-mono text-foreground">{context}</span> isn't allowed to list pods
            {namespace === "all" ? " across the whole cluster" : ` in ${namespace}`}, so KubeDeck can't say whether it is healthy.
            {readable.length > 0 ? " These namespaces you can open:" : access && !access.listed ? " KubeDeck couldn't list namespaces either — pick one you know you can use." : ""}
          </p>
          {readable.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {readable.slice(0, 12).map((n) => (
                <button
                  key={n.name}
                  type="button"
                  onClick={() => onPick(n.name)}
                  className="group inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10"
                >
                  {n.name}
                  <ArrowRight className="h-3 w-3 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </button>
              ))}
              {readable.length > 12 && <span className="self-center text-xs text-muted-foreground">+{readable.length - 12} more in the scope menu</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
