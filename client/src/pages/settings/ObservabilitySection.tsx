import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Eye, EyeOff, Loader2, Save, XCircle, Zap } from "lucide-react";
import { tracesPaths, type GrafanaMcpStatus } from "@shared/traces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useK8sContexts } from "@/hooks/use-k8s";
import { useServerMode } from "@/hooks/use-server-mode";
import { useSettings, useUpdateObservability, type ObservabilityInput } from "@/hooks/use-settings";
import { useTempoClusters, useTraceStatus } from "@/hooks/use-traces";
import { cn } from "@/lib/utils";
import { SettingsCard } from "./SettingsCard";

const EMPTY: ObservabilityInput = { tempoUrl: "", tempoToken: "", tempoTenant: "", lokiUrl: "", lokiToken: "", lokiTenant: "", clusters: {}, grafanaUrl: "", grafanaTempoDatasource: "", mcpUrl: "", mcpToken: "" };
const field = "h-9 rounded-lg border-border bg-muted/50 font-mono text-sm focus-visible:ring-primary/20";

function Labeled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">
        {label}
        {hint && <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Secret({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" className={cn(field, "pr-10")} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? `Hide ${label}` : `Show ${label}`} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function useGrafanaMcp() {
  return useQuery({
    queryKey: [tracesPaths.grafanaMcp],
    queryFn: async () => (await (await fetch(tracesPaths.grafanaMcp, { credentials: "include" })).json()) as GrafanaMcpStatus,
    staleTime: 60_000,
    retry: false,
  });
}

function StatusLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={cn("flex items-start gap-1.5 text-xs font-medium", ok ? "text-success" : "text-destructive")}>
      {ok ? <CheckCircle2 className="mt-px h-4 w-4 shrink-0" /> : <XCircle className="mt-px h-4 w-4 shrink-0" />}
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

/** One row per kube context: which Tempo cluster its traces carry, automatic or chosen. */
function ClusterRow({ context, value, clusters, onChange, editable }: { context: string; value: string; clusters: string[]; onChange: (v: string) => void; editable: boolean }) {
  const status = useTraceStatus(context, "");
  const detected = status.data?.source && status.data.source !== "settings" ? status.data.cluster : null;
  const how = { name: "same name", only: "only cluster", namespace: "found by namespace", settings: "" } as const;
  return (
    <tr className="align-middle">
      <td className="py-1.5 pr-3 font-mono text-xs">{context}</td>
      <td className="py-1.5">
        {editable ? (
          <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Tempo cluster for ${context}`} className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs">
            <option value="">{status.isLoading ? "Automatic…" : detected ? `Automatic: ${detected} (${how[status.data!.source!]})` : "Automatic: not found"}</option>
            {clusters.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <span className="text-xs">{value || (detected ? `${detected} (${how[status.data!.source!]})` : status.isLoading ? "…" : "not found")}</span>
        )}
      </td>
    </tr>
  );
}

/** Grafana Tempo for traces, and the Grafana MCP server the assistant may read from. */
export function ObservabilitySection() {
  const { toast } = useToast();
  const { features } = useServerMode();
  const editable = features.settingsEdit;
  const { data: settings } = useSettings();
  const save = useUpdateObservability();
  const contexts = useK8sContexts();
  const [form, setForm] = useState<ObservabilityInput>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const env = settings?.observabilityEnv ?? {};
  const tempoOn = !!(form.tempoUrl || env.tempoUrl || (!editable && settings?.observability?.tempoUrl));
  const tempo = useTempoClusters(tempoOn && !dirty);
  const mcp = useGrafanaMcp();

  useEffect(() => {
    if (!settings) return;
    setForm({ ...EMPTY, ...(settings.observability ?? {}), clusters: settings.observability?.clusters ?? {} } as ObservabilityInput);
    setDirty(false);
  }, [settings]);

  const update = (patch: Partial<ObservabilityInput>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const onSave = async () => {
    try {
      await save.mutateAsync({ observability: form, kubeconfigPaths: settings?.kubeconfigPaths ?? [] });
      setDirty(false);
      toast({ title: "Saved", description: "Observability settings updated" });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };
  const placeholder = (k: keyof typeof env | string, fallback: string) => env[k] ? `${env[k]} (environment)` : fallback;

  const tempoStatus = tempo.isFetching ? (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Connecting…</span>
  ) : tempo.data ? (
    <StatusLine ok>Connected · {tempo.data.clusters.length} cluster{tempo.data.clusters.length === 1 ? "" : "s"} with traces in the last day</StatusLine>
  ) : tempo.error ? <StatusLine ok={false}>{tempo.error.message}</StatusLine> : null;

  const mcpStatus = !mcp.data?.configured ? null : mcp.data.ok ? (
    <StatusLine ok>Connected · the assistant can use {mcp.data.tools.length} read-only tools</StatusLine>
  ) : <StatusLine ok={false}>{mcp.data.message}</StatusLine>;

  return (
    <div className="space-y-6">
      <SettingsCard title="Traces and logs (Tempo, Loki)" description="Requests across services: where they fail and where the time goes. Shown on workload pages, in Overview → Traces, and to the assistant.">
        {editable ? (
          <div className="space-y-4">
            <Labeled label="Tempo URL" hint="Tempo's HTTP API, not Grafana">
              <Input value={form.tempoUrl} onChange={(e) => update({ tempoUrl: e.target.value })} placeholder={placeholder("tempoUrl", "https://tempo.example.com")} className={field} />
            </Labeled>
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label="Token" hint="optional, sent as a bearer token">
                <Secret value={form.tempoToken} onChange={(v) => update({ tempoToken: v })} placeholder={placeholder("tempoToken", "none")} label="Tempo token" />
              </Labeled>
              <Labeled label="Tenant" hint="optional, X-Scope-OrgID">
                <Input value={form.tempoTenant} onChange={(e) => update({ tempoTenant: e.target.value })} placeholder={placeholder("tempoTenant", "single tenant")} className={field} />
              </Labeled>
            </div>
            {tempoStatus}
            <Labeled label="Loki URL" hint="optional: log history, logs of pods that are gone, the logs next to a trace">
              <Input value={form.lokiUrl} onChange={(e) => update({ lokiUrl: e.target.value })} placeholder={placeholder("lokiUrl", "https://loki.example.com")} className={field} />
            </Labeled>
            {(form.lokiUrl || env.lokiUrl) && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Labeled label="Loki token" hint="optional">
                  <Secret value={form.lokiToken} onChange={(v) => update({ lokiToken: v })} placeholder={placeholder("lokiToken", "none")} label="Loki token" />
                </Labeled>
                <Labeled label="Loki tenant" hint="optional, X-Scope-OrgID">
                  <Input value={form.lokiTenant} onChange={(e) => update({ lokiTenant: e.target.value })} placeholder={placeholder("lokiTenant", "single tenant")} className={field} />
                </Labeled>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2 text-xs">
            {settings?.observability?.tempoUrl ? <p>Tempo: <span className="font-mono">{settings.observability.tempoUrl}</span></p> : <p className="text-muted-foreground">Not set up. An administrator sets <code className="font-mono">KUBEDECK_TEMPO_URL</code>.</p>}
            {settings?.observability?.lokiUrl && <p>Loki: <span className="font-mono">{settings.observability.lokiUrl}</span></p>}
            {tempoStatus}
          </div>
        )}
      </SettingsCard>

      {tempoOn && (
        <SettingsCard title="Clusters" description="Traces name their cluster (k8s.cluster.name). KubeDeck matches a context by name, or by the namespaces Tempo has seen; pick one where that does not work.">
          <table className="w-full">
            <tbody className="divide-y divide-border/40">
              {(contexts.data ?? []).map((c) => (
                <ClusterRow
                  key={c.name}
                  context={c.name}
                  value={form.clusters[c.name] ?? ""}
                  clusters={tempo.data?.clusters ?? []}
                  editable={editable}
                  onChange={(v) => { const clusters = { ...form.clusters }; if (v) clusters[c.name] = v; else delete clusters[c.name]; update({ clusters }); }}
                />
              ))}
            </tbody>
          </table>
        </SettingsCard>
      )}

      <SettingsCard title="Grafana" description="Open traces in Grafana, and let the assistant read Prometheus metrics, Loki logs, dashboards and alerts through the Grafana MCP server.">
        {editable ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label="Grafana URL" hint="for “Open in Grafana”">
                <Input value={form.grafanaUrl} onChange={(e) => update({ grafanaUrl: e.target.value })} placeholder={placeholder("grafanaUrl", "https://grafana.example.com")} className={field} />
              </Labeled>
              <Labeled label="Tempo data source uid" hint="Connections → Data sources → Tempo">
                <Input value={form.grafanaTempoDatasource} onChange={(e) => update({ grafanaTempoDatasource: e.target.value })} placeholder={placeholder("grafanaTempoDatasource", "e.g. tempo")} className={field} />
              </Labeled>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label="Grafana MCP URL" hint="streamable HTTP endpoint">
                <Input value={form.mcpUrl} onChange={(e) => update({ mcpUrl: e.target.value })} placeholder={placeholder("mcpUrl", "https://grafana-mcp.example.com/mcp")} className={field} />
              </Labeled>
              <Labeled label="MCP token" hint="optional, the server's own token">
                <Secret value={form.mcpToken} onChange={(v) => update({ mcpToken: v })} placeholder={placeholder("mcpToken", "none")} label="MCP token" />
              </Labeled>
            </div>
            {!dirty && mcpStatus}
            <p className="text-xs text-muted-foreground">The assistant only gets Grafana's read tools (queries, searches, lists). Tools that create, change or delete anything are never offered.</p>
          </div>
        ) : (
          <div className="space-y-2 text-xs">
            {mcpStatus ?? <p className="text-muted-foreground">Not connected. An administrator sets <code className="font-mono">KUBEDECK_GRAFANA_MCP_URL</code>.</p>}
          </div>
        )}
      </SettingsCard>

      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onSave} disabled={!dirty || save.isPending} className="h-9 gap-1.5 rounded-lg px-5 text-xs">
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
          <Button onClick={() => { void tempo.refetch(); void mcp.refetch(); }} disabled={dirty || tempo.isFetching || mcp.isFetching} variant="outline" className="h-9 gap-1.5 rounded-lg px-4 text-xs" title={dirty ? "Save first, then test" : undefined}>
            <Zap className="h-3.5 w-3.5" />Test connections
          </Button>
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        </div>
      )}
    </div>
  );
}
