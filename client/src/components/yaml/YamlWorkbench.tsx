import { lazy, Suspense, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { cn } from "@/lib/utils";
import { FieldDocs } from "./FieldDocs";
import type { YamlLocation } from "./yaml-path";

// CodeMirror loads only when an editor is first opened
const YamlEditor = lazy(() => import("./YamlEditor"));

/** The YAML editor with field documentation beside it; used to create resources and to edit them. */
export function YamlWorkbench({ value, onChange, context, autoFocus, className }: {
  value: string;
  onChange: (value: string) => void;
  context: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [location, setLocation] = useState<YamlLocation | null>(null);
  const [showDocs, setShowDocs] = usePersistedState("kubedeck.yaml.docs", true);

  return (
    <div className={cn("relative flex min-h-0 overflow-hidden rounded-lg border border-border bg-surface-inset", className)}>
      <div className="min-w-0 flex-1">
        <Suspense fallback={<p className="flex items-center gap-2 p-4 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading editor…</p>}>
          <YamlEditor value={value} onChange={onChange} onLocate={setLocation} autoFocus={autoFocus} />
        </Suspense>
      </div>
      {showDocs && (
        <div className="hidden w-80 shrink-0 border-l border-border/60 bg-card md:block">
          <FieldDocs context={context} location={location} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setShowDocs((v) => !v)}
        aria-pressed={showDocs}
        title={showDocs ? "Hide field docs" : "Show field docs"}
        className={cn(
          "absolute right-2 top-2 z-10 hidden rounded-md border p-1.5 transition-colors md:block",
          showDocs ? "right-[21rem] border-transparent text-muted-foreground hover:text-foreground" : "border-border bg-card text-muted-foreground hover:text-primary",
        )}
      >
        <BookOpen className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
