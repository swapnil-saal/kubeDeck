import { useId, useInsertionEffect, type FC } from "react";
import { cn } from "@/lib/utils";

/**
 * KubeDeck AI mascot. Same dark tile as the app icon; its two eyes are the logo's
 * letters — a white "K" and a cyan "D" — with a cyan smile and an antenna that signals.
 *
 * It has a state for each moment of an agent turn. Every state has a still cue (antenna
 * colour, mouth shape) as well as motion, so it reads correctly with reduced motion too.
 */
export type AiAvatarState =
  | "idle" //       blinks, glances around, antenna breathes
  | "thinking" //   letters glow in turn, eyes scan, cyan ring pulses
  | "working" //    running a tool: a scan line sweeps the face, eyes focus down
  | "waiting" //    needs the user (approval / question): amber antenna, head tilts, eyes look up
  | "answering" //  writing the reply: the mouth talks
  | "error" //      something failed: red antenna, zig-zag mouth, one shake
  | "done" //       finished: green antenna, happy eyes, one hop
  | "offline"; //   AI not configured / unavailable: dimmed and still

const STATE_LABEL: Record<AiAvatarState, string> = {
  idle: "ready",
  thinking: "thinking",
  working: "running a tool",
  waiting: "waiting for you",
  answering: "answering",
  error: "something went wrong",
  done: "done",
  offline: "offline",
};

const STYLE_ID = "kd-bot-styles";
const STYLES = `
.kd-bot{--kd-accent:hsl(var(--primary));overflow:visible}
.kd-bot.kd-waiting{--kd-accent:hsl(var(--warning))}
.kd-bot.kd-error{--kd-accent:hsl(var(--destructive))}
.kd-bot.kd-done{--kd-accent:hsl(var(--success))}
.kd-bot.kd-offline{--kd-accent:hsl(var(--muted-foreground))}
.kd-bot .kd-accent-fill{fill:var(--kd-accent);transition:fill .3s}
.kd-bot .kd-accent-stroke{stroke:var(--kd-accent);transition:stroke .3s}
.kd-bot .kd-head,.kd-bot .kd-eye,.kd-bot .kd-antenna,.kd-bot .kd-smile,.kd-bot .kd-eyes{transform-box:fill-box;transform-origin:center}
.kd-bot .kd-head{transform-origin:50% 100%}
.kd-bot .kd-ring,.kd-bot .kd-zig,.kd-bot .kd-scanline{opacity:0}

/* idle */
.kd-bot .kd-eye{animation:kd-blink 5.6s infinite}
.kd-bot .kd-eye-d{animation-delay:.06s}
.kd-bot .kd-look{animation:kd-look 7.5s ease-in-out infinite}
.kd-bot .kd-antenna{animation:kd-pulse 2.6s ease-in-out infinite}
.kd-bot .kd-smile{animation:kd-smile 5.6s ease-in-out infinite}

/* thinking */
.kd-bot.kd-thinking .kd-ring{animation:kd-ring 1.3s ease-in-out infinite}
.kd-bot.kd-thinking .kd-look{animation:kd-scan 1.8s ease-in-out infinite}
.kd-bot.kd-thinking .kd-letter{animation:kd-glow .9s ease-in-out infinite alternate}
.kd-bot.kd-thinking .kd-letter-d{animation-delay:.45s}
.kd-bot.kd-thinking .kd-antenna{animation:kd-ping .8s ease-in-out infinite}

/* working */
.kd-bot.kd-working .kd-scanline{opacity:1;animation:kd-sweep 1.2s cubic-bezier(.45,0,.55,1) infinite}
.kd-bot.kd-working .kd-eyes{transform:translateY(1.2px)}
.kd-bot.kd-working .kd-look{animation:none}
.kd-bot.kd-working .kd-antenna{animation:kd-blinkfast .5s steps(2,end) infinite}
.kd-bot.kd-working .kd-ring{opacity:.35}

/* waiting */
.kd-bot.kd-waiting .kd-head{animation:kd-tilt 2.4s ease-in-out infinite}
.kd-bot.kd-waiting .kd-eyes{transform:translate(1px,-1.6px)}
.kd-bot.kd-waiting .kd-look{animation:none}
.kd-bot.kd-waiting .kd-antenna{animation:kd-ping 1.6s ease-in-out infinite}
.kd-bot.kd-waiting .kd-ring{animation:kd-ring 1.6s ease-in-out infinite}

/* answering */
.kd-bot.kd-answering .kd-smile{transform:scale(.95,1.35);animation:kd-talk .32s ease-in-out infinite alternate}
.kd-bot.kd-answering .kd-antenna{animation:kd-pulse 1.2s ease-in-out infinite}

/* error */
.kd-bot.kd-error .kd-smile{opacity:0;animation:none}
.kd-bot.kd-error .kd-zig{opacity:1}
.kd-bot.kd-error .kd-eye{animation:none;transform:scaleY(.72)}
.kd-bot.kd-error .kd-look{animation:none}
.kd-bot.kd-error .kd-head{animation:kd-shake .5s ease-in-out 1}
.kd-bot.kd-error .kd-antenna{animation:none}

/* done */
.kd-bot.kd-done .kd-eye{animation:none;transform:scaleY(.55)}
.kd-bot.kd-done .kd-look{animation:none}
.kd-bot.kd-done .kd-smile{animation:none;transform:scale(1.22,1.3)}
.kd-bot.kd-done .kd-head{animation:kd-hop .6s cubic-bezier(.3,1.6,.6,1) 1}
.kd-bot.kd-done .kd-antenna{animation:none}

/* offline */
.kd-bot.kd-offline .kd-letter,.kd-bot.kd-offline .kd-smile{opacity:.35}
.kd-bot.kd-offline *{animation:none!important}

/* still mascot (animated={false}) */
.kd-bot.kd-still *{animation:none!important}

@keyframes kd-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes kd-look{0%,38%,62%,100%{transform:translateX(0)}44%,56%{transform:translateX(-1.6px)}}
@keyframes kd-scan{0%,100%{transform:translateX(-1.8px)}50%{transform:translateX(1.8px)}}
@keyframes kd-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
@keyframes kd-ping{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(1.6)}}
@keyframes kd-blinkfast{0%{opacity:1}100%{opacity:.25}}
@keyframes kd-smile{0%,88%,100%{transform:scaleX(1)}94%{transform:scaleX(1.18)}}
@keyframes kd-talk{from{transform:scale(1,.55)}to{transform:scale(.92,1.45)}}
@keyframes kd-glow{from{opacity:.5}to{opacity:1}}
@keyframes kd-ring{0%,100%{opacity:.15}50%{opacity:.9}}
@keyframes kd-sweep{0%{transform:translateY(0);opacity:0}15%,85%{opacity:.9}100%{transform:translateY(44px);opacity:0}}
@keyframes kd-tilt{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
@keyframes kd-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-2.5px)}40%,80%{transform:translateX(2.5px)}}
@keyframes kd-hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-4px)}}
@media (prefers-reduced-motion:reduce){.kd-bot *{animation:none!important;transition:none!important}}
`;

/** The mascot's styles go in the document once, not once per avatar on the page. */
function useMascotStyles() {
  useInsertionEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
  }, []);
}

const CYAN = "hsl(var(--primary))";

export interface AiAvatarProps {
  className?: string;
  /** Optional pixel size (sets width & height). Prefer className `h-* w-*`. */
  size?: number;
  /** Accessible name; the state is appended ("KubeDeck AI, thinking"). */
  title?: string;
  state?: AiAvatarState;
  /** Shorthand for `state="thinking"` (kept for existing callers). */
  thinking?: boolean;
  /** false = no motion at all (state colours and mouth still apply). */
  animated?: boolean;
}

export const AiAvatar: FC<AiAvatarProps> = ({
  className, size, title = "KubeDeck AI", state, thinking = false, animated = true,
}) => {
  useMascotStyles();
  const clipId = `kd-face-${useId().replace(/:/g, "")}`;
  const current: AiAvatarState = state ?? (thinking ? "thinking" : "idle");
  const label = current === "idle" ? title : `${title}, ${STATE_LABEL[current]}`;

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn("kd-bot shrink-0", `kd-${current}`, !animated && "kd-still", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={label}
      data-state={current}
    >
      <title>{label}</title>
      <defs>
        <clipPath id={clipId}>
          <rect x="2.5" y="11" width="59" height="51" rx="16" />
        </clipPath>
      </defs>

      <g className="kd-head">
        {/* Antenna */}
        <path d="M32 11V6.5" stroke="hsl(var(--foreground))" strokeWidth="2.6" strokeLinecap="round" />
        <circle className="kd-antenna kd-accent-fill" cx="32" cy="4.2" r="3" />

        {/* Face tile (same dark tile as the app icon) */}
        <rect x="2.5" y="11" width="59" height="51" rx="16" fill="#0A0A0A" stroke="#F5F5F5" strokeOpacity=".22" strokeWidth="1.6" />
        <rect className="kd-ring kd-accent-stroke" x="2.5" y="11" width="59" height="51" rx="16" strokeWidth="2.4" />

        {/* Scan line (working): sweeps from the top of the face to the bottom */}
        <g clipPath={`url(#${clipId})`}>
          <rect className="kd-scanline" x="2.5" y="13" width="59" height="3" rx="1.5" fill={CYAN} opacity=".9" />
        </g>

        {/* Eyes: K (white) and D (cyan) */}
        <g className="kd-eyes">
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
        </g>

        {/* Mouth: smile, or a zig-zag when something went wrong */}
        <path className="kd-smile" d="M25 51.5Q32 56.5 39 51.5" stroke={CYAN} strokeWidth="3.4" strokeLinecap="round" />
        <path
          className="kd-zig kd-accent-stroke"
          d="M24 53l3-2.6 3 2.6 3-2.6 3 2.6 3-2.6 3 2.6"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
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
  state?: AiAvatarState;
  /** Shorthand for `state="thinking"`. */
  thinking?: boolean;
}> = ({ className, iconClassName, size = "md", state, thinking }) => {
  const box = size === "sm" ? "h-9 w-9" : size === "lg" ? "h-16 w-16" : "h-10 w-10";

  return (
    <div className={cn("relative flex items-center justify-center shrink-0", box, className)}>
      <AiAvatar className={cn("h-full w-full", iconClassName)} state={state} thinking={thinking} />
    </div>
  );
};
