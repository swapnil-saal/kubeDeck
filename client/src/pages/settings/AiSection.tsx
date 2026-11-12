import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildUrl } from "@shared/routes";
import { pluginInfoSchema, pluginPaths, type PluginInfo, type PluginValues } from "@shared/plugins";
import { CheckCircle2, Eye, EyeOff, Loader2, Save, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useServerMode } from "@/hooks/use-server-mode";
import { getParsed, requestJson } from "@/lib/request-json";
import { testAiConnection } from "@/ai";
import { cn } from "@/lib/utils";
import { SettingsCard } from "./SettingsCard";

type Provider = "openai" | "anthropic" | "ollama" | "custom";
interface AiForm { provider: string; apiKey: string; model: string; fastModel: string; baseUrl: string }

/** The AI provider is kept as the "ai" plugin: what is saved, what the server's environment pins. */
const AI_URL = buildUrl(pluginPaths.one, { id: "ai" });
const useAiPlugin = () => useQuery({ queryKey: [AI_URL], queryFn: getParsed(pluginInfoSchema, AI_URL) });

function useSaveAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: PluginValues) => requestJson<PluginInfo>("PUT", AI_URL, { values }),
    onSuccess: () => {
      for (const key of [AI_URL, "/api/settings", "/api/mode"]) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

const formOf = (p: PluginInfo): AiForm => {
  const v = (k: string) => (typeof p.values[k] === "string" ? (p.values[k] as string) : "");
  return { provider: v("provider") || "openai", apiKey: "", model: v("model"), fastModel: v("fastModel"), baseUrl: v("baseUrl") };
};

/** Only what changed; a key is sent only when one was typed (an empty key keeps the stored one). */
function changedValues(before: AiForm, after: AiForm): PluginValues {
  const out: PluginValues = {};
  for (const k of ["provider", "model", "fastModel", "baseUrl"] as const) if (after[k] !== before[k]) out[k] = after[k];
  if (after.apiKey) out.apiKey = after.apiKey;
  return out;
}

/** Suggestions only: any model your provider serves can be typed in. */
const PROVIDERS: Record<Provider, { label: string; hint: string; models: string[]; fast: string; needsKey: boolean; needsUrl: boolean; urlPlaceholder?: string }> = {
  openai: { label: "OpenAI", hint: "api.openai.com", models: ["gpt-4o", "gpt-4o-mini"], fast: "gpt-4o-mini", needsKey: true, needsUrl: false },
  anthropic: { label: "Anthropic", hint: "api.anthropic.com", models: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"], fast: "claude-haiku-5-5", needsKey: true, needsUrl: false },
  ollama: { label: "Ollama", hint: "local models, no key", models: ["llama3.2", "qwen3.5:2b", "qwen3.5:0.8b", "mistral"], fast: "qwen3.5:0.8b", needsKey: false, needsUrl: true, urlPlaceholder: "http://localhost:11434" },
  custom: { label: "OpenAI-compatible", hint: "vLLM, LiteLLM, any gateway", models: [], fast: "", needsKey: true, needsUrl: true, urlPlaceholder: "https://your-gateway.example.com/v1" },
};

const field = "h-9 rounded-lg border-border bg-muted/50 font-mono text-sm focus-visible:ring-primary/20";

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

/** Set by the server's environment: shown, not editable here. */
function Pinned({ pinned, children }: { pinned: boolean; children: React.ReactNode }) {
  if (!pinned) return <>{children}</>;
  return (
    <div className="space-y-1">
      <fieldset disabled className="opacity-70">{children}</fieldset>
      <p className="text-[11px] text-muted-foreground">Set by the server's environment</p>
    </div>
  );
}

/**
 * Which model provider the assistant uses. An admin sets it for everyone on a shared KubeDeck; on the
 * desktop it is yours. The key is stored encrypted and never shown again.
 */
export function AiSection() {
  const { toast } = useToast();
  const { mode } = useServerMode();
  const plugin = useAiPlugin();
  const save = useSaveAi();
  const [saved, setSaved] = useState<AiForm>({ provider: "openai", apiKey: "", model: "", fastModel: "", baseUrl: "" });
  const [form, setForm] = useState<AiForm>(saved);
  const [dirty, setDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!plugin.data) return;
    const f = formOf(plugin.data);
    setSaved(f);
    setForm(f);
    setDirty(false);
  }, [plugin.data]);
  const pinned = new Set(plugin.data?.envPinned ?? []);
  const keyStored = plugin.data?.secretsSet.includes("apiKey") ?? false;

  const provider = PROVIDERS[(form.provider as Provider) in PROVIDERS ? (form.provider as Provider) : "openai"];
  const update = (patch: Partial<AiForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
    setTest(null);
  };

  const pickProvider = (id: Provider) => {
    const p = PROVIDERS[id];
    update({ provider: id, model: p.models[0] ?? "", fastModel: p.fast, baseUrl: p.needsUrl ? form.baseUrl : "" });
  };

  const onSave = async () => {
    try {
      await save.mutateAsync(changedValues(saved, form));
      setDirty(false);
      toast({ title: "Saved", description: mode === "web" ? "Everyone on this KubeDeck now uses these AI settings." : "AI settings updated" });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const onTest = async () => {
    setTesting(true);
    setTest(null);
    const r = await testAiConnection();
    setTest(r.ok ? { ok: true, message: `Connected · ${r.model}` } : { ok: false, message: r.message || "Connection failed" });
    setTesting(false);
  };

  const configured = plugin.data?.status.state === "ok";
  if (plugin.isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (plugin.error) return <p role="alert" className="text-sm text-destructive">Could not load the AI settings: {plugin.error.message}</p>;

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Connection"
        description={`The model provider behind Ask Deck, diagnoses, summaries and the palette's plain-English commands.${mode === "web" ? " Applies to everyone using this KubeDeck." : ""}`}
      >
        <div className="space-y-5">
          <Pinned pinned={pinned.has("provider")}>
          <div role="radiogroup" aria-label="Provider" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(PROVIDERS) as Provider[]).map((id) => {
              const on = form.provider === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pickProvider(id)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    on ? "border-primary/50 bg-primary/10" : "border-border hover:border-primary/30",
                  )}
                >
                  <span className={cn("block text-[13px] font-semibold", on ? "text-primary" : "text-foreground")}>{PROVIDERS[id].label}</span>
                  <span className="block text-[11px] text-muted-foreground">{PROVIDERS[id].hint}</span>
                </button>
              );
            })}
          </div>
          </Pinned>

          {provider.needsUrl && (
            <Labeled label="Base URL" hint={form.provider === "ollama" ? "default http://localhost:11434" : undefined}>
              <Pinned pinned={pinned.has("baseUrl")}>
                <Input value={form.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} placeholder={provider.urlPlaceholder} className={field} />
              </Pinned>
            </Labeled>
          )}

          {provider.needsKey && (
            <Labeled label="API key" hint={keyStored ? "stored encrypted · type a new one to replace it" : form.provider === "custom" ? "if your gateway needs one" : undefined}>
              <Pinned pinned={pinned.has("apiKey")}>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={form.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  placeholder={keyStored ? "•••••••• stored" : "Paste your key"}
                  autoComplete="off"
                  className={cn(field, "pr-10")}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "Hide API key" : "Show API key"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              </Pinned>
            </Labeled>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Models" description="Pick from the suggestions or type any model your provider serves.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Labeled label="Main model" hint="chat and diagnoses">
            <Pinned pinned={pinned.has("model")}>
              <Input list="kd-models" value={form.model} onChange={(e) => update({ model: e.target.value })} placeholder={provider.models[0] ?? "model name"} className={field} />
            </Pinned>
          </Labeled>
          <Labeled label="Fast model" hint="summaries, hints, translations">
            <Pinned pinned={pinned.has("fastModel")}>
              <Input list="kd-models" value={form.fastModel} onChange={(e) => update({ fastModel: e.target.value })} placeholder={provider.fast || "optional"} className={field} />
            </Pinned>
          </Labeled>
          <datalist id="kd-models">
            {provider.models.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Quick features (event summaries, status hints) turn on once a fast model is set.</p>
      </SettingsCard>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSave} disabled={!dirty || save.isPending} className="h-9 gap-1.5 rounded-lg px-5 text-xs">
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
        <Button onClick={onTest} disabled={testing || dirty} variant="outline" className="h-9 gap-1.5 rounded-lg px-4 text-xs" title={dirty ? "Save first, then test" : undefined}>
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {testing ? "Testing…" : "Test connection"}
        </Button>
        {test ? (
          <span className={cn("flex items-center gap-1.5 text-xs font-medium", test.ok ? "text-success" : "text-destructive")}>
            {test.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {test.message}
          </span>
        ) : (
          !dirty && configured && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-success">
              <CheckCircle2 className="h-4 w-4" /> Configured
            </span>
          )
        )}
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
      </div>
    </div>
  );
}
