import { type FC, type ReactNode } from "react";
import {
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  useThreadRuntime,
} from "@assistant-ui/react";
import {
  ArrowUp, Square, Copy, RotateCcw, ChevronLeft, ChevronRight, Bot, User,
} from "lucide-react";
import { MarkdownText } from "./MarkdownText";
import { ToolUIRegistry } from "./tool-ui";
import { InterruptPanel } from "./InterruptPanel";

export interface Suggestion {
  label: string;
  prompt: string;
  icon?: ReactNode;
}

interface ThreadProps {
  suggestions?: Suggestion[];
  welcomeTitle?: string;
  welcomeSubtitle?: string;
}

export const Thread: FC<ThreadProps> = ({
  suggestions = [],
  welcomeTitle = "How can I help with your cluster?",
  welcomeSubtitle = "Ask anything — I have live kubectl access.",
}) => {
  return (
    <ThreadPrimitive.Root
      className="flex flex-col h-full bg-background overflow-hidden"
      style={{
        ["--thread-max-width" as any]: "44rem",
      }}
    >
      <ToolUIRegistry />
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto scroll-smooth bg-background px-4">
        <ThreadWelcome
          title={welcomeTitle}
          subtitle={welcomeSubtitle}
          suggestions={suggestions}
        />
        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
            EditComposer: UserEditComposer,
          }}
        />
        <ThreadPrimitive.If empty={false}>
          <div className="min-h-6 flex-grow" />
        </ThreadPrimitive.If>
      </ThreadPrimitive.Viewport>
      <InterruptPanel />
      <Composer />
    </ThreadPrimitive.Root>
  );
};

// ─── Welcome screen ───────────────────────────────────────

const ThreadWelcome: FC<{
  title: string;
  subtitle: string;
  suggestions: Suggestion[];
}> = ({ title, subtitle, suggestions }) => {
  return (
    <ThreadPrimitive.Empty>
      <div className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="p-3 rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            <Bot className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground max-w-md">{subtitle}</p>
        </div>
        {suggestions.length > 0 && (
          <div className="mt-8 grid w-full grid-cols-1 sm:grid-cols-2 gap-2">
            {suggestions.map((s, i) => (
              <SuggestionButton key={i} suggestion={s} />
            ))}
          </div>
        )}
      </div>
    </ThreadPrimitive.Empty>
  );
};

const SuggestionButton: FC<{ suggestion: Suggestion }> = ({ suggestion }) => {
  const runtime = useThreadRuntime();
  return (
    <button
      onClick={() => {
        runtime.append({
          role: "user",
          content: [{ type: "text", text: suggestion.prompt }],
        });
      }}
      className="flex items-start gap-2.5 p-3 text-left rounded-lg border border-border bg-card hover:bg-muted/50 hover:border-primary/30 transition-all group"
    >
      {suggestion.icon && (
        <div className="text-primary group-hover:scale-110 transition-transform shrink-0 mt-0.5">
          {suggestion.icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {suggestion.label}
        </div>
        <div className="text-xs text-foreground mt-0.5 leading-snug">
          {suggestion.prompt}
        </div>
      </div>
    </button>
  );
};

// ─── User message ─────────────────────────────────────────

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="mx-auto grid w-full max-w-[var(--thread-max-width)] grid-cols-[1fr_auto] gap-3 py-3 group">
      <UserActionBar />
      <div className="bg-primary/10 text-foreground rounded-2xl rounded-tr-sm px-3.5 py-2 break-words text-sm leading-relaxed col-start-2">
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
      className="flex flex-col items-end gap-1 col-start-1 row-start-1 mr-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      <ActionBarPrimitive.Edit asChild>
        <button
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          title="Edit"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const UserEditComposer: FC = () => {
  return (
    <ComposerPrimitive.Root className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-2 py-3 rounded-2xl border border-border bg-card p-2">
      <ComposerPrimitive.Input className="flex-grow resize-none bg-transparent text-sm outline-none px-2 py-1" />
      <div className="flex items-center justify-end gap-1.5">
        <ComposerPrimitive.Cancel asChild>
          <button className="text-xs px-3 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
            Cancel
          </button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <button className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            Send
          </button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
};

// ─── Assistant message ────────────────────────────────────

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="mx-auto grid w-full max-w-[var(--thread-max-width)] grid-cols-[auto_1fr] gap-3 py-3 group">
      <div className="shrink-0 mt-1">
        <div className="w-7 h-7 rounded-lg bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
      </div>
      <div className="min-w-0 col-start-2">
        <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
        <AssistantActionBar />
        <BranchPicker className="mt-1" />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="flex items-center gap-0.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      <ActionBarPrimitive.Copy asChild>
        <button
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          title="Copy"
        >
          <MessagePrimitive.If copied>
            <Copy className="w-3 h-3 text-green-500" />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied={false}>
            <Copy className="w-3 h-3" />
          </MessagePrimitive.If>
        </button>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <button
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          title="Regenerate"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
};

const BranchPicker: FC<{ className?: string }> = ({ className }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={`flex items-center gap-1 text-[11px] text-muted-foreground ${className ?? ""}`}
    >
      <BranchPickerPrimitive.Previous asChild>
        <button className="p-1 rounded hover:bg-muted/60">
          <ChevronLeft className="w-3 h-3" />
        </button>
      </BranchPickerPrimitive.Previous>
      <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      <BranchPickerPrimitive.Next asChild>
        <button className="p-1 rounded hover:bg-muted/60">
          <ChevronRight className="w-3 h-3" />
        </button>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

// ─── Composer ─────────────────────────────────────────────

const Composer: FC = () => {
  return (
    <div className="mx-auto w-full max-w-[var(--thread-max-width)] px-4 pb-4 pt-2">
      <ComposerPrimitive.Root className="flex w-full items-end gap-2 rounded-2xl border border-border bg-card shadow-sm focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all p-2">
        <ComposerPrimitive.Input
          rows={1}
          autoFocus
          placeholder="Ask anything about your cluster…"
          className="placeholder:text-muted-foreground max-h-40 flex-1 resize-none border-none bg-transparent px-3 py-2 text-sm outline-none disabled:cursor-not-allowed"
        />
        <ComposerAction />
      </ComposerPrimitive.Root>
      <p className="text-[10px] text-center text-muted-foreground mt-2">
        Destructive commands are blocked. AI may make mistakes — verify important changes.
      </p>
    </div>
  );
};

const ComposerAction: FC = () => {
  return (
    <>
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <button
            className="inline-flex items-center justify-center rounded-lg w-8 h-8 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Send (Enter)"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <button
            className="inline-flex items-center justify-center rounded-lg w-8 h-8 bg-foreground/10 text-foreground hover:bg-foreground/20 transition-colors"
            title="Stop"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </>
  );
};

export { User };
