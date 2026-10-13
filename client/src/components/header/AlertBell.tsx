import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, Bell, BellOff, CheckCircle2, Info, Settings2, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAlertState } from "@/hooks/use-alerts";
import {
  alertHref, clearAlerts, markAllRead, notificationPermission, requestNotificationPermission, setAlertPrefs, type StoredAlert,
} from "@/lib/alert-store";
import { ago } from "@/lib/cluster-health";
import { cn } from "@/lib/utils";

const TONE = {
  critical: { icon: AlertTriangle, cls: "text-destructive" },
  warning: { icon: AlertTriangle, cls: "text-amber-500" },
  info: { icon: Info, cls: "text-muted-foreground" },
} as const;

function Row({ a, onOpen }: { a: StoredAlert; onOpen: (a: StoredAlert) => void }) {
  const tone = a.kind === "recovered" ? { icon: CheckCircle2, cls: "text-emerald-500" } : TONE[a.severity];
  const Icon = tone.icon;
  return (
    <button type="button" onClick={() => onOpen(a)} className={cn("flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted", !a.read && "bg-primary/[0.06]")}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone.cls)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-foreground">{a.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{a.body}</span>
        <span className="block text-[10px] text-muted-foreground/70">{a.context} · {ago(new Date(a.at).toISOString())} ago</span>
      </span>
    </button>
  );
}

/** Header bell: unread count, recent alerts, one-click mute and the system-notification switch. */
export function AlertBell() {
  const { history, prefs } = useAlertState();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState(notificationPermission);
  const unread = history.filter((a) => !a.read).length;

  useEffect(() => { if (open) setPerm(notificationPermission()); }, [open]);
  useEffect(() => {
    // reading the list counts as seeing it
    if (!open || unread === 0) return;
    const t = setTimeout(markAllRead, 1200);
    return () => clearTimeout(t);
  }, [open, unread]);

  const openAlert = (a: StoredAlert) => {
    setOpen(false);
    navigate(alertHref(a).replace(/^#/, ""));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread ? `${unread} unread alerts` : "Alerts"}
          title={prefs.enabled ? "Alerts" : "Alerts are off"}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary/40 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {prefs.enabled ? <Bell size={15} /> : <BellOff size={15} />}
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="text-sm font-semibold">Alerts</span>
          <span className="text-[11px] text-muted-foreground">new failures in the selected namespace</span>
          {history.length > 0 && (
            <button type="button" onClick={clearAlerts} title="Clear all" aria-label="Clear all alerts" className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
        <div className="max-h-80 overflow-auto p-1.5">
          {history.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {prefs.enabled ? "Nothing yet. You'll see crash loops, bad images, stuck pods and unhealthy deployments here as they happen." : "Alerts are turned off."}
            </p>
          ) : history.map((a) => <Row key={a.id} a={a} onOpen={openAlert} />)}
        </div>
        <div className="space-y-1.5 border-t border-border px-3 py-2.5 text-xs">
          <label className="flex cursor-pointer items-center justify-between">
            <span>Alert me about new failures</span>
            <input type="checkbox" checked={prefs.enabled} onChange={(e) => setAlertPrefs({ enabled: e.target.checked })} className="accent-[hsl(var(--primary))]" />
          </label>
          <label className="flex cursor-pointer items-center justify-between">
            <span>Desktop notifications</span>
            <input
              type="checkbox"
              checked={prefs.system && perm === "granted"}
              disabled={perm === "unsupported" || perm === "denied"}
              onChange={async (e) => {
                if (!e.target.checked) return setAlertPrefs({ system: false });
                const p = perm === "granted" ? "granted" : await requestNotificationPermission();
                setPerm(p);
                setAlertPrefs({ system: p === "granted" });
              }}
              className="accent-[hsl(var(--primary))]"
            />
          </label>
          {perm === "denied" && <p className="flex items-start gap-1.5 text-[11px] text-amber-500"><Settings2 className="mt-0.5 h-3 w-3 shrink-0" />Notifications are blocked for KubeDeck — allow them in System Settings → Notifications.</p>}
          <label className="flex items-center justify-between">
            <span>Interrupt me for</span>
            <select value={prefs.minSeverity} onChange={(e) => setAlertPrefs({ minSeverity: e.target.value as "critical" | "warning" })} className="rounded border border-border bg-background px-1.5 py-0.5 text-xs">
              <option value="warning">warnings and failures</option>
              <option value="critical">failures only</option>
            </select>
          </label>
          <label className="flex cursor-pointer items-center justify-between">
            <span>Tell me when deployments recover</span>
            <input type="checkbox" checked={prefs.recoveries} onChange={(e) => setAlertPrefs({ recoveries: e.target.checked })} className="accent-[hsl(var(--primary))]" />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
