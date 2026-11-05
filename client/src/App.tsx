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
import { AppSidebar } from "@/components/AppSidebar";
import { PortForwardBar } from "@/components/PortForwardBar";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useAppHashLocation, useAppHashSearch } from "@/lib/hash-router";
import { useAlertWatcher } from "@/hooks/use-alerts";
import { useServerMode } from "@/hooks/use-server-mode";
import { alertHref, setToastHandler } from "@/lib/alert-store";
import { toast } from "@/hooks/use-toast";
import { useApplyPalette } from "@/lib/themes";

/** framer-motion's animation engine arrives after first paint (see lib/motion-features.ts). */
const loadMotionFeatures = () => import("@/lib/motion-features").then((m) => m.default);

// The overview is the landing page and loads with the app; everything else loads when first used.
const ResourceList = lazy(() => import("@/pages/ResourceList"));
const ApiBrowser = lazy(() => import("@/pages/ApiBrowser"));
const MapPage = lazy(() => import("@/pages/MapPage"));
const ProjectsPage = lazy(() => import("@/pages/projects/ProjectsPage"));
const ProjectPage = lazy(() => import("@/pages/projects/ProjectPage"));
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
      <Route path="/map" component={MapPage} />
      <Route path="/projects" component={ProjectsPage} />
      <Route path="/projects/:id" component={ProjectPage} />
      <Route path="/resources" component={ApiBrowser} />
      <Route path="/resources/:kind" component={ResourceList} />
      <Route path="/resource/:type/:name" component={ResourceDetail} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useApplyPalette();
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
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    // Custom hash location keeps the query inside the hash only
    <WouterRouter hook={useAppHashLocation as never} searchHook={useAppHashSearch as never}>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <Suspense fallback={<PageLoading />}>
              <Routes />
            </Suspense>
          </div>

          <PortForwardBar />
        </div>

        {/* mounted only while open: its resource queries do not run in the background */}
        {paletteOpen && (
          <Suspense fallback={null}>
            <KubectlPalette open onClose={closePalette} />
          </Suspense>
        )}
      </div>
    </WouterRouter>
  );
}

function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
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
