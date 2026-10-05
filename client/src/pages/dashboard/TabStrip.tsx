import { useCallback, useEffect, useRef, useState, type FC, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A horizontally scrolling tab strip that always starts at the first tab, fades and shows arrows on
 * the sides that have more, and keeps the active tab visible by scrolling only itself — never the page.
 */
export const TabStrip: FC<{ activeKey: string; children: ReactNode }> = ({ activeKey, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);

  // keep the selected tab in view (only when it is not already fully visible)
  useEffect(() => {
    const el = ref.current;
    const active = el?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!el || !active) return;
    const pad = 12;
    const left = active.offsetLeft - pad;
    const right = active.offsetLeft + active.offsetWidth + pad;
    if (left < el.scrollLeft) el.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    else if (right > el.scrollLeft + el.clientWidth) el.scrollTo({ left: right - el.clientWidth, behavior: "smooth" });
  }, [activeKey]);

  const scrollBy = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * Math.max(200, (ref.current?.clientWidth ?? 400) * 0.6), behavior: "smooth" });

  return (
    <div className="relative mb-5">
      <div ref={ref} onScroll={update} className="no-scrollbar relative overflow-x-auto overflow-y-hidden rounded-xl">
        {children}
      </div>
      {edge.left && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-12 rounded-l-xl bg-gradient-to-r from-background via-background/80 to-transparent" />
          <button type="button" onClick={() => scrollBy(-1)} aria-label="Scroll tabs left" className="absolute left-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
        </>
      )}
      {edge.right && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-12 rounded-r-xl bg-gradient-to-l from-background via-background/80 to-transparent" />
          <button type="button" onClick={() => scrollBy(1)} aria-label="Scroll tabs right" className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
};
