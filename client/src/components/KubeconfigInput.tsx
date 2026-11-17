/**
 * Choosing a kubeconfig to upload: drop a file, choose one, or paste it. `value` is the text, "" when
 * none is chosen. The server checks it (what it may contain, that the cluster accepts it) on save.
 */
import { useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function KubeconfigInput({ value, onChange, prompt, checkedWith }: {
  value: string;
  onChange: (text: string) => void;
  /** the drop zone's words, e.g. "Drop the service account's kubeconfig here," */
  prompt: string;
  /** the cluster it will be checked against, for the "ready" line */
  checkedWith: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [pasting, setPasting] = useState(false);
  const read = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    onChange(await file.text());
  };

  if (pasting) {
    return (
      <div className="space-y-1.5">
        <textarea
          aria-label="Kubeconfig"
          autoFocus
          spellCheck={false}
          placeholder="apiVersion: v1&#10;kind: Config&#10;…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-40 w-full rounded-lg border border-border bg-background p-2.5 font-mono text-[11px] outline-none focus:border-primary/50"
        />
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="h-7" disabled={!value.trim()} onClick={() => setPasting(false)}>Done</Button>
          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => { setPasting(false); onChange(""); }}>Cancel</Button>
        </div>
      </div>
    );
  }
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-2 text-xs">
        <FileUp className="h-3.5 w-3.5 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{fileName || "Pasted kubeconfig"} · checked with {checkedWith} when you save</span>
        <button type="button" onClick={() => { setFileName(""); onChange(""); }} className="text-muted-foreground hover:text-foreground" aria-label="Discard this kubeconfig"><X className="h-3.5 w-3.5" /></button>
      </div>
    );
  }
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); void read(e.dataTransfer.files[0]); }}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground"
    >
      <FileUp className="h-4 w-4" aria-hidden />
      <span className="flex-1">{prompt}</span>
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => fileInput.current?.click()}>Choose file</Button>
      <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setPasting(true)}>Paste</Button>
      <input ref={fileInput} type="file" className="hidden" onChange={(e) => void read(e.target.files?.[0])} />
    </div>
  );
}
