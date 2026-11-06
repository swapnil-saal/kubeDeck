import { AlertTriangle, ShieldAlert } from "lucide-react";

/** Asks before running a command that changes the cluster. */
export function ConfirmPanel({ warning, command, onConfirm, onCancel }: {
  warning: string;
  command: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="px-4 py-4 border-t border-warning/30 bg-warning/5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <p className="text-[11px] font-semibold text-warning">Confirm this change</p>
          <p className="text-[10px] text-foreground/70">{warning}</p>
          <div className="bg-surface-inset border border-border rounded px-3 py-1.5 text-[10px] font-mono text-foreground/70">{command}</div>
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={onConfirm} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium text-warning-foreground bg-warning hover:bg-warning/90 transition-colors">
              <ShieldAlert className="w-3 h-3" />
              Run it
            </button>
            <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-[10px] font-medium text-muted-foreground border border-border hover:bg-foreground/5 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
