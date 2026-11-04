import { useState } from "react";
import { CheckCircle2, Plus, Search, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useKubeconfigScan, useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { SettingsCard } from "./SettingsCard";

/** The kubeconfig files KubeDeck reads clusters from. */
export function ClustersSection() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useSettings();
  const updateMutation = useUpdateSettings();
  const { data: scannedFiles, refetch: runScan, isFetching: isScanning } = useKubeconfigScan();
  const [newPath, setNewPath] = useState("");
  const paths = settings?.kubeconfigPaths ?? [];

  const save = async (next: string[], done: string) => {
    try {
      await updateMutation.mutateAsync(next);
      toast({ title: done });
      return true;
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return false;
    }
  };

  const handleRemovePath = (p: string) => {
    const next = paths.filter((x) => x !== p);
    if (next.length === 0) {
      toast({ title: "Cannot remove", description: "At least one kubeconfig path is required", variant: "destructive" });
      return;
    }
    void save(next, `Removed ${p}`);
  };

  const handleAddPath = async () => {
    const trimmed = newPath.trim();
    if (!trimmed) return;
    if (paths.includes(trimmed)) {
      toast({ title: "Duplicate", description: "This path is already added", variant: "destructive" });
      return;
    }
    if (await save([...paths, trimmed], `Added ${trimmed}`)) setNewPath("");
  };

  const handleAddScanned = (p: string) => {
    if (paths.includes(p)) return;
    void save([...paths, p], `Added ${p}`);
  };

  return (
    <SettingsCard
      title="Kubeconfig files"
      description="KubeDeck merges these files, like KUBECONFIG does. Every context in them appears in the scope switcher."
    >
      <div className="space-y-4">
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
                        className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border/50 bg-secondary/40 group"
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
                          className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border/50 bg-secondary/40"
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
    </SettingsCard>
  );
}
