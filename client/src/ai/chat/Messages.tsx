import { useEffect, useRef, useState, type FC } from "react";
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  groupPartByType,
  useAuiState,
  type ReasoningMessagePartProps,
} from "@assistant-ui/react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Copy, Pencil, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { AiAvatarChip, type AiAvatarState } from "./AiAvatar";
import { IconButton } from "./chat-ui";
import { MarkdownText } from "./MarkdownText";
import { Reasoning } from "./Reasoning";
import { STEP_TOOLS, TimelineStep, ToolTimeline, type StepPart } from "./ToolTimeline";
import { liveAgentState, type MessagePartLike } from "./tool-state";

/** Shared column width for messages, welcome and composer. */
export const THREAD_WIDTH = "max-w-[60rem] 2xl:max-w-[68rem]";

// ─── User ─────────────────────────────────────────────────

export const UserMessage: FC = () => (
  <MessagePrimitive.Root className={cn("group mx-auto grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 py-3", THREAD_WIDTH)}>
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="col-start-1 row-start-1 mt-1.5 flex justify-end opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
    >
      <ActionBarPrimitive.Edit asChild>
        <IconButton title="Edit and resend" aria-label="Edit and resend">
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
    <div className="col-start-2 max-w-[min(100%,38rem)] break-words rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground">
      <MessagePrimitive.Content />
    </div>
  </MessagePrimitive.Root>
);

export const UserEditComposer: FC = () => (
  <ComposerPrimitive.Root className={cn("mx-auto my-3 flex w-full flex-col gap-2 rounded-2xl border border-primary/40 bg-card p-3", THREAD_WIDTH)}>
    <ComposerPrimitive.Input className="min-h-[3rem] flex-grow resize-none bg-transparent px-2 py-1 text-sm text-foreground outline-none" />
    <div className="flex items-center justify-end gap-1.5">
      <ComposerPrimitive.Cancel asChild>
        <button type="button" className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          Cancel
        </button>
      </ComposerPrimitive.Cancel>
      <ComposerPrimitive.Send asChild>
        <button type="button" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
          Resend
        </button>
      </ComposerPrimitive.Send>
    </div>
  </ComposerPrimitive.Root>
);

// ─── Assistant ────────────────────────────────────────────

const useMessageRunning = () => useAuiState((s) => s.message.status?.type === "running");

type AvatarPhase = AiAvatarState | "finished";

const LIVE: ReadonlySet<AvatarPhase> = new Set(["waiting", "working", "answering", "thinking"]);

/** true for ~2 s after a phase this component watched go live has finished; never for history loaded as finished. */
function useJustFinished(phase: AvatarPhase): boolean {
  const [done, setDone] = useState(false);
  const sawLive = useRef(false);
  useEffect(() => {
    if (LIVE.has(phase)) {
      sawLive.current = true;
      setDone(false);
      return;
    }
    if (phase !== "finished" || !sawLive.current) return;
    sawLive.current = false;
    setDone(true);
    const t = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(t);
  }, [phase]);
  return done;
}

/**
 * The mascot mirrors what this message's turn is doing. The selector returns a string,
 * so streamed tokens that don't change the state cause no re-render.
 */
const MessageAvatar: FC = () => {
  const phase = useAuiState((s): AvatarPhase => {
    const m = s.message;
    if (!m.isLast) return "idle";
    const live = liveAgentState(m.content as readonly MessagePartLike[]);
    const status = m.status as { type?: string; reason?: string } | undefined;
    if (status?.type === "running" || status?.type === "requires-action" || live === "waiting") return live;
    if (status?.type === "incomplete" && status.reason === "error") return "error";
    return "finished";
  });
  const done = useJustFinished(phase);
  return <AiAvatarChip size="sm" state={phase === "finished" ? (done ? "done" : "idle") : phase} />;
};

const AssistantName: FC = () => {
  const running = useMessageRunning();
  return (
    <div className="mb-1 flex h-6 items-center gap-2">
      <span className="text-xs font-semibold text-foreground">Ask Deck</span>
      {running && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          <span className="h-1.5 w-1.5 motion-safe:animate-pulse rounded-full bg-primary" />
          working
        </span>
      )}
    </div>
  );
};

/** Shown while the agent works and the message does not end in text yet. */
const WorkingDots: FC = () => (
  <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
    <span className="flex gap-1" aria-hidden>
      <span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-bounce [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-bounce [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-bounce [animation-delay:300ms]" />
    </span>
    Working…
  </div>
);

/** Consecutive command tools coalesce into one timeline; other tools keep their own cards. */
const groupSteps = groupPartByType(
  Object.fromEntries(STEP_TOOLS.map((tool) => [`tool-call:${tool}`, ["group-steps"]])) as Record<`tool-call:${string}`, ["group-steps"]>,
);
const STEP_TOOL_NAMES = new Set<string>(STEP_TOOLS);

const AssistantParts: FC = () => (
  <MessagePrimitive.GroupedParts groupBy={groupSteps} indicator="no-text">
    {({ part, children }) => {
      switch (part.type) {
        case "group-steps":
          return <ToolTimeline indices={part.indices}>{children}</ToolTimeline>;
        case "text":
          return <MarkdownText />;
        case "reasoning":
          return <Reasoning {...(part as unknown as ReasoningMessagePartProps)} />;
        case "tool-call":
          // null hands the call to its registered card (ask_human, present_dashboard, monitor_logs)
          return STEP_TOOL_NAMES.has(part.toolName) ? <TimelineStep part={part as unknown as StepPart} /> : null;
        case "indicator":
          return <WorkingDots />;
        default:
          return null;
      }
    }}
  </MessagePrimitive.GroupedParts>
);

const MessageError: FC = () => (
  <MessagePrimitive.Error>
    <ErrorPrimitive.Root
      role="alert"
      className="mt-2 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/[0.07] px-3 py-2.5 text-xs text-red-700 dark:text-red-300"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <ErrorPrimitive.Message className="leading-relaxed" />
    </ErrorPrimitive.Root>
  </MessagePrimitive.Error>
);

const AssistantActionBar: FC = () => (
  <ActionBarPrimitive.Root
    hideWhenRunning
    autohide="not-last"
    autohideFloat="single-branch"
    className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 data-[floating]:opacity-100"
  >
    <ActionBarPrimitive.Copy asChild>
      <IconButton title="Copy answer" aria-label="Copy answer">
        <MessagePrimitive.If copied>
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        </MessagePrimitive.If>
        <MessagePrimitive.If copied={false}>
          <Copy className="h-3.5 w-3.5" />
        </MessagePrimitive.If>
      </IconButton>
    </ActionBarPrimitive.Copy>
    <ActionBarPrimitive.Reload asChild>
      <IconButton title="Regenerate" aria-label="Regenerate">
        <RotateCcw className="h-3.5 w-3.5" />
      </IconButton>
    </ActionBarPrimitive.Reload>
  </ActionBarPrimitive.Root>
);

const BranchPicker: FC = () => (
  <BranchPickerPrimitive.Root hideWhenSingleBranch className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
    <BranchPickerPrimitive.Previous asChild>
      <IconButton title="Previous answer" aria-label="Previous answer">
        <ChevronLeft className="h-3.5 w-3.5" />
      </IconButton>
    </BranchPickerPrimitive.Previous>
    <span className="px-0.5 tabular-nums">
      <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
    </span>
    <BranchPickerPrimitive.Next asChild>
      <IconButton title="Next answer" aria-label="Next answer">
        <ChevronRight className="h-3.5 w-3.5" />
      </IconButton>
    </BranchPickerPrimitive.Next>
  </BranchPickerPrimitive.Root>
);

export const AssistantMessage: FC = () => (
  <MessagePrimitive.Root className={cn("group mx-auto grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 py-3", THREAD_WIDTH)}>
    <div className="mt-0.5 shrink-0">
      <MessageAvatar />
    </div>
    <div className="col-start-2 min-w-0">
      <AssistantName />
      <AssistantParts />
      <MessageError />
      <AssistantActionBar />
      <BranchPicker />
    </div>
  </MessagePrimitive.Root>
);
