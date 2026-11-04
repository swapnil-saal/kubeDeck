import type { ReactNode } from "react";

/** One titled block in a settings section. */
export function SettingsCard({ title, description, actions, children }: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-start gap-3 border-b border-border/60 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
