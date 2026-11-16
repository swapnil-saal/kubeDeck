/** A plugin's settings, rendered from its fields: Save sends only what changed; Test connection checks it. */
import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Save, Zap } from "lucide-react";
import type { PluginInfo, PluginStatus } from "@shared/plugins";
import { Button } from "@/components/ui/button";
import { useTestPlugin, useUpdatePlugin } from "@/hooks/use-plugins";
import { changedValues, draftFrom, type Draft, type DraftValue } from "./plugin-form";
import { FieldInput, FieldShell, PinnedField } from "./PluginFields";
import { StatusLine } from "./PluginStatus";

const fieldId = (plugin: PluginInfo, key: string) => `plugin-${plugin.id}-${key}`.replace(/[^\w-]/g, "-");

/** The form follows the list while nothing is typed; once something is, it keeps what was typed. */
function useDraft(plugin: PluginInfo) {
  const [base, setBase] = useState(plugin);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(plugin));
  const changes = changedValues(base, draft);
  const dirty = Object.keys(changes).length > 0;
  useEffect(() => {
    if (dirty) return;
    setBase(plugin);
    setDraft(draftFrom(plugin));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new answer from the server resets the form
  }, [plugin]);
  const reset = (next: PluginInfo) => { setBase(next); setDraft(draftFrom(next)); };
  const set = (key: string, v: DraftValue) => setDraft((d) => ({ ...d, [key]: v }));
  return { base, draft, changes, dirty, set, reset };
}

function FormActions({ plugin, dirty, saving, onTest, testing }: { plugin: PluginInfo; dirty: boolean; saving: boolean; onTest: () => void; testing: boolean }) {
  const testHint = !plugin.enabled ? "Switch it on to test it" : dirty ? "Save first, then test" : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" disabled={!dirty || saving}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onTest} disabled={!!testHint || testing} title={testHint}>
        {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Test connection
      </Button>
      {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : testHint && <span className="text-xs text-muted-foreground">{testHint}</span>}
    </div>
  );
}

/** `bare`: no box of its own (inside a panel that already frames it). */
export function PluginForm({ plugin, bare = false }: { plugin: PluginInfo; bare?: boolean }) {
  const { base, draft, changes, dirty, set, reset } = useDraft(plugin);
  const update = useUpdatePlugin();
  const test = useTestPlugin();
  const [result, setResult] = useState<{ what: "saved" | "tested"; status: PluginStatus } | null>(null);
  const pinned = new Set(base.envPinned);
  const stored = new Set(base.secretsSet);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    test.reset();
    update.mutate({ id: plugin.id, values: changes }, {
      onSuccess: (info) => { reset(info); setResult({ what: "saved", status: info.status }); },
    });
  };
  const runTest = () => {
    update.reset();
    test.mutate(plugin.id, { onSuccess: (status) => setResult({ what: "tested", status }) });
  };
  const error = update.error ?? test.error;

  return (
    <form onSubmit={submit} aria-label={`${plugin.name} settings`} className={bare ? "space-y-4" : "space-y-4 rounded-xl border border-border bg-muted/30 p-4"}>
      <div className="grid gap-4 sm:grid-cols-2">
        {plugin.fields.map((field) => {
          const id = fieldId(plugin, field.key);
          const wide = field.kind === "map" || field.kind === "list";
          return (
            <div key={field.key} className={wide ? "sm:col-span-2" : undefined}>
              {pinned.has(field.key) ? (
                <PinnedField id={id} field={field} value={base.values[field.key]} />
              ) : (
                <FieldShell id={id} field={field}>
                  <FieldInput id={id} field={field} value={draft[field.key]} onChange={(v) => { setResult(null); set(field.key, v); }} stored={stored.has(field.key)} />
                </FieldShell>
              )}
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error.message}</p>}
      {result && !error && (
        <div className="space-y-1">
          {result.what === "saved" && <p className="text-xs text-muted-foreground">Saved. It restarted with the new settings:</p>}
          <StatusLine status={result.status} />
        </div>
      )}
      <FormActions plugin={plugin} dirty={dirty} saving={update.isPending} onTest={runTest} testing={test.isPending} />
    </form>
  );
}
