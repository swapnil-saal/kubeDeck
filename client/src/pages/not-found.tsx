import { AlertCircle, ArrowLeft, Monitor } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="w-full max-w-md mx-4 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-destructive/10 border border-destructive/20 mb-6">
          <AlertCircle className="h-8 w-8 text-destructive" />
        </div>

        <h1 className="text-4xl font-bold text-foreground tracking-tight mb-2">404</h1>
        <p className="text-lg text-muted-foreground mb-8">
          This page doesn't exist or has been moved.
        </p>

        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <div className="mt-12 flex items-center justify-center gap-2 text-muted-foreground/60">
          <Monitor className="w-4 h-4" />
          <span className="text-xs font-mono font-bold tracking-[0.2em] uppercase">KubeDeck</span>
        </div>
      </div>
    </div>
  );
}
