import { useState, type ReactNode } from "react";
import { ArrowRight, Cable, ExternalLink, Laptop, List, RotateCw, Scaling, Server, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  useDeletePod, usePodEnv, usePortForward, useRestartDeployment, useScaleDeployment,
} from "@/hooks/use-k8s";

interface ContainerPort {
  port: number;
  name?: string;
  protocol?: string;
}

type Confirm = { title: string; body: string; action: string; danger: boolean; run: () => Promise<void> };

const DIALOG_WIDTH = { sm: "max-w-sm", md: "max-w-lg", xl: "max-w-5xl" } as const;

const DialogShell = ({ open, onClose, icon, title, subject, size = "sm", children }: {
  open: boolean;
  onClose: () => void;
  icon: ReactNode;
  title: string;
  subject?: string;
  size?: keyof typeof DIALOG_WIDTH;
  children: ReactNode;
}) => (
  <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
    <DialogContent className={`${DIALOG_WIDTH[size]} overflow-hidden rounded-xl border-border bg-card p-0 shadow-lg`}>
      <DialogHeader className="border-b border-border px-5 py-3">
        <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="rounded-lg bg-primary/10 p-1.5 text-primary">{icon}</span>
          <span className="min-w-0">
            <span className="block">{title}</span>
            {subject && <span className="block truncate font-mono text-[11px] font-normal text-muted-foreground" title={subject}>{subject}</span>}
          </span>
        </DialogTitle>
      </DialogHeader>
      {children}
    </DialogContent>
  </Dialog>
);

const portField = "h-9 rounded-lg border-border bg-muted/50 font-mono text-sm text-foreground focus-visible:ring-primary/30"; // scale input

/**
 * Actions on pods and deployments from the lists (environment, port forward, scale, restart,
 * delete) and the dialogs they open. Destructive ones ask in an in-app dialog, never `confirm()`.
 */
export function useResourceActions({ context, namespace }: { context: string; namespace: string }) {
  const { toast } = useToast();
  const [envPod, setEnvPod] = useState<string | null>(null);
  const [forward, setForward] = useState<{ pod: string; ports: ContainerPort[] } | null>(null);
  const [localPort, setLocalPort] = useState("8080");
  const [remotePort, setRemotePort] = useState("80");
  /** until the user edits it, the local port follows the remote one */
  const [localEdited, setLocalEdited] = useState(false);
  const [scale, setScale] = useState<{ name: string; replicas: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);

  const env = usePodEnv(envPod ?? "", context, namespace, envPod !== null);
  const portForward = usePortForward();
  const scaleDeployment = useScaleDeployment();
  const restartDeployment = useRestartDeployment();
  const deletePod = useDeletePod();

  const fail = (title: string, err: unknown) =>
    toast({ title, description: err instanceof Error ? err.message : String(err), variant: "destructive" });

  const openPortForward = (pod: string, ports: ContainerPort[] = []) => {
    const first = ports[0]?.port;
    setLocalPort(String(first ?? 8080));
    setRemotePort(String(first ?? 80));
    setLocalEdited(false);
    setForward({ pod, ports });
  };
  const pickRemote = (port: string) => {
    setRemotePort(port);
    if (!localEdited) setLocalPort(port);
  };

  const startForward = async () => {
    if (!forward) return;
    const local = Number.parseInt(localPort, 10);
    const remote = Number.parseInt(remotePort, 10) || local;
    if (!(local >= 1 && local <= 65535) || !(remote >= 1 && remote <= 65535)) {
      toast({ title: "Invalid port", description: "Ports must be between 1 and 65535", variant: "destructive" });
      return;
    }
    try {
      const result = await portForward.mutateAsync({ name: forward.pod, context, namespace, port: local, remotePort: remote });
      toast({
        title: "Port forward active",
        description: (
          <span className="flex items-center gap-2">
            <span className="font-mono">localhost:{local} → {forward.pod}:{remote}</span>
            <a href={`http://localhost:${local}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              Open <ExternalLink className="h-3 w-3" />
            </a>
          </span>
        ),
      });
      setForward(null);
    } catch (err) {
      fail("Port forward failed", err);
    }
  };

  const applyScale = async () => {
    if (!scale) return;
    const replicas = Number.parseInt(scale.replicas, 10);
    if (!(replicas >= 0)) return;
    try {
      await scaleDeployment.mutateAsync({ name: scale.name, context, namespace, replicas });
      toast({ title: "Scaled", description: `${scale.name} scaled to ${replicas} replicas` });
      setScale(null);
    } catch (err) {
      fail("Scale failed", err);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.run();
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const actions = {
    showEnv: (pod: string) => setEnvPod(pod),
    openPortForward,
    openScale: (name: string, current: number) => setScale({ name, replicas: String(current) }),
    restart: (name: string) =>
      setConfirm({
        title: "Restart deployment",
        body: `Roll out new pods for ${name}? Existing pods are replaced one by one.`,
        action: "Restart",
        danger: false,
        run: async () => {
          try {
            await restartDeployment.mutateAsync({ name, context, namespace });
            toast({ title: "Restarted", description: `${name} rolling restart started` });
          } catch (err) {
            fail("Restart failed", err);
          }
        },
      }),
    deletePod: (name: string) =>
      setConfirm({
        title: "Delete pod",
        body: `Delete ${name}? Its controller (if any) will create a replacement.`,
        action: "Delete",
        danger: true,
        run: async () => {
          try {
            await deletePod.mutateAsync({ name, context, namespace });
            toast({ title: "Pod deleted", description: `${name} terminated.` });
          } catch (err) {
            fail("Delete failed", err);
          }
        },
      }),
  };

  const dialogs = (
    <>
      <DialogShell open={envPod !== null} onClose={() => setEnvPod(null)} icon={<List className="h-3.5 w-3.5" />} title="Environment" subject={envPod ?? ""} size="xl">
        <div className="h-[500px] overflow-auto bg-surface-inset p-4 font-mono text-[12px] leading-relaxed">
          {env.isLoading ? (
            <span className="animate-pulse text-muted-foreground">Loading…</span>
          ) : (
            <pre className="whitespace-pre-wrap text-foreground/70">{env.data?.env}</pre>
          )}
        </div>
      </DialogShell>

      <DialogShell open={forward !== null} onClose={() => setForward(null)} icon={<Cable className="h-3.5 w-3.5" />} title="Port forward" subject={forward?.pod} size="md">
        <form className="space-y-5 p-5" onSubmit={(e) => { e.preventDefault(); void startForward(); }}>
          {/* the connection being made, left to right */}
          <div className="flex items-stretch gap-2">
            <label className="min-w-0 flex-1 rounded-xl border border-border bg-muted/40 p-3">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Laptop className="h-3.5 w-3.5" />This computer</span>
              <span className="mt-1.5 flex items-center font-mono text-sm text-muted-foreground">
                localhost:
                <input
                  type="number" min={1} max={65535} value={localPort}
                  onChange={(e) => { setLocalPort(e.target.value); setLocalEdited(true); }}
                  aria-label="Local port"
                  className="w-[4.5rem] rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-sm text-foreground outline-none [appearance:textfield] focus:border-primary/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </span>
            </label>
            <span className="flex items-center text-muted-foreground" aria-hidden><ArrowRight className="h-4 w-4" /></span>
            <label className="min-w-0 flex-1 rounded-xl border border-border bg-muted/40 p-3">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Server className="h-3.5 w-3.5" />Pod</span>
              <span className="mt-1.5 flex items-center font-mono text-sm text-muted-foreground">
                port
                <input
                  type="number" min={1} max={65535} value={remotePort}
                  onChange={(e) => pickRemote(e.target.value)}
                  aria-label="Pod port"
                  className="ml-1.5 w-[4.5rem] rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-sm text-foreground outline-none [appearance:textfield] focus:border-primary/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </span>
            </label>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Ports the pod declares</p>
            {forward && forward.ports.length > 0 ? (
              <div role="radiogroup" aria-label="Declared ports" className="flex flex-col gap-1">
                {forward.ports.map((cp) => {
                  const on = remotePort === String(cp.port);
                  return (
                    <button
                      key={`${cp.port}-${cp.protocol ?? ""}`}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => pickRemote(String(cp.port))}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${on ? "border-primary/50 bg-primary/10" : "border-border hover:border-primary/30"}`}
                    >
                      <span className="w-14 font-mono text-sm font-semibold text-foreground">{cp.port}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={cp.name}>{cp.name || "unnamed"}</span>
                      <span className="text-[10px] font-semibold uppercase text-muted-foreground">{cp.protocol || "TCP"}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">None declared in the pod spec. Type the port the app listens on.</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" className="h-9 rounded-lg px-4 text-xs" onClick={() => setForward(null)}>Cancel</Button>
            <Button type="submit" className="h-9 rounded-lg px-5 text-xs" disabled={portForward.isPending}>
              {portForward.isPending ? "Connecting…" : `Forward localhost:${localPort || "?"}`}
            </Button>
          </div>
        </form>
      </DialogShell>

      <DialogShell open={scale !== null} onClose={() => setScale(null)} icon={<Scaling className="h-3.5 w-3.5" />} title="Scale" subject={scale?.name}>
        <div className="space-y-4 p-5">
          <label className="block space-y-2">
            <span className="text-xs font-medium text-muted-foreground">Replicas</span>
            <Input type="number" min={0} value={scale?.replicas ?? ""} onChange={(e) => setScale((s) => (s ? { ...s, replicas: e.target.value } : s))} className={portField} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="h-9 rounded-lg px-4 text-xs" onClick={() => setScale(null)}>Cancel</Button>
            <Button className="h-9 rounded-lg px-5 text-xs" onClick={applyScale} disabled={scaleDeployment.isPending}>Scale</Button>
          </div>
        </div>
      </DialogShell>

      <DialogShell
        open={confirm !== null}
        onClose={() => !busy && setConfirm(null)}
        icon={confirm?.danger ? <Trash2 className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
        title={confirm?.title ?? ""}
      >
        <div className="space-y-4 p-5">
          <p className="text-sm text-foreground">{confirm?.body}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="h-9 rounded-lg px-4 text-xs" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
            <Button
              variant={confirm?.danger ? "destructive" : "default"}
              className="h-9 rounded-lg px-5 text-xs"
              onClick={runConfirm}
              disabled={busy}
              autoFocus
            >
              {busy ? "Working…" : confirm?.action}
            </Button>
          </div>
        </div>
      </DialogShell>
    </>
  );

  return { ...actions, dialogs };
}
