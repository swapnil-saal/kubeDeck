import { useEffect, useState, useCallback } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import ResourceDetail from "@/pages/ResourceDetail";
import Settings from "@/pages/Settings";
import AiChatPage from "@/pages/AiChatPage";
import NotFound from "@/pages/not-found";
import { TerminalPanel } from "@/components/TerminalPanel";
import { KubectlPalette } from "@/components/KubectlPalette";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useAccent } from "@/hooks/use-accent";

function Routes() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/ai" component={AiChatPage} />
      <Route path="/resource/:type/:name" component={ResourceDetail} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppShell() {
  useAccent();
  const { context, namespace, terminalOpen, toggleTerminal } = useTerminalStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        toggleTerminal();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTerminal]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="flex-1 overflow-auto min-h-0">
        <WouterRouter hook={useHashLocation}>
          <Routes />
        </WouterRouter>
      </div>

      <TerminalPanel
        context={context}
        namespace={namespace}
        isOpen={terminalOpen}
        onToggle={toggleTerminal}
      />

      <KubectlPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <AppShell />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
