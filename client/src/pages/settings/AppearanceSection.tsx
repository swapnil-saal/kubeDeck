import type { FC } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { PALETTES, usePalettes, type Palette, type ThemeMode } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { SettingsCard } from "./SettingsCard";

const MODES = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const;

/**
 * A miniature of the app drawn with the palette's real tokens: the element carries the
 * palette's mode class and `data-palette`, so every colour below comes from themes.css.
 */
const PalettePreview: FC<{ palette: Palette }> = ({ palette }) => (
  <div
    aria-hidden
    className={cn(palette.mode, "flex h-24 overflow-hidden rounded-lg border border-border bg-background")}
    data-palette={palette.id}
  >
    <div className="flex w-9 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-card pt-2">
      <span className="h-2 w-4 rounded-sm bg-primary" />
      <span className="h-1.5 w-4 rounded-sm bg-muted-foreground/40" />
      <span className="h-1.5 w-4 rounded-sm bg-muted-foreground/40" />
      <span className="h-1.5 w-4 rounded-sm bg-muted-foreground/40" />
    </div>
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-5 items-center gap-1 border-b border-border bg-card px-2">
        <span className="h-1.5 w-8 rounded-sm bg-foreground/70" />
        <span className="ml-auto h-2.5 w-6 rounded-full bg-secondary" />
      </div>
      <div className="flex-1 space-y-1.5 p-2">
        <div className="space-y-1 rounded-md border border-border bg-card p-1.5">
          <span className="block h-1.5 w-3/4 rounded-sm bg-foreground/80" />
          <span className="block h-1.5 w-1/2 rounded-sm bg-muted-foreground/50" />
        </div>
        <div className="flex items-center gap-1">
          <span className="h-3 w-8 rounded bg-primary" />
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="h-2 w-2 rounded-full bg-warning" />
          <span className="h-2 w-2 rounded-full bg-destructive" />
        </div>
      </div>
    </div>
  </div>
);

const PaletteGrid: FC<{ mode: ThemeMode; selected: string; onSelect: (id: string) => void }> = ({ mode, selected, onSelect }) => (
  <div role="radiogroup" aria-label={`${mode === "dark" ? "Dark" : "Light"} palette`} className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
    {PALETTES.filter((p) => p.mode === mode).map((p) => {
      const on = p.id === selected;
      return (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={on}
          onClick={() => onSelect(p.id)}
          className={cn(
            "group rounded-xl border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            on ? "border-primary bg-primary/[0.06] ring-1 ring-primary/40" : "border-border hover:border-primary/40",
          )}
        >
          <PalettePreview palette={p} />
          <span className="mt-2 flex items-center gap-1.5 px-0.5 text-[13px] font-semibold text-foreground">
            {p.label}
            {on && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
          </span>
          <span className="block px-0.5 text-[11px] leading-snug text-muted-foreground">{p.description}</span>
        </button>
      );
    })}
  </div>
);

/** Mode and colour palettes. Stored in this browser only (localStorage). */
export function AppearanceSection() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const palettes = usePalettes();
  const current = (theme ?? "dark") as (typeof MODES)[number]["id"];

  return (
    <div className="space-y-6">
      <SettingsCard title="Mode" description="Light, dark, or follow your operating system. The sun/moon button in the header switches quickly.">
        <div role="radiogroup" aria-label="Colour mode" className="inline-flex rounded-xl border border-border bg-muted/50 p-1">
          {MODES.map(({ id, label, icon: Icon }) => {
            const on = current === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setTheme(id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                  on ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
        {current === "system" && (
          <p className="mt-2 text-xs text-muted-foreground">Your system is in {resolvedTheme} mode right now.</p>
        )}
      </SettingsCard>

      <SettingsCard title="Dark palette" description="Used whenever KubeDeck is dark.">
        <PaletteGrid mode="dark" selected={palettes.dark} onSelect={(id) => palettes.choose("dark", id)} />
      </SettingsCard>

      <SettingsCard title="Light palette" description="Used whenever KubeDeck is light.">
        <PaletteGrid mode="light" selected={palettes.light} onSelect={(id) => palettes.choose("light", id)} />
      </SettingsCard>

      <p className="px-1 text-xs text-muted-foreground">Appearance is saved in this browser only.</p>
    </div>
  );
}
