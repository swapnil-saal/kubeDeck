/**
 * Add an MCP server by name and URL (and its token, if it wants one). The URL is checked here first,
 * the way the server checks it; the rest is set in the server's own settings after.
 */
import { forwardRef, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetBody, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCreatePlugin } from "@/hooks/use-plugins";
import { cn } from "@/lib/utils";
import { inputClass } from "../plugins/PluginFields";
import { serverUrlProblem } from "./mcp-page";

/** The setting keys an MCP server plugin takes for its address and token. */
const MCP_URL = "url";
const MCP_TOKEN = "token";

type FieldProps = ComponentProps<typeof Input> & { id: string; label: ReactNode; hint: string; problem?: string | null };

/** A labelled input with its hint below; a problem replaces the hint, in red, and is announced. */
const Field = forwardRef<HTMLInputElement, FieldProps>(({ id, label, hint, problem, className, ...input }, ref) => (
  <div className={cn("min-w-0 space-y-1.5", className)}>
    <label htmlFor={id} className="block text-xs font-medium">{label}</label>
    <Input
      id={id} ref={ref} autoComplete="off" spellCheck={false} aria-invalid={!!problem} aria-describedby={`${id}-hint`} {...input}
      className={cn(inputClass, input.type !== "text" && "font-mono", problem && "border-destructive focus-visible:ring-destructive/20")}
    />
    <p id={`${id}-hint`} role={problem ? "alert" : undefined} className={cn("text-[11px]", problem ? "text-destructive" : "text-muted-foreground")}>
      {problem ?? hint}
    </p>
  </div>
));
Field.displayName = "Field";

export function AddMcpServer({ onAdded, onCancel }: { onAdded: (id: string) => void; onCancel: () => void }) {
  const create = useCreatePlugin();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  // problems show once the form was sent (the URL's also once it was left), and go as soon as they are fixed
  const [sent, setSent] = useState(false);
  const [urlLeft, setUrlLeft] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSent(true);
    if (!name.trim()) return nameInput.current?.focus();
    if (serverUrlProblem(url)) return urlInput.current?.focus();
    const values: Record<string, string> = { [MCP_URL]: url.trim() };
    if (token) values[MCP_TOKEN] = token;
    create.mutate({ kind: "mcp", name: name.trim(), values }, { onSuccess: (info) => onAdded(info.id) });
  };

  return (
    <form onSubmit={submit} noValidate aria-label="Add an MCP server" className="flex min-h-0 flex-1 flex-col">
      <SheetHeader>
        <SheetTitle className="text-base font-semibold">Add an MCP server</SheetTitle>
        <SheetDescription className="text-xs text-muted-foreground">It starts on and read-only. Its tools show once it answers; the rest of its settings are under Settings.</SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-4">
        <Field
          id="add-mcp-name" ref={nameInput} type="text" label="Name" hint="How the assistant and this page call it." placeholder="e.g. GitHub"
          required maxLength={40} autoFocus value={name} onChange={(e) => setName(e.target.value)} problem={sent && !name.trim() ? "Give it a name." : null}
        />
        <Field
          id="add-mcp-url" ref={urlInput} type="url" inputMode="url" label="Server URL" placeholder="https://mcp.example.com/mcp" required
          hint="Its remote endpoint (Streamable HTTP or SSE). Local (stdio) servers are not supported."
          value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => url && setUrlLeft(true)} problem={sent || urlLeft ? serverUrlProblem(url) : null}
        />
        <Field
          id="add-mcp-token" type="password" placeholder="none" value={token} onChange={(e) => setToken(e.target.value)}
          label={<>Token <span className="ml-1 font-normal text-muted-foreground">optional</span></>} hint="Sent as a bearer token; stored encrypted and never shown again."
        />
      </SheetBody>
      <SheetFooter>
        {create.error && <p role="alert" className="w-full text-xs text-destructive">{create.error.message}</p>}
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add server
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </SheetFooter>
    </form>
  );
}
