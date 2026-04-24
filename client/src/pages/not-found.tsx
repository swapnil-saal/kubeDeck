import { AlertCircle, ArrowLeft, Box } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="card-elevated max-w-md mx-4 p-10 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6">
          <AlertCircle className="h-8 w-8 text-primary" />
        </div>

        <h1 className="text-5xl font-bold text-foreground tracking-tight mb-2">404</h1>
        <p className="text-base text-muted-foreground mb-8">
          This page doesn't exist or has been moved.
        </p>

        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <div className="mt-10 flex items-center justify-center gap-2 text-muted-foreground/50">
          <Box className="w-4 h-4" />
          <span className="text-xs font-semibold tracking-tight">KubeDeck</span>
        </div>
      </div>
    </div>
  );
}
