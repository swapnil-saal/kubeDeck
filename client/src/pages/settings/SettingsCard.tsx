import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * One block in a settings section. The page header already names the section, so a card has a title
 * only when the page holds several kinds of thing (Mode, Dark palette…); without one it is a plain panel.
 */
export function SettingsCard({ title, description, actions, children, className }: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const header = title || description || actions;
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      {header && (
        <header className="flex flex-wrap items-start gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** Where the page header keeps its primary action; the settings shell provides it. */
export const PageActionSlot = createContext<HTMLElement | null>(null);

/**
 * A section's primary action ("Add user"), drawn in the page header next to the section's title.
 * Renders nothing outside the settings shell.
 */
export function PageAction({ children }: { children: ReactNode }) {
  const slot = useContext(PageActionSlot);
  return slot ? createPortal(children, slot) : null;
}
