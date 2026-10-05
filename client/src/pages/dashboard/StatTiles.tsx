import type { ComponentType, FC } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type TileState = "loading" | "forbidden" | "offline" | "error" | "ok";
export type TileTone = "good" | "warn" | "bad" | "neutral";

export interface Tile {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  state: TileState;
  value: string;
  /** one line under the value, e.g. "2 failing" */
  sub?: string;
  tone?: TileTone;
  /** makes the tile a button (jump to the matching list) */
  onClick?: () => void;
  hint?: string;
}

const TONE: Record<TileTone, string> = {
  good: "text-emerald-500",
  warn: "text-amber-500",
  bad: "text-destructive",
  neutral: "text-muted-foreground",
};

/** Status tiles: what is the state of each thing, not just how many there are. */
export const StatTiles: FC<{ tiles: Tile[] }> = ({ tiles }) => (
  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
    {tiles.map((t) => {
      const body = (
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            t.state === "forbidden" ? "bg-muted text-muted-foreground" : t.tone === "bad" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
          )}>
            {t.state === "forbidden" ? <Lock className="h-4 w-4" /> : <t.icon className="h-[18px] w-[18px]" />}
          </div>
          <div className="min-w-0 text-left">
            <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t.label}</p>
            {t.state === "loading" && <p className="text-2xl font-bold leading-tight text-muted-foreground/50">···</p>}
            {t.state === "forbidden" && <p className="text-sm font-medium leading-tight text-muted-foreground">No access</p>}
            {t.state === "offline" && <p className="text-sm font-medium leading-tight text-destructive">Offline</p>}
            {t.state === "error" && <p className="text-sm font-medium leading-tight text-destructive">Unavailable</p>}
            {t.state === "ok" && (
              <>
                <p className="text-2xl font-bold tabular-nums leading-tight tracking-tight text-foreground">{t.value}</p>
                {t.sub && <p className={cn("truncate text-[11px] font-medium", TONE[t.tone ?? "neutral"])}>{t.sub}</p>}
              </>
            )}
          </div>
        </div>
      );
      const cls = cn(
        "rounded-xl border bg-card/50 shadow-sm transition-colors",
        t.state === "forbidden" ? "border-border/50 bg-muted/30" : t.state === "error" || t.state === "offline" ? "border-destructive/20 bg-destructive/5" : "border-border/60",
        t.onClick && t.state === "ok" && "hover:border-primary/40 hover:bg-card",
      );
      return t.onClick && t.state === "ok" ? (
        <button key={t.key} type="button" onClick={t.onClick} title={t.hint} className={cn(cls, "text-left")}>{body}</button>
      ) : (
        <div key={t.key} className={cls} title={t.hint}>{body}</div>
      );
    })}
  </div>
);
