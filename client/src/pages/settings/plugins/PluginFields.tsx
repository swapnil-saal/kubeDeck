/** One input per plugin setting, chosen by the field's kind. */
import { useState, type ReactNode } from "react";
import { Eye, EyeOff, Lock, Plus, X } from "lucide-react";
import type { FieldValue, PluginField } from "@shared/plugins";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatList, type DraftValue, type MapRow } from "./plugin-form";

export const inputClass = "h-9 rounded-lg border-border bg-muted/50 text-sm focus-visible:ring-primary/20";

interface FieldProps<V extends DraftValue> {
  id: string;
  field: PluginField;
  value: V;
  onChange: (v: V) => void;
}

/** Label above, help below; the label points at the input by id. */
export function FieldShell({ id, field, note, children }: { id: string; field: PluginField; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-foreground">
        {field.label}
        {field.required && <span className="ml-1.5 font-normal text-muted-foreground">required</span>}
        {note}
      </label>
      {children}
      {field.help && <p className="text-[11px] text-muted-foreground">{field.help}</p>}
    </div>
  );
}

/** Text, a URL, or a list typed comma-separated. */
function TextField({ id, field, value, onChange }: FieldProps<string>) {
  return (
    <Input
      id={id} type={field.kind === "url" ? "url" : "text"} value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder ?? (field.kind === "list" ? "comma-separated" : undefined)} spellCheck={false} className={cn(inputClass, "font-mono")}
    />
  );
}

/** A stored secret is never shown: "Replace" opens an empty input, and leaving it empty keeps the stored one. */
function SecretField({ id, field, value, onChange, stored }: FieldProps<string> & { stored: boolean }) {
  const [replacing, setReplacing] = useState(false);
  const [show, setShow] = useState(false);
  if (stored && !replacing) {
    return (
      <div className="flex items-center gap-2">
        <div id={id} className={cn(inputClass, "flex flex-1 items-center gap-1.5 border px-3 text-muted-foreground")}>
          <Lock className="h-3.5 w-3.5" /> Stored
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setReplacing(true)} aria-label={`Replace ${field.label}`}>Replace</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Input
          id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off"
          placeholder={stored ? "New value; empty keeps the stored one" : field.placeholder ?? "none"}
          className={cn(inputClass, "pr-10 font-mono")}
        />
        <button
          type="button" onClick={() => setShow((v) => !v)} aria-label={show ? `Hide ${field.label}` : `Show ${field.label}`}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {stored && (
        <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(""); setReplacing(false); }}>Keep stored</Button>
      )}
    </div>
  );
}

function SelectField({ id, field, value, onChange }: FieldProps<string>) {
  const options = field.options ?? [];
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm">
      {(value === "" || !options.some((o) => o.value === value)) && <option value={value}>{value || field.placeholder || "Choose…"}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function BooleanField({ id, field, value, onChange }: FieldProps<boolean>) {
  return (
    <div className="flex items-center gap-2.5">
      <Switch id={id} checked={value} onCheckedChange={onChange} aria-label={field.label} />
      <span className="text-xs text-muted-foreground">{value ? "On" : "Off"}</span>
    </div>
  );
}

/** Name → value rows, each removable, and a button for one more. */
function MapField({ id, field, value, onChange }: FieldProps<MapRow[]>) {
  const set = (i: number, patch: Partial<MapRow>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div id={id} role="group" aria-label={field.label} className="space-y-2">
      {value.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input value={row.key} onChange={(e) => set(i, { key: e.target.value })} placeholder="name" aria-label={`${field.label}: name ${i + 1}`} spellCheck={false} className={cn(inputClass, "min-w-0 flex-1 font-mono")} />
          <span aria-hidden className="text-xs text-muted-foreground">→</span>
          <Input value={row.value} onChange={(e) => set(i, { value: e.target.value })} placeholder="value" aria-label={`${field.label}: value ${i + 1}`} spellCheck={false} className={cn(inputClass, "min-w-0 flex-1 font-mono")} />
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove ${field.label} row ${i + 1}`}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { key: "", value: "" }])}>
        <Plus className="h-3.5 w-3.5" /> Add {value.length ? "another" : "one"}
      </Button>
    </div>
  );
}

/** The editable input of a field, by kind. */
export function FieldInput({ id, field, value, onChange, stored }: FieldProps<DraftValue> & { stored: boolean }) {
  switch (field.kind) {
    case "secret": return <SecretField id={id} field={field} value={String(value)} onChange={onChange} stored={stored} />;
    case "select": return <SelectField id={id} field={field} value={String(value)} onChange={onChange} />;
    case "boolean": return <BooleanField id={id} field={field} value={value === true} onChange={onChange} />;
    case "map": return <MapField id={id} field={field} value={Array.isArray(value) ? value : []} onChange={onChange} />;
    default: return <TextField id={id} field={field} value={String(value)} onChange={onChange} />;
  }
}

function pinnedText(field: PluginField, value: FieldValue | undefined): string {
  if (field.kind === "secret") return "Stored on the server";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value)) return formatList(value);
  if (value && typeof value === "object") return Object.entries(value).map(([k, v]) => `${k} → ${v}`).join(", ");
  return value ?? "";
}

/** A setting the server's environment fixes: shown as it is, not editable here. */
export function PinnedField({ id, field, value }: { id: string; field: PluginField; value: FieldValue | undefined }) {
  return (
    <FieldShell id={id} field={field} note={<span className="ml-1.5 font-normal text-muted-foreground">· Set by the server</span>}>
      <output id={id} className="flex min-h-9 items-center gap-1.5 break-all rounded-lg border border-dashed border-border px-3 py-1.5 font-mono text-xs text-muted-foreground">
        <Lock className="h-3 w-3 shrink-0" /> {pinnedText(field, value)}
      </output>
    </FieldShell>
  );
}
