import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

/** Dark ⇄ light switch. Theme state lives in next-themes (`kubedeck-theme`). */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "flex items-center justify-center h-8 w-8 rounded-full border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/10 transition-colors",
        className,
      )}
      title={label}
      aria-label={label}
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
