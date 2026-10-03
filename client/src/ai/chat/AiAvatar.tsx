import { type FC } from "react";
import { cn } from "@/lib/utils";

/**
 * KubeDeck AI mascot. Same dark tile as the app icon; its two eyes are the logo's
 * letters — a white "K" and a cyan "D" — with the logo's cyan colour as the smile.
 *
 * Animated: it blinks, glances around now and then, and its antenna pulses. While
 * `thinking` the letters glow in turn and the tile gets a cyan ring. Honours
 * `prefers-reduced-motion`.
 */
const STYLES = `
.kd-bot .kd-eye{transform-box:fill-box;transform-origin:center;animation:kd-blink 5.6s infinite}
.kd-bot .kd-eye-d{animation-delay:.06s}
.kd-bot .kd-look{animation:kd-look 7.5s ease-in-out infinite}
.kd-bot .kd-antenna{transform-box:fill-box;transform-origin:center;animation:kd-pulse 2.6s ease-in-out infinite}
.kd-bot .kd-smile{transform-box:fill-box;transform-origin:center;animation:kd-smile 5.6s ease-in-out infinite}
.kd-bot .kd-ring{opacity:0}
.kd-bot.kd-thinking .kd-ring{animation:kd-ring 1.3s ease-in-out infinite}
.kd-bot.kd-thinking .kd-look{animation:kd-scan 1.8s ease-in-out infinite}
.kd-bot.kd-thinking .kd-letter{animation:kd-glow .9s ease-in-out infinite alternate}
.kd-bot.kd-thinking .kd-letter-d{animation-delay:.45s}
.kd-bot.kd-thinking .kd-antenna{animation:kd-ping .8s ease-in-out infinite}
@keyframes kd-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes kd-look{0%,38%,62%,100%{transform:translateX(0)}44%,56%{transform:translateX(-1.6px)}}
@keyframes kd-scan{0%,100%{transform:translateX(-1.8px)}50%{transform:translateX(1.8px)}}
@keyframes kd-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
@keyframes kd-ping{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(1.6)}}
@keyframes kd-smile{0%,88%,100%{transform:scaleX(1)}94%{transform:scaleX(1.18)}}
@keyframes kd-glow{from{opacity:.5}to{opacity:1}}
@keyframes kd-ring{0%,100%{opacity:.15}50%{opacity:.9}}
@media (prefers-reduced-motion:reduce){.kd-bot *{animation:none!important}}
`;

const CYAN = "hsl(var(--primary))";

export const AiAvatar: FC<{
  className?: string;
  /** Optional pixel size (sets width & height). Prefer className `h-* w-*`. */
  size?: number;
  title?: string;
  /** Idle animation (blink, glance, antenna). On by default. */
  animated?: boolean;
  /** "Working" animation: letters glow in turn, eyes scan, cyan ring. */
  thinking?: boolean;
}> = ({ className, size, title = "KubeDeck AI", animated = true, thinking = false }) => {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn(
        "kd-bot shrink-0",
        !animated && !thinking && "[&_*]:!animate-none",
        thinking && "kd-thinking",
        className,
      )}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <style>{STYLES}</style>

      {/* Antenna */}
      <path d="M32 11V6.5" stroke="hsl(var(--foreground))" strokeWidth="2.6" strokeLinecap="round" />
      <circle className="kd-antenna" cx="32" cy="4.2" r="3" fill={CYAN} />

      {/* Face tile (same dark tile as the app icon) */}
      <rect x="2.5" y="11" width="59" height="51" rx="16" fill="#0A0A0A" stroke="#F5F5F5" strokeOpacity=".22" strokeWidth="1.6" />
      <rect className="kd-ring" x="2.5" y="11" width="59" height="51" rx="16" stroke={CYAN} strokeWidth="2.4" />

      {/* Eyes: K (white) and D (cyan) */}
      <g className="kd-look">
        <g className="kd-eye kd-eye-k">
          <g className="kd-letter kd-letter-k" stroke="#F5F5F5" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 21V41" />
            <path d="M30 21L15.5 31.5" />
            <path d="M20.5 28L30.5 41" />
          </g>
        </g>
        <g className="kd-eye kd-eye-d">
          <g className="kd-letter kd-letter-d" stroke={CYAN} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M37 21V41" />
            <path d="M37 21H43C49.5 21 52.5 25.5 52.5 31S49.5 41 43 41H37" />
          </g>
        </g>
      </g>

      {/* Smile */}
      <path className="kd-smile" d="M25 51.5Q32 56.5 39 51.5" stroke={CYAN} strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
};

/**
 * Sized wrapper for the mascot — for headers and message rows. The mascot brings
 * its own tile, so the wrapper adds no background.
 */
export const AiAvatarChip: FC<{
  className?: string;
  iconClassName?: string;
  size?: "sm" | "md" | "lg";
  thinking?: boolean;
}> = ({ className, iconClassName, size = "md", thinking }) => {
  const box = size === "sm" ? "h-9 w-9" : size === "lg" ? "h-16 w-16" : "h-10 w-10";

  return (
    <div className={cn("relative flex items-center justify-center shrink-0", box, className)}>
      <AiAvatar className={cn("h-full w-full", iconClassName)} thinking={thinking} />
    </div>
  );
};
