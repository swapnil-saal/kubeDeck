import { type FC } from "react";
import { cn } from "@/lib/utils";

/**
 * KubeDeck wordmark — saai.-inspired two-tone mark:
 * - "kube" structural white
 * - "deck." brand cyan + geometric cut-block over "d"
 */
type LogoSize = "sm" | "md" | "lg" | "xl" | "2xl";

const sizeClass: Record<LogoSize, string> = {
  sm: "text-[15px] leading-none",
  md: "text-[18px] leading-none",
  lg: "text-[22px] leading-none",
  xl: "text-[28px] leading-none",
  "2xl": "text-[36px] leading-none",
};

export const KubeDeckLogo: FC<{
  className?: string;
  size?: LogoSize;
  withDot?: boolean;
  title?: string;
}> = ({ className, size = "lg", withDot = true, title = "KubeDeck" }) => {
  return (
    <span
      className={cn(
        "inline-flex items-baseline font-black lowercase tracking-[-0.05em] select-none",
        "font-sans",
        sizeClass[size],
        className,
      )}
      aria-label={title}
      role="img"
    >
      <span className="text-foreground">kube</span>
      <span className="text-primary relative inline-flex items-baseline">
        <span className="relative inline-block">
          d
          <span
            aria-hidden
            className="pointer-events-none absolute left-[48%] -translate-x-1/2 bg-foreground"
            style={{
              width: "0.34em",
              height: "0.38em",
              top: "-0.04em",
              clipPath: "polygon(0% 28%, 100% 0%, 100% 100%, 0% 100%)",
            }}
          />
        </span>
        <span>eck</span>
        {withDot && <span className="text-primary">.</span>}
      </span>
    </span>
  );
};

/**
 * App icon / favicon mark — pure geometry (reads at 16–1024px).
 * White "k" + cyan "d" shell + white cut-block + cyan period.
 */
export function KubeDeckMarkSvg({
  className,
  size,
}: {
  className?: string;
  size?: number | string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn("shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="64" height="64" rx="14" fill="#0A0A0A" />
      {/* k — left stem + two arms */}
      <path
        fill="#F5F5F5"
        d="M14 16h7.2v14.4l8.4-8.4h8.6l-10.2 10 11 14h-8.8l-8.4-11.2H21.2V48H14V16z"
      />
      {/* d — cyan bowl + stem */}
      <path
        fill="#4FD1D9"
        d="M36 26h6.2c6.6 0 11 3.8 11 11s-4.4 11-11 11H36V26zm6.6 5.2v11.6h-0.2c2.8 0 4.6-1.6 4.6-5.8s-1.8-5.8-4.4-5.8h0z"
      />
      {/* geometric tittle (saai-style block) */}
      <path fill="#F5F5F5" d="M39.5 12 48 9.2V20.5H39.5z" />
      {/* period */}
      <circle cx="55" cy="45" r="3.2" fill="#4FD1D9" />
    </svg>
  );
}

export const KubeDeckMark: FC<{
  className?: string;
  size?: number;
}> = ({ className, size = 36 }) => (
  <KubeDeckMarkSvg className={className} size={size} />
);
