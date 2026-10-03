import { type FC, type ReactNode, type ComponentType } from "react";
import {
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ErrorPrimitive,
  useAui,
  useAuiState,
  type EmptyMessagePartProps,
} from "@assistant-ui/react";
import {
  ArrowDown,
  ArrowUp,
  Square,
  Copy,
  Check,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { MarkdownText } from "./MarkdownText";
import { ToolUIRegistry } from "./tool-ui";
import { PresentDashboardToolUI } from "./DashboardToolUI";
import { AiAvatarChip } from "./AiAvatar";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface Suggestion {
  label: string;
  prompt: string;
  description?: string;
  icon?: ReactNode;
  category?: string;
}

export interface ChatModeOption {
  id: string;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
}

interface ThreadProps {
  suggestions?: Suggestion[];
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  scopeLabel?: string;
  /** Mode control rendered under the composer (ChatGPT-style). */
  modes?: ChatModeOption[];
  mode?: string;
  onModeChange?: (mode: string) => void;
}

const MAX_W = "max-w-[48rem] 2xl:max-w-[56rem]";

export const Thread: FC<ThreadProps> = ({
  suggestions = [],
  welcomeTitle = "How can I help with your cluster?",
  welcomeSubtitle = "Ask anything — I have live kubectl access.",
  scopeLabel,
  modes,
  mode,
  onModeChange,
}) => {
  return (
    <ThreadPrimitive.Root
      className="aui-thread flex flex-col h-full overflow-hidden relative bg-background"
      style={{
        ["--thread-max-width" as string]: "48rem",
      }}
    >
      <ToolUIRegistry />
      <PresentDashboardToolUI />

      <ThreadPrimitive.Viewport className="relative z-10 flex-1 overflow-y-auto scroll-smooth px-4 sm:px-6">
        <ThreadWelcome
          title={welcomeTitle}
          subtitle={welcomeSubtitle}
          suggestions={suggestions}
          scopeLabel={scopeLabel}
        />

        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
            EditComposer: UserEditComposer,
          }}
        />

        <ThreadPrimitive.If running>
          <RunningStrip />
        </ThreadPrimitive.If>

        <ThreadPrimitive.If empty={false}>
          <div className="min-h-8 flex-grow" />
        </ThreadPrimitive.If>
      </ThreadPrimitive.Viewport>

      <div className="relative z-20">
        <ScrollToBottom />
        <Composer modes={modes} mode={mode} onModeChange={onModeChange} />
      </div>
    </ThreadPrimitive.Root>
  );
};

// ─── Welcome ──────────────────────────────────────────────

const ThreadWelcome: FC<{
  title: string;
  subtitle: string;
  suggestions: Suggestion[];
  scopeLabel?: string;
}> = ({ title, subtitle, suggestions, scopeLabel }) => {
  const byCategory = groupSuggestions(suggestions);

  return (
    <ThreadPrimitive.Empty>
      <div className={cn("mx-auto w-full pt-10 pb-8 sm:pt-16", MAX_W)}>
        <div className="flex flex-col items-center text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="relative mb-5">
            <AiAvatarChip size="lg" />
          </div>

          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-md leading-relaxed">
            {subtitle}
          </p>

          {scopeLabel && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-mono text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {scopeLabel}
            </div>
          )}
        </div>

        {byCategory.length > 0 && (
          <div className="mt-10 space-y-6 animate-in fade-in duration-700 delay-100 fill-mode-both">
            {byCategory.map(({ category, items }) => (
              <div key={category || "default"}>
                {category && (
                  <div className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                    {category}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {items.map((s, i) => (
                    <SuggestionCard key={`${s.label}-${i}`} suggestion={s} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ThreadPrimitive.Empty>
  );
};

function groupSuggestions(suggestions: Suggestion[]) {
  const map = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    const key = s.category || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
}

const SuggestionCard: FC<{ suggestion: Suggestion }> = ({ suggestion }) => {
  const aui = useAui();
  return (
    <button
      type="button"
      onClick={() => {
        aui.thread().append({
          role: "user",
          content: [{ type: "text", text: suggestion.prompt }],
        });
      }}
      className={cn(
        "group flex items-start gap-3 p-3.5 text-left rounded-xl",
        "border border-border bg-card",
        "hover:border-primary/40 hover:bg-muted",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
      )}
    >
      {suggestion.icon && (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-primary border border-border">
          {suggestion.icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-foreground tracking-wide">
          {suggestion.label}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground leading-snug line-clamp-2">
          {suggestion.description || suggestion.prompt}
        </div>
      </div>
    </button>
  );
};

// ─── Running strip ────────────────────────────────────────

const RunningStrip: FC = () => {
  return (
    <div className={cn("mx-auto w-full py-3", MAX_W)}>
      <div className="inline-flex items-center gap-2.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-muted-foreground">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
        <span>Investigating with live cluster access…</span>
      </div>
    </div>
  );
};

// ─── Scroll to bottom ─────────────────────────────────────

const ScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <button
        type="button"
        className={cn(
          "absolute left-1/2 -translate-x-1/2 -top-10 z-30",
          "inline-flex h-8 items-center gap-1.5 rounded-full border border-border",
          "bg-card px-3 text-[11px] font-medium text-muted-foreground",
          "hover:text-foreground hover:border-primary/40 transition-colors",
          "disabled:invisible data-[disabled]:invisible",
        )}
      >
        <ArrowDown className="h-3 w-3" />
        Latest
      </button>
    </ThreadPrimitive.ScrollToBottom>
  );
};

// ─── User message ─────────────────────────────────────────

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className={cn(
        "mx-auto grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 py-4 group",
        MAX_W,
      )}
    >
      <UserActionBar />
      <div
        className={cn(
          "col-start-2 max-w-[min(100%,36rem)]",
          "rounded-2xl rounded-tr-md px-4 py-2.5",
          "bg-primary text-primary-foreground shadow-sm",
          "text-sm leading-relaxed break-words",
        )}
      >
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex flex-col items-end gap-1 col-start-1 row-start-1 mr-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      <ActionBarPrimitive.Edit asChild>
        <IconButton title="Edit message">
          <RotateCcw className="w-3 h-3" />
        </IconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const UserEditComposer: FC = () => {
  return (
    <ComposerPrimitive.Root
      className={cn(
        "mx-auto flex w-full flex-col gap-2 py-4",
        "rounded-2xl border border-border bg-card p-3",
        MAX_W,
      )}
    >
      <ComposerPrimitive.Input className="flex-grow resize-none bg-transparent text-sm outline-none px-2 py-1 min-h-[3rem]" />
      <div className="flex items-center justify-end gap-1.5">
        <ComposerPrimitive.Cancel asChild>
          <button
            type="button"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <button
            type="button"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Update
          </button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
};

// ─── Assistant message ────────────────────────────────────

/** The mascot animates its "working" state only while this message is streaming. */
const MessageAvatar: FC = () => {
  const isRunning = useAuiState((s) => s.message.status?.type === "running");
  return <AiAvatarChip size="sm" thinking={isRunning} />;
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className={cn(
        "mx-auto grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3.5 py-4 group",
        MAX_W,
      )}
    >
      <div className="shrink-0 mt-0.5">
        <MessageAvatar />
      </div>

      <div className="min-w-0 col-start-2 space-y-1">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] font-semibold text-foreground/80">KubeDeck AI</span>
          <WorkingBadge />
        </div>

        <div className="space-y-2">
          <MessagePrimitive.Parts
            components={{
              Text: MarkdownText,
              Empty: AssistantEmpty,
            }}
          />
        </div>

        <MessageError />
        <AssistantActionBar />
        <BranchPicker className="mt-1" />
      </div>
    </MessagePrimitive.Root>
  );
};

const WorkingBadge: FC = () => {
  const isRunning = useAuiState((s) => s.message.status?.type === "running");
  if (!isRunning) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-primary font-medium">
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
      working
    </span>
  );
};

const AssistantEmpty: FC<EmptyMessagePartProps> = ({ status }) => {
  if (status.type !== "running") return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
      </span>
      Thinking…
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="mt-2 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <ErrorPrimitive.Message className="leading-relaxed" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="flex items-center gap-0.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      <ActionBarPrimitive.Copy asChild>
        <IconButton title="Copy">
          <MessagePrimitive.If copied>
            <Check className="w-3 h-3 text-emerald-500" />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied={false}>
            <Copy className="w-3 h-3" />
          </MessagePrimitive.If>
        </IconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <IconButton title="Regenerate">
          <RotateCcw className="w-3 h-3" />
        </IconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
};

const BranchPicker: FC<{ className?: string }> = ({ className }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn("flex items-center gap-1 text-[11px] text-muted-foreground", className)}
    >
      <BranchPickerPrimitive.Previous asChild>
        <IconButton title="Previous">
          <ChevronLeft className="w-3 h-3" />
        </IconButton>
      </BranchPickerPrimitive.Previous>
      <span className="tabular-nums px-0.5">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <IconButton title="Next">
          <ChevronRight className="w-3 h-3" />
        </IconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

// ─── Composer ─────────────────────────────────────────────

const Composer: FC<{
  modes?: ChatModeOption[];
  mode?: string;
  onModeChange?: (mode: string) => void;
}> = ({ modes, mode, onModeChange }) => {
  const active = modes?.find((m) => m.id === mode) || modes?.[0];
  const ActiveIcon = active?.icon;

  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6 pb-4 pt-2", MAX_W)}>
      <div className="relative">
        <ComposerPrimitive.Root
          className={cn(
            "flex w-full items-end gap-2 rounded-2xl p-2",
            "border border-border bg-card",
            "focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15",
            "transition-colors duration-150",
          )}
        >
          <ComposerPrimitive.Input
            rows={1}
            autoFocus
            placeholder="Ask about pods, rollouts, logs, health…"
            className={cn(
              "placeholder:text-muted-foreground/70 max-h-40 flex-1 resize-none border-none bg-transparent",
              "px-3 py-2.5 text-sm outline-none disabled:cursor-not-allowed leading-relaxed",
            )}
          />
          <ComposerAction />
        </ComposerPrimitive.Root>
      </div>

      {/* Mode + hints sit under the input (ChatGPT / Gemini style) */}
      <div className="mt-2 flex items-center justify-between gap-3 min-h-8">
        <div className="flex items-center gap-2 min-w-0">
          {modes && modes.length > 0 && onModeChange && active && ActiveIcon && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1.5 h-8 max-w-full rounded-full px-2.5",
                    "border border-border/70 bg-secondary/40 text-[11px] font-medium",
                    "text-foreground hover:bg-secondary/70 hover:border-border",
                    "transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-primary/25",
                  )}
                  title={active.hint}
                >
                  <ActiveIcon className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="truncate">{active.label}</span>
                  <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 opacity-80" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="top"
                sideOffset={8}
                className="w-64 p-1.5"
              >
                {modes.map((m) => {
                  const Icon = m.icon;
                  const selected = m.id === active.id;
                  return (
                    <DropdownMenuItem
                      key={m.id}
                      onClick={() => onModeChange(m.id)}
                      className={cn(
                        "flex items-start gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer",
                        selected && "bg-primary/10",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                          selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground">{m.label}</span>
                          {selected && (
                            <Check className="w-3 h-3 text-primary shrink-0" />
                          )}
                        </span>
                        <span className="block text-[10px] text-muted-foreground leading-snug mt-0.5">
                          {m.hint}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground/80 shrink-0">
          <span className="hidden sm:inline">
            <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-0.5 font-mono text-[9px]">↵</kbd>
            {" "}send
          </span>
          <span className="hidden sm:inline text-border">·</span>
          <span>Destructive cmds blocked</span>
        </div>
      </div>
    </div>
  );
};

const ComposerAction: FC = () => {
  return (
    <>
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-center rounded-xl w-9 h-9 shrink-0",
              "bg-primary text-primary-foreground shadow-sm",
              "hover:bg-primary/90 active:scale-95",
              "disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100",
              "transition-all duration-150",
            )}
            title="Send (Enter)"
          >
            <ArrowUp className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-center rounded-xl w-9 h-9 shrink-0",
              "bg-foreground/10 text-foreground hover:bg-foreground/15 active:scale-95",
              "transition-all duration-150",
            )}
            title="Stop"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </>
  );
};

const IconButton: FC<{
  children: ReactNode;
  title?: string;
  className?: string;
  onClick?: () => void;
}> = ({ children, title, className, onClick }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={cn(
      "inline-flex h-7 w-7 items-center justify-center rounded-lg",
      "text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors",
      className,
    )}
  >
    {children}
  </button>
);
