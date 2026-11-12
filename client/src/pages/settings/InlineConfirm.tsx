import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** "Delete this?" in place, with the destructive button, Cancel, and the server's error if it fails. */
export function InlineConfirm({ children, action, pending, error, onConfirm, onCancel }: {
  children: ReactNode;
  action: string;
  pending: boolean;
  error: Error | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="min-w-0 flex-1 text-xs">{children}</p>
      <Button size="sm" variant="destructive" disabled={pending} onClick={onConfirm}>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {action}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      {error && <p role="alert" className="w-full text-xs text-destructive">{error.message}</p>}
    </div>
  );
}
