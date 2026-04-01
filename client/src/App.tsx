import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import ResourceDetail from "@/pages/ResourceDetail";
import NotFound from "@/pages/not-found";
import { TerminalPanel } from "@/components/TerminalPanel";
import { useTerminalStore } from "@/hooks/use-terminal-store";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/resource/:type/:name" component={ResourceDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppShell() {
  const { context, namespace, terminalOpen, toggleTerminal } = useTerminalStore();

  // Global keyboard shortcut: Ctrl+` to toggle terminal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        toggleTerminal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTerminal]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Page content fills remaining space above terminal */}
      <div className="flex-1 overflow-auto min-h-0">
        <Router />
      </div>

      {/* Terminal available on every page */}
      <TerminalPanel
        context={context}
        namespace={namespace}
        isOpen={terminalOpen}
        onToggle={toggleTerminal}
      />
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
