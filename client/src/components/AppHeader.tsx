import { type ReactNode, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ChevronRight, LogOut, SquareTerminal } from "lucide-react";
import { useScope } from "@/hooks/use-scope";
import { useK8sContexts } from "@/hooks/use-k8s";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AlertBell } from "@/components/header/AlertBell";
import { MODE_KEY, useServerMode } from "@/hooks/use-server-mode";
import { signOut } from "@/hooks/use-admin";
import { ScopeSwitcher } from "@/components/header/ScopeSwitcher";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  breadcrumbs?: Breadcrumb[];
  /** page-specific actions, shown after the global ones (refresh, live indicator, …) */
  rightSlot?: ReactNode;
  showSelectors?: boolean;
}

export interface Breadcrumb {
  label: string;
  /** omitted for the current page */
  href?: string;
}

/**
 * The bar above every page: where you are (breadcrumbs), the scope every command runs in,
 * and the global tools. Navigation lives in the sidebar.
 */
export function AppHeader({ breadcrumbs = [], rightSlot, showSelectors = true }: AppHeaderProps) {
  const [, navigate] = useLocation();
  const { context: currentContext, setContext } = useScope();
  const { data: contexts } = useK8sContexts();
  const serverMode = useServerMode();

  useEffect(() => {
    if (currentContext) return;
    if (!contexts || contexts.length === 0) return;
    const initial = contexts.find((c) => c.isCurrent) ?? contexts[0];
    if (initial) setContext(initial.name);
  }, [contexts, currentContext, setContext]);

  return (
    <header className="app-header relative z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-3 sm:px-4">
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center">
        <ol className="flex min-w-0 items-center">
          {breadcrumbs.map((crumb, i) => {
            const last = i === breadcrumbs.length - 1;
            return (
              <li key={`${i}-${crumb.label}`} className={cn("flex items-center", last ? "min-w-0" : "shrink-0")}>
                {i > 0 && <ChevronRight className="mx-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden />}
                {crumb.href && !last ? (
                  <button
                    type="button"
                    onClick={() => navigate(crumb.href!)}
                    className="max-w-[14rem] truncate rounded px-1 py-0.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span aria-current={last ? "page" : undefined} className={cn("truncate px-1 text-[13px]", last ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {crumb.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {showSelectors && <ScopeSwitcher className="min-w-0 max-w-[22rem] shrink" />}

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-secondary/40 px-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-secondary hover:text-foreground lg:px-3"
          title="Run kubectl or describe what you want (⌘K)"
          aria-label="Open the kubectl command palette"
        >
          <SquareTerminal size={15} className="shrink-0 text-primary" />
          <span className="hidden xl:inline">Run kubectl…</span>
          <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium lg:inline">⌘K</kbd>
        </button>
        <AlertBell />
        {/* the desktop's local user never signs in, so it has no sign-out */}
        {serverMode.mode === "web" && serverMode.user && <SignedIn user={serverMode.user} />}
        <ThemeToggle className="h-9 w-9 rounded-lg" />
        {rightSlot}
      </div>
    </header>
  );
}

/** Who is signed in, and a way out. */
function SignedIn({ user }: { user: { name: string; email: string; groups?: string[]; role?: string } }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const groups = user.groups?.length ? user.groups.join(", ") : "no groups";
  const leave = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      qc.clear();
      await qc.invalidateQueries({ queryKey: MODE_KEY });
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={leave}
      disabled={busy}
      title={`Signed in as ${user.email}${user.role === "admin" ? " (admin)" : ""} · ${groups}. Click to sign out.`}
      aria-label="Sign out"
      className="flex h-9 items-center gap-2 rounded-lg border border-border bg-secondary/40 px-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-60"
    >
      <span className="hidden max-w-[10rem] truncate lg:inline">{user.name}</span>
      <LogOut size={14} className="shrink-0" />
    </button>
  );
}
