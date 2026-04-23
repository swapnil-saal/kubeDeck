import { useState } from "react";
import { useTheme } from "next-themes";
import {
  FolderOpen, Plus, Trash2, Search, CheckCircle2, XCircle,
  Sun, Moon, Monitor as MonitorIcon, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { useSettings, useUpdateSettings, useKubeconfigScan } from "@/hooks/use-settings";

export default function Settings() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useSettings();
  const updateMutation = useUpdateSettings();
  const { data: scannedFiles, refetch: runScan, isFetching: isScanning } = useKubeconfigScan();

  const [newPath, setNewPath] = useState("");
  const { theme, setTheme } = useTheme();

  const paths = settings?.kubeconfigPaths ?? [];

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
    <div className="flex flex-col h-full bg-background overflow-hidden font-mono text-foreground selection:bg-primary/30">
      <AppHeader breadcrumbs={[{ label: "Settings" }]} showSelectors={false} />

      <main className="flex-1 overflow-auto relative">
        <div className="absolute inset-0 grid-bg" />
        <div className="relative p-6 max-w-3xl mx-auto space-y-6">

          {/* ── Kubeconfig Management ── */}
          <section className="rounded-lg border border-border bg-surface/60 overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-foreground/[0.02]">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-cyan-500" />
                <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-foreground">Kubeconfig Files</h2>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Manage the kubeconfig files KubeDeck uses to connect to your clusters.
              </p>
            </div>

            <div className="p-5 space-y-4">
              {/* Active paths */}
              {isLoading ? (
                <div className="text-[11px] text-muted-foreground animate-pulse">Loading settings...</div>
              ) : (
                <div className="space-y-2">
                  {paths.map((p) => {
                    const fileInfo = settings?.files?.find((f) => f.path === p);
                    const exists = fileInfo?.exists ?? true;
                    return (
                      <div
                        key={p}
                        className="flex items-center gap-3 px-3 py-2 rounded border border-border bg-foreground/[0.02] group"
                      >
                        {exists ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        )}
                        <span className="text-[11px] text-foreground/80 flex-1 truncate" title={p}>
                          {p}
                        </span>
                        {!exists && (
                          <span className="text-[9px] uppercase tracking-wider font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-sm border border-red-500/20">
                            not found
                          </span>
                        )}
                        <button
                          onClick={() => handleRemovePath(p)}
                          className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                          title="Remove"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add custom path */}
              <div className="flex items-center gap-2">
                <Input
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  placeholder="Add custom kubeconfig path..."
                  className="flex-1 bg-foreground/[0.03] border-border text-[11px] font-mono h-8 rounded-sm focus-visible:ring-primary/20"
                  onKeyDown={(e) => e.key === "Enter" && handleAddPath()}
                />
                <Button
                  onClick={handleAddPath}
                  disabled={!newPath.trim() || updateMutation.isPending}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] uppercase font-bold tracking-wider h-8 px-3 rounded-sm gap-1.5"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </Button>
              </div>

              {/* Scan button */}
              <div className="pt-2 border-t border-border">
                <Button
                  onClick={() => runScan()}
                  disabled={isScanning}
                  variant="outline"
                  className="text-[10px] uppercase font-bold tracking-wider h-8 px-4 rounded-sm gap-1.5 border-border text-muted-foreground hover:text-foreground"
                >
                  <Search className="w-3 h-3" />
                  {isScanning ? "Scanning..." : "Scan for Kubeconfig Files"}
                </Button>

                {/* Scan results */}
                {scannedFiles && scannedFiles.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground">
                      Found {scannedFiles.length} file{scannedFiles.length > 1 ? "s" : ""}
                    </p>
                    {scannedFiles.map((file) => {
                      const alreadyAdded = paths.includes(file.path);
                      return (
                        <div
                          key={file.path}
                          className="flex items-center gap-3 px-3 py-2 rounded border border-border bg-foreground/[0.02]"
                        >
                          {file.exists ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] text-foreground/80 block truncate" title={file.path}>
                              {file.path}
                            </span>
                            {file.contexts.length > 0 && (
                              <span className="text-[9px] text-muted-foreground">
                                Contexts: {file.contexts.join(", ")}
                              </span>
                            )}
                          </div>
                          {alreadyAdded ? (
                            <span className="text-[9px] uppercase tracking-wider font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-sm border border-emerald-500/20">
                              active
                            </span>
                          ) : file.exists ? (
                            <Button
                              onClick={() => handleAddScanned(file.path)}
                              disabled={updateMutation.isPending}
                              size="sm"
                              className="bg-cyan-600 hover:bg-cyan-500 text-white text-[9px] uppercase font-bold tracking-wider h-6 px-2.5 rounded-sm gap-1"
                            >
                              <Plus className="w-2.5 h-2.5" />
                              Add
                            </Button>
                          ) : (
                            <span className="text-[9px] text-muted-foreground/60">missing</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ── Appearance ── */}
          <section className="rounded-lg border border-border bg-surface/60 overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-foreground/[0.02]">
              <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-amber-500" />
                <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-foreground">Appearance</h2>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Choose your preferred theme.</p>
            </div>
            <div className="p-5">
              <div className="flex gap-3">
                {themeOptions.map((opt) => {
                  const active = theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setTheme(opt.value)}
                      className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg border transition-all ${
                        active
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-foreground/[0.02] text-muted-foreground hover:text-foreground hover:border-foreground/10"
                      }`}
                    >
                      <opt.icon className="w-4 h-4" />
                      <span className="text-[11px] font-bold uppercase tracking-wider">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ── About ── */}
          <section className="rounded-lg border border-border bg-surface/60 overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-foreground/[0.02]">
              <div className="flex items-center gap-2">
                <MonitorIcon className="w-4 h-4 text-primary" />
                <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-foreground">About</h2>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground w-20">Version</span>
                <span className="text-[11px] text-foreground tabular-nums">1.1.0</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground w-20">Source</span>
                <a
                  href="https://github.com/swapnil-saal/kube-navigator"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-1"
                >
                  GitHub <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground w-20">License</span>
                <span className="text-[11px] text-foreground">MIT</span>
              </div>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
