import {
  createContext, Fragment, memo, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type FC, type KeyboardEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useAuiState, type ToolApprovalResponse } from "@assistant-ui/react";
import { Ban, ChevronDown, ChevronLeft, ChevronRight, CircleSlash, HelpCircle, ShieldX, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApprovalPanel, lineCount, StepDetail } from "./StepDetail";
import { describeToolCall, resultAsText, toolState, TOOL_STATE_UI, type ToolCallLike, type ToolState } from "./tool-state";

/** Tools shown as trail steps. ask_human, present_dashboard and monitor_logs keep their own cards. */
export const STEP_TOOLS = [
  "kubectl", "bash", "k8s_list", "k8s_describe", "k8s_logs",
  "traces_stats", "traces_search", "trace_get", "logs_search", "grafana",
] as const;

import { CONNECTOR_W, NODE_H, ROW_GAP, TURN_W, trailLayout, trailRows } from "./trail-layout";

interface TrailContext {
  openId: string | null;
  toggle: (id: string) => void;
  close: () => void;
  /** 1-based step number in trail order */
  numberOf: (id: string) => number;
  slotOf: (id: string) => HTMLElement | null;
  detailOf: (id: string) => HTMLElement | null;
}

const Ctx = createContext<TrailContext | null>(null);

/** The width of an element, updated on resize only. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/**
 * DOM slots by key, kept in state so portals re-render once a slot exists.
 * `refFor(key)` returns the same callback for a key every time: a new callback per render
 * would make React detach and re-attach the ref on every commit and loop on setState.
 */
function useSlots<K extends string | number>() {
  const [slots, setSlots] = useState<Partial<Record<K, HTMLElement>>>({});
  const refFor = useMemo(() => {
    const cache = new Map<K, (el: HTMLElement | null) => void>();
    return (key: K) => {
      let ref = cache.get(key);
      if (!ref) {
        ref = (el: HTMLElement | null) =>
          setSlots((prev) => {
            if (el ? prev[key] === el : !(key in prev)) return prev;
            const next = { ...prev };
            if (el) next[key] = el;
            else delete next[key];
            return next;
          });
        cache.set(key, ref);
      }
      return ref;
    };
  }, []);
  return [slots, refFor] as const;
}

/** Arrow keys follow the trail (step 1 → 2 → 3), not the screen direction. */
function moveInTrailOrder(e: KeyboardEvent<HTMLDivElement>, count: number) {
  const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
  const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
  if (!forward && !back && e.key !== "Home" && e.key !== "End") return;
  const current = Number((document.activeElement as HTMLElement | null)?.dataset.stepNumber);
  if (!current) return;
  e.preventDefault();
  const next = e.key === "Home" ? 1 : e.key === "End" ? count : Math.min(count, Math.max(1, current + (forward ? 1 : -1)));
  e.currentTarget.querySelector<HTMLButtonElement>(`[data-step-number="${next}"]`)?.focus();
}

/** Line between two neighbouring steps, with a chevron in the direction the trail runs. */
const Connector: FC<{ reversed: boolean }> = ({ reversed }) => (
  <span aria-hidden className="flex shrink-0 items-center text-muted-foreground/70" style={{ width: CONNECTOR_W }}>
    <span className="h-px flex-1 bg-border" />
    {reversed ? <ChevronLeft className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
    <span className="h-px flex-1 bg-border" />
  </span>
);

/** Rounded U-turn from the end of one row down to the start of the next; stretches over an open detail panel. */
const Turn: FC<{ side: "left" | "right" }> = ({ side }) => {
  const style: CSSProperties = { top: NODE_H / 2, bottom: -NODE_H / 2, width: TURN_W, [side]: -TURN_W };
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "pointer-events-none absolute border-y border-border",
        side === "right" ? "rounded-r-xl border-r" : "rounded-l-xl border-l",
      )}
    >
      <ChevronDown
        className={cn(
          "absolute top-1/2 h-3 w-3 -translate-y-1/2 bg-background text-muted-foreground/70",
          side === "right" ? "-right-[6.5px]" : "-left-[6.5px]",
        )}
      />
    </span>
  );
};

/** One step per row (narrow column): a straight line down from the step number to the next step. */
const VerticalLink: FC = () => (
  <span
    aria-hidden
    className="pointer-events-none absolute w-px bg-border"
    style={{ left: 16, top: NODE_H, bottom: 0 }}
  >
    <ChevronDown className="absolute -left-[5.5px] bottom-0 h-3 w-3 bg-background text-muted-foreground/70" />
  </span>
);

/**
 * Consecutive commands the agent ran, as a serpentine trail: row 1 left→right, row 2 right→left…
 * Each step's details open under its own row; a step waiting for approval always shows its panel.
 * Layout depends only on the width and the number of steps, never on streaming tokens.
 */
export const ToolTimeline: FC<{ children: ReactNode; indices: readonly number[] }> = ({ children, indices }) => {
  const idsKey = useAuiState((s) =>
    indices
      .map((i) => (s.message.content[i] as { toolCallId?: string } | undefined)?.toolCallId ?? `part-${i}`)
      .join("|"),
  );
  const ids = useMemo(() => idsKey.split("|"), [idsKey]);
  const { ref, width } = useWidth<HTMLDivElement>();
  const { perRow, nodeW } = useMemo(() => trailLayout(width || 720), [width]);
  const rows = useMemo(() => trailRows(ids, perRow), [ids, perRow]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [slots, slotRef] = useSlots<string>();
  const [details, detailRef] = useSlots<number>();
  const toggle = useCallback((id: string) => setOpenId((cur) => (cur === id ? null : id)), []);
  const close = useCallback(() => setOpenId(null), []);

  const value = useMemo<TrailContext>(() => {
    const order = new Map(ids.map((id, i) => [id, i]));
    return {
      openId,
      toggle,
      close,
      numberOf: (id) => (order.get(id) ?? 0) + 1,
      slotOf: (id) => slots[id] ?? null,
      detailOf: (id) => {
        const i = order.get(id);
        return i === undefined ? null : details[Math.floor(i / perRow)] ?? null;
      },
    };
  }, [ids, openId, toggle, close, slots, details, perRow]);

  return (
    <Ctx.Provider value={value}>
      <div ref={ref} className="my-2">
        <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
          {ids.length} step{ids.length === 1 ? "" : "s"} · select one to see its output
        </p>
        <div
          role="group"
          aria-label="Commands the agent ran, in order"
          onKeyDown={(e) => moveInTrailOrder(e, ids.length)}
          style={{ paddingLeft: TURN_W, paddingRight: TURN_W }}
        >
          {rows.map((row, r) => {
            const vertical = perRow === 1;
            const reversed = !vertical && r % 2 === 1;
            const last = r === rows.length - 1;
            return (
              <div key={r} className="relative" style={{ paddingBottom: last ? 0 : ROW_GAP }}>
                <div className={cn("flex items-center", reversed && "flex-row-reverse")}>
                  {row.map((id, i) => (
                    <Fragment key={id}>
                      {i > 0 && <Connector reversed={reversed} />}
                      <div ref={slotRef(id)} className="shrink-0" style={{ width: nodeW, height: NODE_H }} />
                    </Fragment>
                  ))}
                </div>
                <div ref={detailRef(r)} className={cn("mt-2 flex flex-col gap-2 empty:hidden", vertical && "ml-8")} />
                {!last && (vertical ? <VerticalLink /> : <Turn side={reversed ? "left" : "right"} />)}
              </div>
            );
          })}
        </div>
        {/* each step renders into its slot and its row's detail area through portals */}
        {children}
      </div>
    </Ctx.Provider>
  );
};

/** Colour plus shape, so the state never depends on colour alone. */
const StateMark: FC<{ state: ToolState }> = ({ state }) => {
  const label = TOOL_STATE_UI[state].label;
  const icon = (node: ReactNode, tone: string) => (
    <span className={cn("shrink-0", tone)} title={label}>
      {node}
      <span className="sr-only">{label}</span>
    </span>
  );
  switch (state) {
    case "error":
      return icon(<XCircle className="h-3.5 w-3.5" />, "text-red-600 dark:text-red-400");
    case "blocked":
      return icon(<ShieldX className="h-3.5 w-3.5" />, "text-red-600 dark:text-red-400");
    case "denied":
      return icon(<CircleSlash className="h-3.5 w-3.5" />, "text-slate-500 dark:text-slate-300");
    case "stopped":
      return icon(<Ban className="h-3.5 w-3.5" />, "text-muted-foreground");
    case "question":
      return icon(<HelpCircle className="h-3.5 w-3.5" />, "text-amber-600 dark:text-amber-300");
    default: {
      const dot =
        state === "running" ? "bg-primary motion-safe:animate-pulse"
        : state === "approval" ? "bg-amber-500 motion-safe:animate-pulse"
        : "bg-emerald-500";
      return (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" title={label}>
          <span className={cn("h-2 w-2 rounded-full", dot)} />
          <span className="sr-only">{label}</span>
        </span>
      );
    }
  }
};

const KIND_SHORT: Record<string, string> = {
  deployment: "deploy", deployments: "deploy", statefulset: "sts", statefulsets: "sts", daemonset: "ds",
  daemonsets: "ds", service: "svc", services: "svc", configmap: "cm", configmaps: "cm", namespace: "ns",
  namespaces: "ns", ingress: "ing", ingresses: "ing", persistentvolumeclaim: "pvc", cronjob: "cj", cronjobs: "cj",
};
const kind = (k: unknown) => (typeof k === "string" ? KIND_SHORT[k.toLowerCase()] ?? k : "");
const word = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * A node's two lines: the action (`describe deploy`, `logs`, `get`) and what it acts on
 * (`api`, `api-1`, `pods -A`). Node width is fixed, so the name gets the room.
 */
export function stepLabel(toolName: string | undefined, args: unknown, command: string): { verb: string; target: string } {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  switch (toolName) {
    case "k8s_describe":
      return { verb: `describe ${kind(a.resource)}`.trim(), target: word(a.name) || "…" };
    case "k8s_logs":
      return { verb: a.previous ? "logs (previous)" : "logs", target: word(a.name) || "…" };
    case "k8s_list":
      return {
        verb: a.view === "summary" ? "summarize" : a.view === "names" ? "names of" : "get",
        target: [word(a.resource) || "…", word(a.name), a.allNamespaces ? "-A" : "", a.wide ? "-o wide" : ""].filter(Boolean).join(" "),
      };
    case "kubectl": {
      const [verb = "kubectl", ...rest] = command.trim().split(/\s+/);
      return { verb, target: rest.join(" ") || verb };
    }
    case "bash":
      return { verb: "shell", target: command || "…" };
    default:
      return observabilityStepLabel(toolName, a) ?? { verb: toolName ?? "tool", target: command || "…" };
  }
}

/** Node labels for the trace and Grafana tools. */
function observabilityStepLabel(toolName: string | undefined, a: Record<string, unknown>): { verb: string; target: string } | null {
  switch (toolName) {
    case "traces_stats":
      return { verb: `stats by ${word(a.groupBy) || "service"}`, target: word(a.workloadName) || word(a.namespace) || "namespace" };
    case "logs_search":
      return { verb: a.errorsOnly ? "error logs" : "log history", target: word(a.pod) || word(a.workloadName) || word(a.namespace) || "namespace" };
    case "traces_search":
      return { verb: a.errorsOnly ? "failed traces" : a.minDuration ? `traces ≥ ${word(a.minDuration)}` : "traces", target: word(a.workloadName) || word(a.namespace) || "namespace" };
    case "trace_get":
      return { verb: "trace", target: word(a.traceId).slice(0, 12) || "…" };
    case "grafana":
      return { verb: "grafana", target: word(a.tool) || "…" };
    default:
      return null;
  }
}

/** The tool-call fields a step reads; assistant-ui's enriched part carries all of them. */
export interface StepPart extends ToolCallLike {
  toolCallId: string;
  respondToApproval?: (response: ToolApprovalResponse) => Promise<void>;
}

function TimelineStepImpl({ part }: { part: StepPart }) {
  const ctx = useContext(Ctx);
  const state = toolState(part, false);
  const description = describeToolCall(part.toolName, part.args);
  const text = resultAsText(part.result);
  const lines = lineCount(text);
  const commandLine = `${description.kubectl ? "kubectl " : ""}${description.command}`;
  const id = part.toolCallId;
  const nodeId = `step-node-${id}`;
  const panelId = `step-panel-${id}`;
  const waiting = state === "approval";
  const active = state === "running" || waiting;
  const open = ctx?.openId === id;
  const n = ctx?.numberOf(id) ?? 1;
  const Icon = description.icon;
  const label = stepLabel(part.toolName, part.args, description.command);
  const slot = ctx?.slotOf(id) ?? null;
  const detailArea = ctx?.detailOf(id) ?? null;

  const node = (
    <button
      id={nodeId}
      type="button"
      data-step-number={n}
      aria-expanded={open || waiting}
      aria-controls={panelId}
      aria-label={`Step ${n}: ${commandLine} (${TOOL_STATE_UI[state].label})`}
      title={commandLine}
      onClick={() => ctx?.toggle(id)}
      style={{ height: NODE_H }}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-full border pl-1 pr-2.5 text-[11px] font-medium text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        waiting
          ? "border-amber-500 bg-amber-500/15 ring-2 ring-amber-500/30"
          : state === "running"
            ? "border-primary/70 bg-primary/10 ring-2 ring-primary/20"
            : open
              ? "border-primary/60 bg-primary/10"
              : "border-border bg-card hover:border-primary/40 hover:bg-muted/60",
        (state === "error" || state === "blocked") && !open && "border-red-500/50",
      )}
    >
      <span
        className={cn(
          "flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
          waiting ? "bg-amber-500 text-black" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {n}
      </span>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
        <span className="truncate text-[10px] text-muted-foreground">{label.verb}</span>
        <span className="truncate font-mono text-[11px] text-foreground">{label.target}</span>
      </span>
      <StateMark state={state} />
      {state === "done" && lines > 0 && <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{lines}</span>}
    </button>
  );

  const detail =
    waiting && part.respondToApproval ? (
      <div id={panelId} role="region" aria-labelledby={nodeId}>
        <ApprovalPanel
          toolCallId={id}
          commandLine={commandLine}
          onRespond={(approved) =>
            void part.respondToApproval?.({ approved, ...(approved ? {} : { reason: "Denied by user" }) })
          }
        />
      </div>
    ) : open ? (
      <StepDetail
        id={panelId}
        labelledBy={nodeId}
        description={description}
        state={state}
        text={text}
        reason={part.approval?.reason}
        onClose={() => ctx?.close()}
      />
    ) : null;

  return (
    <>
      {slot ? createPortal(node, slot) : null}
      {detail && detailArea ? createPortal(detail, detailArea) : null}
    </>
  );
}

/** Re-render a step only when its own call changes (or the trail layout does), never for streaming text elsewhere. */
export const TimelineStep = memo(TimelineStepImpl, (a, b) => {
  const x = a.part;
  const y = b.part;
  return (
    x.toolCallId === y.toolCallId &&
    x.status?.type === y.status?.type &&
    x.result === y.result &&
    x.isError === y.isError &&
    x.approval === y.approval &&
    x.args === y.args
  );
});
