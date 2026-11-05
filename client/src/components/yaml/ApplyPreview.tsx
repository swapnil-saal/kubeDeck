import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { ApplyResult } from "@shared/routes";
import { cn } from "@/lib/utils";

/**
 * kubectl diff prints `diff -u -N /tmp/LIVE-1/apps.v1.Deployment.e2.web /tmp/MERGED-1/…` per object
 * (group.version.Kind[.namespace].name); show "Deployment e2/web" instead of temp paths.
 * Namespaces never contain dots, so whatever follows the namespace is the name.
 */
export function diffHeading(line: string): string | null {
  const file = line.match(/^diff -u -N (\S+)/)?.[1]?.split("/").pop();
  if (!file) return null;
  const parts = file.split(".");
  const v = parts.findIndex((p) => /^v\d+((alpha|beta)\d+)?$/.test(p));
  if (v < 0 || v + 2 >= parts.length) return null;
  const kind = parts[v + 1];
  const rest = parts.slice(v + 2);
  return rest.length >= 2 ? `${kind} ${rest[0]}/${rest.slice(1).join(".")}` : `${kind} ${rest[0]}`;
}

/** The result of a preview: which objects would be created or changed, and the diff against the live ones. */
export function ApplyPreview({ result, error, pending }: { result?: ApplyResult; error?: string | null; pending?: boolean }) {
  if (pending) {
    return <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Asking the cluster what would change…</p>;
  }
  if (error) {
    return (
      <p className="flex items-start gap-2 px-3 py-2 text-xs text-destructive">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="whitespace-pre-wrap">{error}</span>
      </p>
    );
  }
  if (!result) return null;
  const lines = (result.diff ?? "").split("\n");
  return (
    <div className="space-y-2 px-3 py-2 text-xs">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        {result.message}
      </p>
      {result.objects && result.objects.length > 0 && (
        <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
          {result.objects.map((o) => <li key={o}>{o.replace(/ \(server dry run\)$/, "")}</li>)}
        </ul>
      )}
      {result.diff ? (
        <pre className="max-h-72 overflow-auto rounded-md border border-border bg-surface-inset p-2 font-mono text-[11px] leading-relaxed">
          {lines.map((line, i) => {
            const heading = line.startsWith("diff ") ? diffHeading(line) : null;
            if (heading) return <div key={i} className="mt-1 font-semibold text-foreground first:mt-0">{heading}</div>;
            if (line.startsWith("--- ") || line.startsWith("+++ ")) return null;
            return (
              <div
                key={i}
                className={cn(
                  line.startsWith("+") && "bg-success/10 text-success",
                  line.startsWith("-") && "bg-destructive/10 text-destructive",
                  line.startsWith("@@") && "text-primary/70",
                  !/^[+\-@]/.test(line) && "text-muted-foreground",
                )}
              >
                {line || " "}
              </div>
            );
          })}
        </pre>
      ) : (
        result.objects?.some((o) => /configured|unchanged/.test(o)) && <p className="text-muted-foreground">No changes to existing objects.</p>
      )}
    </div>
  );
}
