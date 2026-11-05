import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Eye, FilePlus2, Loader2, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useApplyYaml } from "@/hooks/use-k8s";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { YAML_TEMPLATES } from "@/lib/yaml-templates";
import { ApplyPreview } from "./ApplyPreview";
import { YamlWorkbench } from "./YamlWorkbench";

/** "deployment.apps/my-app created" → where its page is. */
export function createdObject(line: string): { type: string; name: string } | null {
  const m = line.match(/^([\w.-]+)\/(\S+) (created|configured|unchanged)/);
  return m ? { type: m[1], name: m[2] } : null;
}

/**
 * Create resources from YAML: start from a template (or paste anything, several documents too),
 * preview what the cluster would do (server-side dry run + diff), then create.
 */
export function CreateResourceDialog({ open, onClose, context, namespace, initialYaml }: {
  open: boolean;
  onClose: () => void;
  context: string;
  /** where objects that name no namespace go */
  namespace: string;
  initialYaml: string;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [yaml, setYaml] = useState(initialYaml);
  const preview = useApplyYaml();
  const apply = useApplyYaml();
  const targetNs = namespace && namespace !== "all" ? namespace : "";

  // a fresh start each time it opens
  useEffect(() => {
    if (open) {
      setYaml(initialYaml);
      preview.reset();
      apply.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialYaml]);

  const runPreview = () => preview.mutate({ yaml, context, namespace: targetNs, mode: "preview" });
  const create = async () => {
    try {
      const result = await apply.mutateAsync({ yaml, context, namespace: targetNs });
      toast({ title: "Created", description: result.objects?.join("\n") || result.message });
      onClose();
      const first = result.objects?.map(createdObject).find(Boolean);
      if (first) {
        navigate(`/resource/${first.type}/${encodeURIComponent(first.name)}?context=${encodeURIComponent(context)}${targetNs ? `&namespace=${encodeURIComponent(targetNs)}` : ""}`);
      }
    } catch {
      /* shown below the editor */
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[88vh] max-w-6xl flex-col gap-0 overflow-hidden rounded-xl border-border bg-card p-0 shadow-lg">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="rounded-lg bg-primary/10 p-1.5 text-primary"><FilePlus2 className="h-3.5 w-3.5" /></span>
            Create from YAML
          </DialogTitle>
          <DialogDescription className="text-xs">
            {context} · {targetNs ? <>objects without a namespace go to <span className="font-mono text-foreground">{targetNs}</span></> : "objects without a namespace go to the context's default"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-5 py-2">
          <span className="mr-1 text-[11px] font-medium text-muted-foreground">Start from</span>
          {YAML_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setYaml(t.yaml); preview.reset(); }}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                yaml === t.yaml ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <YamlWorkbench value={yaml} onChange={(v) => { setYaml(v); if (preview.data || preview.error) preview.reset(); }} context={context} autoFocus className="min-h-0 flex-1" />
          {(preview.isPending || preview.data || preview.error || apply.error) && (
            <div className="max-h-[35%] shrink-0 overflow-y-auto rounded-lg border border-border bg-card">
              <ApplyPreview
                pending={preview.isPending}
                result={preview.data}
                error={(apply.error ?? preview.error)?.message}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          <p className="text-[11px] text-muted-foreground">Several resources? Separate them with a line of <span className="font-mono">---</span>.</p>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="outline" size="sm" onClick={runPreview} disabled={!yaml.trim() || preview.isPending} className="gap-1.5">
              {preview.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Preview
            </Button>
            <Button size="sm" onClick={create} disabled={!yaml.trim() || apply.isPending} className="gap-1.5">
              {apply.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
