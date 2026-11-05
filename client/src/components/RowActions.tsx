import type { FC } from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface RowAction {
  id: string;
  label: string;
  /** one line on what it does, shown under the label */
  description?: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** destructive: listed last, separated, in red */
  danger?: boolean;
  /** shown but not clickable, with this reason (e.g. the account's RBAC does not allow it) */
  disabledReason?: string;
}

/**
 * Actions for one table row: the most common one as a labelled button, everything else
 * in a menu where each action says what it does. Replaces rows of unlabelled icons.
 */
export const RowActions: FC<{
  /** what the actions apply to, for the menu heading and screen readers, e.g. "pod api-7d9f" */
  subject: string;
  primary?: { label: string; icon: LucideIcon; onClick: () => void };
  actions: RowAction[];
}> = ({ subject, primary, actions }) => {
  const safe = actions.filter((a) => !a.danger);
  const danger = actions.filter((a) => a.danger);

  return (
    <div className="flex items-center justify-end gap-1">
      {primary && (
        <button
          type="button"
          onClick={primary.onClick}
          aria-label={`${primary.label}: ${subject}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-[11px] font-medium text-muted-foreground opacity-0 transition-[opacity,colors] hover:border-border hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <primary.icon className="h-3.5 w-3.5" />
          {primary.label}
        </button>
      )}
      {actions.length > 0 && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More actions for ${subject}`}
              title="More actions"
              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground focus-visible:text-foreground group-hover:text-muted-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="truncate font-mono text-[11px] font-normal text-muted-foreground">{subject}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {safe.map((a) => <ActionItem key={a.id} action={a} />)}
            {danger.length > 0 && <DropdownMenuSeparator />}
            {danger.map((a) => <ActionItem key={a.id} action={a} />)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

const ActionItem: FC<{ action: RowAction }> = ({ action: a }) => (
  <DropdownMenuItem
    onSelect={a.onSelect}
    disabled={!!a.disabledReason}
    className={cn("flex items-start gap-2.5 py-2", a.danger && !a.disabledReason && "text-destructive focus:bg-destructive/10 focus:text-destructive")}
  >
    <a.icon className={cn("mt-0.5 h-4 w-4 shrink-0", a.danger && !a.disabledReason ? "text-destructive" : "text-muted-foreground")} />
    <span className="min-w-0">
      <span className="block text-[13px] font-medium">{a.label}</span>
      {a.disabledReason ? (
        <span className="block text-[11px] leading-snug text-muted-foreground">{a.disabledReason}</span>
      ) : a.description && (
        <span className={cn("block text-[11px] leading-snug", a.danger ? "text-destructive/80" : "text-muted-foreground")}>{a.description}</span>
      )}
    </span>
  </DropdownMenuItem>
);
