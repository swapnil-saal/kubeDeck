import { lazy, Suspense, useEffect, useState, useCallback } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { LazyMotion, MotionConfig } from "framer-motion";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import Dashboard from "@/pages/Dashboard";
import { AiChatPage } from "@/ai";
import { TerminalPanel } from "@/components/TerminalPanel";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useAppHashLocation, useAppHashSearch } from "@/lib/hash-router";
import { useAlertWatcher } from "@/hooks/use-alerts";
import { useServerMode } from "@/hooks/use-server-mode";
import { alertHref, setToastHandler } from "@/lib/alert-store";
import { toast } from "@/hooks/use-toast";

/** framer-motion's animation engine arrives after first paint (see lib/motion-features.ts). */
const loadMotionFeatures = () => import("@/lib/motion-features").then((m) => m.default);

// The overview is the landing page and loads with the app; everything else loads when first used.
const ResourceDetail = lazy(() => import("@/pages/ResourceDetail"));
const Settings = lazy(() => import("@/pages/Settings"));
const NotFound = lazy(() => import("@/pages/not-found"));
const KubectlPalette = lazy(() => import("@/components/KubectlPalette").then((m) => ({ default: m.KubectlPalette })));

function PageLoading() {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground" role="status" aria-label="Loading">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

function Routes() {
  const { aiEnabled } = useServerMode();
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      {aiEnabled && <Route path="/ai" component={AiChatPage} />}
      <Route path="/resource/:type/:name" component={ResourceDetail} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppShell() {
  const { context, namespace, terminalOpen, toggleTerminal } = useTerminalStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const serverMode = useServerMode();
  const terminalAllowed = serverMode.features.terminal;

  // new failures in the selected namespace: bell + desktop notification (+ a toast when the window is in front)
  useAlertWatcher();
  useEffect(() => {
    setToastHandler((a) =>
      toast({
        title: a.title,
        description: a.body,
        variant: a.severity === "critical" ? "destructive" : "default",
        onClick: () => { window.location.hash = alertHref(a); },
      } as Parameters<typeof toast>[0]),
    );
    return () => setToastHandler(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`" && terminalAllowed) {
        e.preventDefault();
        toggleTerminal();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTerminal, terminalAllowed]);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <div className="flex-1 overflow-hidden min-h-0 relative flex flex-col">
        <WouterRouter
          // Custom hash location keeps query inside the hash only
          hook={useAppHashLocation as never}
          searchHook={useAppHashSearch as never}
        >
          <Suspense fallback={<PageLoading />}>
            <Routes />
          </Suspense>
        </WouterRouter>
      </div>

      {terminalAllowed && (
        <TerminalPanel
          context={context}
          namespace={namespace}
          isOpen={terminalOpen}
          onToggle={toggleTerminal}
        />
      )}

      {/* mounted only while open: its resource queries do not run in the background */}
      {paletteOpen && (
        <Suspense fallback={null}>
          <KubectlPalette open onClose={closePalette} />
        </Suspense>
      )}
    </div>
  );
}

function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="kubedeck-theme"
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          {/* animations follow the OS "reduce motion" setting */}
          <LazyMotion features={loadMotionFeatures}>
            <MotionConfig reducedMotion="user">
              <AppShell />
            </MotionConfig>
          </LazyMotion>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
