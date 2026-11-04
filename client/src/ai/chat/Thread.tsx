import { type FC } from "react";
import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import { MotionConfig } from "framer-motion";
import { ArrowDown } from "lucide-react";
import type { ChatMode, ChatModeOption, Suggestion } from "./chat-config";
import { Composer, type ChatScope } from "./Composer";
import { PresentDashboardToolUI } from "./DashboardToolUI";
import { AssistantMessage, UserEditComposer, UserMessage } from "./Messages";
import { ToolUIRegistry } from "./tool-ui";
import { Welcome } from "./Welcome";

interface ThreadProps {
  scope: ChatScope;
  /** model name, shown quietly under the composer */
  model: string;
  modes: ChatModeOption[];
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  welcomeTitle: string;
  welcomeSubtitle: string;
  /** what is broken right now, as one-click questions on the empty thread */
  attention: Suggestion[];
  suggestions: Suggestion[];
}

const ScrollToLatest: FC = () => (
  <ThreadPrimitive.ScrollToBottom asChild>
    <button
      type="button"
      className="absolute -top-11 left-1/2 z-30 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[11px] font-semibold text-foreground shadow-md transition-colors hover:border-primary/50 disabled:invisible"
    >
      <ArrowDown className="h-3.5 w-3.5" />
      Latest
    </button>
  </ThreadPrimitive.ScrollToBottom>
);

/**
 * The conversation: welcome screen, messages with tool cards, and the composer.
 * Sticky scrolling only while the agent runs, so opening a step's details does not jump the view.
 */
export const Thread: FC<ThreadProps> = (props) => {
  const running = useAuiState((s) => s.thread.isRunning);
  return <ThreadView {...props} autoScroll={running} />;
};

const ThreadView: FC<ThreadProps & { autoScroll: boolean }> = ({
  scope, model, modes, mode, onModeChange, welcomeTitle, welcomeSubtitle, attention, suggestions, autoScroll,
}) => (
  <MotionConfig reducedMotion="user">
    <ThreadPrimitive.Root className="relative flex h-full flex-col overflow-hidden bg-background">
      <ToolUIRegistry />
      <PresentDashboardToolUI />

      <ThreadPrimitive.Viewport autoScroll={autoScroll} className="relative flex-1 overflow-y-auto scroll-smooth px-4 pt-14 sm:px-6 xl:pt-4">
        <Welcome title={welcomeTitle} subtitle={welcomeSubtitle} attention={attention} suggestions={suggestions} />
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, EditComposer: UserEditComposer }} />
        <ThreadPrimitive.If empty={false}>
          <div className="min-h-6 flex-grow" />
        </ThreadPrimitive.If>
      </ThreadPrimitive.Viewport>

      <div className="relative z-20 border-t border-border/60 bg-background">
        <ThreadPrimitive.If empty={false}>
          <ScrollToLatest />
        </ThreadPrimitive.If>
        <Composer scope={scope} model={model} modes={modes} mode={mode} onModeChange={onModeChange} />
      </div>
    </ThreadPrimitive.Root>
  </MotionConfig>
);
