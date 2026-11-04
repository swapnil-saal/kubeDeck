import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, Save, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useSettings, useUpdateAiSettings, type AiSettingsInput } from "@/hooks/use-settings";
import { testAiConnection } from "@/ai";
import { cn } from "@/lib/utils";
import { SettingsCard } from "./SettingsCard";

type Provider = "openai" | "anthropic" | "ollama" | "custom";

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

/** Which model provider the assistant uses. Saved on this machine (~/.kubedeck/settings.json). */
export function AiSection() {
  const { toast } = useToast();
  const { data: settings } = useSettings();
  const save = useUpdateAiSettings();
  const [form, setForm] = useState<AiSettingsInput>({ provider: "openai", apiKey: "", model: "", fastModel: "", baseUrl: "" });
  const [dirty, setDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!settings?.ai) return;
    const ai = settings.ai;
    setForm({ provider: ai.provider || "openai", apiKey: ai.apiKey || "", model: ai.model || "", fastModel: ai.fastModel || "", baseUrl: ai.baseUrl || "" });
    setDirty(false);
  }, [settings?.ai]);

  const provider = PROVIDERS[(form.provider as Provider) in PROVIDERS ? (form.provider as Provider) : "openai"];
  const update = (patch: Partial<AiSettingsInput>) => {
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
      await save.mutateAsync({ ai: form, kubeconfigPaths: settings?.kubeconfigPaths ?? [] });
      setDirty(false);
      toast({ title: "Saved", description: "AI settings updated" });
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

  const configured = !!settings?.ai && (!!settings.ai.apiKey || settings.ai.provider === "ollama");

  return (
    <div className="space-y-6">
      <SettingsCard title="Connection" description="The model provider behind Ask Deck, diagnoses, summaries and the palette's plain-English commands.">
        <div className="space-y-5">
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

          {provider.needsUrl && (
            <Labeled label="Base URL" hint={form.provider === "ollama" ? "default http://localhost:11434" : undefined}>
              <Input value={form.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} placeholder={provider.urlPlaceholder} className={field} />
            </Labeled>
          )}

          {provider.needsKey && (
            <Labeled label="API key" hint={form.provider === "custom" ? "if your gateway needs one" : undefined}>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={form.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  placeholder="Paste your key"
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
            </Labeled>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Models" description="Pick from the suggestions or type any model your provider serves.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Labeled label="Main model" hint="chat and diagnoses">
            <Input list="kd-models" value={form.model} onChange={(e) => update({ model: e.target.value })} placeholder={provider.models[0] ?? "model name"} className={field} />
          </Labeled>
          <Labeled label="Fast model" hint="summaries, hints, translations">
            <Input list="kd-models" value={form.fastModel} onChange={(e) => update({ fastModel: e.target.value })} placeholder={provider.fast || "optional"} className={field} />
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
