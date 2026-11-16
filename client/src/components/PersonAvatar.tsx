/** A person's initials in a circle whose colour comes from their email, and a row of them. */
import type * as React from "react";
import { cn } from "@/lib/utils";

const HUES = [190, 160, 260, 25, 330, 210, 95, 45];

function hueOf(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export function initialsOf(name: string, email = ""): string {
  const words = (name || email.split("@")[0]).split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

export function PersonAvatar({ name, email, size = "md", muted, className }: { name: string; email: string; size?: "sm" | "md" | "lg"; muted?: boolean; className?: string }) {
  const hue = hueOf(email || name);
  return (
    <span
      aria-hidden
      style={{ "--av-h": hue } as React.CSSProperties}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ring-2 ring-background",
        !muted && "bg-[hsl(var(--av-h)_70%_45%/0.16)] text-[hsl(var(--av-h)_65%_36%)] dark:bg-[hsl(var(--av-h)_60%_55%/0.2)] dark:text-[hsl(var(--av-h)_75%_75%)]",
        size === "sm" && "h-6 w-6 text-[10px]",
        size === "md" && "h-8 w-8 text-[11px]",
        size === "lg" && "h-11 w-11 text-sm",
        muted && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {initialsOf(name, email)}
    </span>
  );
}

/** Up to `max` overlapping avatars and "+n". */
export function AvatarStack({ people, max = 4 }: { people: { name: string; email: string }[]; max?: number }) {
  if (people.length === 0) return null;
  return (
    <span className="flex items-center -space-x-1" title={people.map((p) => p.name).join(", ")}>
      {people.slice(0, max).map((p) => <PersonAvatar key={p.email} name={p.name} email={p.email} size="sm" />)}
      {people.length > max && <span className="z-10 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-muted-foreground ring-2 ring-background">+{people.length - max}</span>}
    </span>
  );
}
