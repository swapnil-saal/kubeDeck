import { type FC } from "react";
import { cn } from "@/lib/utils";

/**
 * KubeDeck AI mascot — friendly robot with headset mic.
 * Black structure uses `currentColor`; accents use the cyan brand tone from the source art.
 */
export const AiAvatar: FC<{
  className?: string;
  /** Optional pixel size (sets width & height). Prefer className `h-* w-*`. */
  size?: number;
  title?: string;
}> = ({ className, size, title = "KubeDeck AI" }) => {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn("shrink-0 text-foreground", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* Antenna */}
      <line
        x1="32"
        y1="4"
        x2="32"
        y2="12"
        stroke="currentColor"
        strokeWidth="3.25"
        strokeLinecap="round"
      />
      <circle
        cx="32"
        cy="4"
        r="2.75"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
      />

      {/* Ears */}
      <path
        d="M13 28c-3.5 0-5.5 3-5.5 6s2 6 5.5 6"
        stroke="currentColor"
        strokeWidth="3.25"
        strokeLinecap="round"
      />
      <path
        d="M51 28c3.5 0 5.5 3 5.5 6s-2 6-5.5 6"
        stroke="currentColor"
        strokeWidth="3.25"
        strokeLinecap="round"
      />

      {/* Head */}
      <rect
        x="13"
        y="12"
        width="38"
        height="38"
        rx="11"
        stroke="currentColor"
        strokeWidth="3.5"
      />

      {/* Eyes */}
      <circle cx="24.5" cy="27" r="3.6" fill="hsl(var(--primary))" />
      <circle cx="39.5" cy="27" r="3.6" fill="hsl(var(--primary))" />

      {/* Smile */}
      <path
        d="M25 36.5c2.2 3.2 11.8 3.2 14 0"
        stroke="hsl(var(--primary))"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Mic boom */}
      <path
        d="M15.5 48.5C15.5 54 18 56.5 24 56.5H28"
        stroke="currentColor"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Mic capsule */}
      <rect
        x="26"
        y="53.5"
        width="12"
        height="6"
        rx="3"
        fill="hsl(var(--primary))"
      />
    </svg>
  );
};

/**
 * Circular chip wrapping the mascot — for headers and message rows.
 */
export const AiAvatarChip: FC<{
  className?: string;
  iconClassName?: string;
  size?: "sm" | "md" | "lg";
}> = ({ className, iconClassName, size = "md" }) => {
  const box =
    size === "sm"
      ? "h-8 w-8 rounded-xl"
      : size === "lg"
        ? "h-14 w-14 rounded-2xl"
        : "h-9 w-9 rounded-xl";
  const icon =
    size === "sm"
      ? "h-5 w-5"
      : size === "lg"
        ? "h-9 w-9"
        : "h-6 w-6";

  return (
    <div
      className={cn(
        "relative flex items-center justify-center shrink-0",
        "bg-card border border-border",
        box,
        className,
      )}
    >
      <AiAvatar className={cn(icon, iconClassName)} />
    </div>
  );
};
