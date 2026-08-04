import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { KubeDeckLogo, KubeDeckMark } from "@/components/KubeDeckLogo";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div className="h-full w-full flex items-center justify-center bg-background">
      <button
        onClick={() => navigate("/")}
        className="text-left p-8 rounded-2xl border border-border hover:border-primary/50 bg-card hover:bg-muted transition-colors duration-150 flex flex-col items-center justify-center gap-4 max-w-md mx-4 min-h-[240px]"
      >
        <KubeDeckMark size={56} />

        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Page not found</h1>
          <p className="text-xs text-muted-foreground">
            This route does not exist or has moved.
          </p>
        </div>

        <span className="inline-flex items-center gap-2 text-xs font-semibold text-primary bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full">
          <ArrowLeft size={13} />
          Back to Dashboard
        </span>

        <KubeDeckLogo size="sm" className="opacity-80" />
      </button>
    </div>
  );
}
