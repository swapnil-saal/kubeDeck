/** Add an MCP server by name and URL (and its token, if it wants one); the rest is set in its own form after. */
import { useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreatePlugin } from "@/hooks/use-plugins";
import { cn } from "@/lib/utils";
import { inputClass } from "./PluginFields";

/** The setting keys an MCP server plugin takes for its address and token. */
const MCP_URL = "url";
const MCP_TOKEN = "token";

export function AddMcpServer({ onAdded, onCancel }: { onAdded: (id: string) => void; onCancel: () => void }) {
  const create = useCreatePlugin();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const values: Record<string, string> = { [MCP_URL]: url.trim() };
    if (token) values[MCP_TOKEN] = token;
    create.mutate({ kind: "mcp", name: name.trim(), values }, { onSuccess: (info) => onAdded(info.id) });
  };

  return (
    <form onSubmit={submit} aria-label="Add an MCP server" className="mb-5 space-y-4 rounded-xl border border-primary/30 bg-primary/[0.03] p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block min-w-0 space-y-1.5">
          <span className="text-xs font-medium">Name</span>
          <Input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GitHub" className={inputClass} />
        </label>
        <label className="block min-w-0 space-y-1.5">
          <span className="text-xs font-medium">URL <span className="ml-1 font-normal text-muted-foreground">streamable HTTP endpoint</span></span>
          <Input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" spellCheck={false} className={cn(inputClass, "font-mono")} />
        </label>
      </div>
      <label className="block min-w-0 space-y-1.5 sm:max-w-[calc(50%-0.5rem)]">
        <span className="text-xs font-medium">Token <span className="ml-1 font-normal text-muted-foreground">optional, sent as a bearer token</span></span>
        <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="none" className={cn(inputClass, "font-mono")} />
      </label>
      {create.error && <p role="alert" className="text-xs text-destructive">{create.error.message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add server
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <span className="text-xs text-muted-foreground">Its settings open next, to finish setting it up.</span>
      </div>
    </form>
  );
}
