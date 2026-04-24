import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import {
  FolderOpen, Plus, Trash2, Search, CheckCircle2, XCircle,
  Sun, Moon, Monitor as MonitorIcon, ExternalLink, Bot, Eye, EyeOff, Save,
  Loader2, Zap, Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { useSettings, useUpdateSettings, useKubeconfigScan } from "@/hooks/use-settings";
import { useAccent, ACCENT_THEMES } from "@/hooks/use-accent";

export default function Settings() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useSettings();
  const updateMutation = useUpdateSettings();
  const { data: scannedFiles, refetch: runScan, isFetching: isScanning } = useKubeconfigScan();

  const [newPath, setNewPath] = useState("");
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();

  const paths = settings?.kubeconfigPaths ?? [];

  const [aiProvider, setAiProvider] = useState<string>("openai");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("gpt-4o-mini");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiDirty, setAiDirty] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (settings?.ai) {
      setAiProvider(settings.ai.provider || "openai");
      setAiApiKey(settings.ai.apiKey || "");
      setAiModel(settings.ai.model || "gpt-4o-mini");
      setAiBaseUrl(settings.ai.baseUrl || "");
      setAiDirty(false);
    }
  }, [settings?.ai]);

  const PROVIDER_MODELS: Record<string, string[]> = {
    openai: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo", "o1-mini", "o1-preview"],
    anthropic: ["claude-3-5-haiku-20241022", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"],
    ollama: ["qwen3.5:2b", "qwen3.5:0.8b", "gemma4:e2b", "llama3.2", "llama3.1", "mistral", "codellama", "phi3", "gemma2"],
    custom: [],
  };

  const handleAiSave = async () => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kubeconfigPaths: paths,
          ai: { provider: aiProvider, apiKey: aiApiKey, model: aiModel, baseUrl: aiBaseUrl },
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast({ title: "Saved", description: "AI settings updated", variant: "success" as any });
      setAiDirty(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleAiTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await res.json();
      if (data.ok) {
        setTestResult({ ok: true, message: `Connected! Model: ${data.model}` });
      } else {
        setTestResult({ ok: false, message: data.message || "Connection failed" });
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message || "Connection failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleRemovePath = async (pathToRemove: string) => {
    const updated = paths.filter((p) => p !== pathToRemove);
    if (updated.length === 0) {
      toast({ title: "Cannot remove", description: "At least one kubeconfig path is required", variant: "destructive" });
      return;
    }
    try {
      await updateMutation.mutateAsync(updated);
      toast({ title: "Removed", description: `Removed ${pathToRemove}` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleAddPath = async () => {
    const trimmed = newPath.trim();
    if (!trimmed) return;
    if (paths.includes(trimmed)) {
      toast({ title: "Duplicate", description: "This path is already added", variant: "destructive" });
      return;
    }
    try {
      await updateMutation.mutateAsync([...paths, trimmed]);
      toast({ title: "Added", description: `Added ${trimmed}` });
      setNewPath("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleAddScanned = async (scannedPath: string) => {
    if (paths.includes(scannedPath)) {
      toast({ title: "Already added", description: "This path is already in your config" });
      return;
    }
    try {
      await updateMutation.mutateAsync([...paths, scannedPath]);
      toast({ title: "Added", description: `Added ${scannedPath}` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const themeOptions = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: MonitorIcon },
  ] as const;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden text-foreground selection:bg-primary/20">
      <AppHeader breadcrumbs={[{ label: "Settings" }]} showSelectors={false} />

      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-3xl mx-auto space-y-6">

          {/* ── Kubeconfig Management ── */}
          <section className="card-elevated overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/10">
                  <FolderOpen className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Kubeconfig Files</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Manage the kubeconfig files KubeDeck uses to connect to your clusters.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {isLoading ? (
                <div className="text-sm text-muted-foreground animate-pulse">Loading settings...</div>
              ) : (
                <div className="space-y-2">
                  {paths.map((p) => {
                    const fileInfo = settings?.files?.find((f) => f.path === p);
                    const exists = fileInfo?.exists ?? true;
                    return (
                      <div
                        key={p}
                        className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-muted/30 group"
                      >
                        {exists ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                        )}
                        <span className="text-sm text-foreground flex-1 truncate font-mono" title={p}>
                          {p}
                        </span>
                        {!exists && (
                          <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                            Not found
                          </span>
                        )}
                        <button
                          onClick={() => handleRemovePath(p)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          title="Remove"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Input
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  placeholder="Add custom kubeconfig path..."
                  className="flex-1 bg-muted/50 border-border text-sm font-mono h-9 rounded-lg focus-visible:ring-primary/20"
                  onKeyDown={(e) => e.key === "Enter" && handleAddPath()}
                />
                <Button
                  onClick={handleAddPath}
                  disabled={!newPath.trim() || updateMutation.isPending}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium h-9 px-4 rounded-lg gap-1.5 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </Button>
              </div>

              <div className="pt-3 border-t border-border">
                <Button
                  onClick={() => runScan()}
                  disabled={isScanning}
                  variant="outline"
                  className="text-xs font-medium h-9 px-4 rounded-lg gap-1.5 border-border text-muted-foreground hover:text-foreground"
                >
                  <Search className="w-3.5 h-3.5" />
                  {isScanning ? "Scanning..." : "Scan for Kubeconfig Files"}
                </Button>

                {scannedFiles && scannedFiles.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Found {scannedFiles.length} file{scannedFiles.length > 1 ? "s" : ""}
                    </p>
                    {scannedFiles.map((file) => {
                      const alreadyAdded = paths.includes(file.path);
                      return (
                        <div
                          key={file.path}
                          className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-muted/30"
                        >
                          {file.exists ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-foreground block truncate font-mono" title={file.path}>
                              {file.path}
                            </span>
                            {file.contexts.length > 0 && (
                              <span className="text-[11px] text-muted-foreground">
                                Contexts: {file.contexts.join(", ")}
                              </span>
                            )}
                          </div>
                          {alreadyAdded ? (
                            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                              Active
                            </span>
                          ) : file.exists ? (
                            <Button
                              onClick={() => handleAddScanned(file.path)}
                              disabled={updateMutation.isPending}
                              size="sm"
                              className="bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-medium h-7 px-3 rounded-lg gap-1"
                            >
                              <Plus className="w-3 h-3" />
                              Add
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground/60">Missing</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ── AI Configuration ── */}
          <section className="card-elevated overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/10">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">AI Configuration</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Configure your LLM provider for AI features (troubleshoot, YAML explain, chat).
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                <div className="flex gap-2">
                  {(["openai", "anthropic", "ollama", "custom"] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => {
                        setAiProvider(p);
                        setAiDirty(true);
                        if (p === "ollama") setAiModel(PROVIDER_MODELS.ollama[0]);
                        else if (p === "openai") setAiModel(PROVIDER_MODELS.openai[0]);
                        else if (p === "anthropic") setAiModel(PROVIDER_MODELS.anthropic[0]);
                      }}
                      className={`px-4 py-2 rounded-lg border text-xs font-medium capitalize transition-all ${
                        aiProvider === p
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-primary/20"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {aiProvider !== "ollama" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">API Key</label>
                  <div className="relative">
                    <Input
                      type={showApiKey ? "text" : "password"}
                      value={aiApiKey}
                      onChange={e => { setAiApiKey(e.target.value); setAiDirty(true); }}
                      placeholder={aiProvider === "openai" ? "sk-..." : aiProvider === "anthropic" ? "sk-ant-..." : "API key"}
                      className="bg-muted/50 border-border text-sm font-mono h-9 rounded-lg pr-10 focus-visible:ring-primary/20"
                    />
                    <button
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Model</label>
                {PROVIDER_MODELS[aiProvider]?.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {PROVIDER_MODELS[aiProvider].map(m => (
                      <button
                        key={m}
                        onClick={() => { setAiModel(m); setAiDirty(true); }}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-all ${
                          aiModel === m
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                    <Input
                      value={PROVIDER_MODELS[aiProvider].includes(aiModel) ? "" : aiModel}
                      onChange={e => { setAiModel(e.target.value); setAiDirty(true); }}
                      placeholder="or type custom model..."
                      className="bg-muted/50 border-border text-xs font-mono h-8 rounded-lg w-48 focus-visible:ring-primary/20"
                    />
                  </div>
                ) : (
                  <Input
                    value={aiModel}
                    onChange={e => { setAiModel(e.target.value); setAiDirty(true); }}
                    placeholder="Model name (e.g. gpt-4o-mini)"
                    className="bg-muted/50 border-border text-sm font-mono h-9 rounded-lg focus-visible:ring-primary/20"
                  />
                )}
              </div>

              {(aiProvider === "ollama" || aiProvider === "custom") && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Base URL {aiProvider === "ollama" && <span className="text-muted-foreground/60">(default: http://localhost:11434)</span>}
                  </label>
                  <Input
                    value={aiBaseUrl}
                    onChange={e => { setAiBaseUrl(e.target.value); setAiDirty(true); }}
                    placeholder={aiProvider === "ollama" ? "http://localhost:11434" : "https://your-api.example.com/v1"}
                    className="bg-muted/50 border-border text-sm font-mono h-9 rounded-lg focus-visible:ring-primary/20"
                  />
                </div>
              )}

              <div className="pt-4 border-t border-border space-y-3">
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleAiSave}
                    disabled={!aiDirty}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium h-9 px-5 rounded-lg gap-1.5 shadow-sm disabled:opacity-30"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save AI Settings
                  </Button>
                  <Button
                    onClick={handleAiTest}
                    disabled={testing || aiDirty}
                    variant="outline"
                    className="text-xs font-medium h-9 px-4 rounded-lg gap-1.5 border-border text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    {testing ? "Testing..." : "Test Connection"}
                  </Button>
                  {!aiDirty && !testResult && settings?.ai?.apiKey && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Configured
                    </span>
                  )}
                  {!aiDirty && !testResult && aiProvider === "ollama" && !settings?.ai?.apiKey && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Ollama (no key needed)
                    </span>
                  )}
                </div>
                {testResult && (
                  <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-xs font-medium ${
                    testResult.ok
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                      : "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
                  }`}>
                    {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    <span>{testResult.message}</span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ── Appearance ── */}
          <section className="card-elevated overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/10">
                  <Palette className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Appearance</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Choose your preferred theme and accent color.</p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-6">
              {/* Theme mode */}
              <div className="space-y-2.5">
                <label className="text-xs font-medium text-muted-foreground">Theme</label>
                <div className="flex gap-3">
                  {themeOptions.map((opt) => {
                    const active = theme === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setTheme(opt.value)}
                        className={`flex items-center gap-2.5 px-5 py-3 rounded-xl border transition-all ${
                          active
                            ? "border-primary/30 bg-primary/10 text-primary shadow-sm"
                            : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-primary/20"
                        }`}
                      >
                        <opt.icon className="w-4 h-4" />
                        <span className="text-sm font-medium">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accent color */}
              <div className="space-y-2.5">
                <label className="text-xs font-medium text-muted-foreground">Accent Color</label>
                <div className="flex flex-wrap gap-3">
                  {ACCENT_THEMES.map((t) => {
                    const active = accent === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setAccent(t.id)}
                        className={`group relative flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-xl border transition-all ${
                          active
                            ? "border-primary/40 bg-primary/10 shadow-sm"
                            : "border-border bg-muted/30 hover:border-primary/20"
                        }`}
                      >
                        <span
                          className="w-4 h-4 rounded-full shrink-0 transition-shadow"
                          style={{
                            background: t.color,
                            boxShadow: active ? `0 0 0 2px hsl(var(--card)), 0 0 0 4px ${t.color}` : "none",
                          }}
                        />
                        <span className={`text-xs font-medium transition-colors ${
                          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                        }`}>
                          {t.label}
                        </span>
                        {active && (
                          <CheckCircle2 className="w-3 h-3 text-primary ml-auto" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* ── About ── */}
          <section className="card-elevated overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/10">
                  <MonitorIcon className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-sm font-semibold text-foreground">About</h2>
              </div>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-4">
                <span className="text-xs font-medium text-muted-foreground w-20">Version</span>
                <span className="text-sm text-foreground tabular-nums">1.3.0</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs font-medium text-muted-foreground w-20">Source</span>
                <a
                  href="https://github.com/swapnil-saal/kube-navigator"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  GitHub <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs font-medium text-muted-foreground w-20">License</span>
                <span className="text-sm text-foreground">MIT</span>
              </div>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
