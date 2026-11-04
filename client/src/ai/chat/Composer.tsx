import { type FC } from "react";
import { ComposerPrimitive, ThreadPrimitive } from "@assistant-ui/react";
import { ArrowUp, Layers, ShieldCheck, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentStatus } from "./AgentStatus";
import type { ChatMode, ChatModeOption } from "./chat-config";
import { THREAD_WIDTH } from "./Messages";

export interface ChatScope {
  context: string;
  namespace: string;
}

/** The cluster and namespace every command runs in. Changed in the header's scope switcher. */
export const ScopePill: FC<{ scope: ChatScope; className?: string }> = ({ scope, className }) => {
  const ns = scope.namespace && scope.namespace !== "all" ? scope.namespace : "all namespaces";
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px]",
        className,
      )}
      title="Every command runs here. Change it with the scope switcher in the header."
    >
      <Layers className="h-3 w-3 shrink-0 text-primary" />
      <span className="truncate font-mono">
        <span className="font-semibold text-foreground">{scope.context || "current context"}</span>
        <span className="text-muted-foreground"> / </span>
        <span className="text-foreground">{ns}</span>
      </span>
    </span>
  );
};

const ModeSwitch: FC<{ modes: ChatModeOption[]; mode: ChatMode; onChange: (mode: ChatMode) => void }> = ({ modes, mode, onChange }) => (
  <div role="radiogroup" aria-label="Agent mode" className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-muted/50 p-0.5">
    {modes.map((m) => {
      const Icon = m.icon;
      const active = m.id === mode;
      return (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(m.id)}
          aria-label={m.label}
          title={`${m.label}: ${m.hint}`}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            active ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className={cn("h-3.5 w-3.5", active && "text-primary")} />
          {/* small screens: icons only (the active mode keeps its name) */}
          <span className={active ? "" : "hidden sm:inline"}>{m.label}</span>
        </button>
      );
    })}
  </div>
);

const SendOrStop: FC = () => (
  <>
    <ThreadPrimitive.If running={false}>
      <ComposerPrimitive.Send asChild>
        <button
          type="button"
          title="Send (Enter)"
          aria-label="Send"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
        </button>
      </ComposerPrimitive.Send>
    </ThreadPrimitive.If>
    <ThreadPrimitive.If running>
      <ComposerPrimitive.Cancel asChild>
        <button
          type="button"
          title="Stop the agent"
          aria-label="Stop"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-all hover:bg-foreground/85 active:scale-95"
        >
          <Square className="h-3.5 w-3.5 fill-current" />
        </button>
      </ComposerPrimitive.Cancel>
    </ThreadPrimitive.If>
  </>
);

export const Composer: FC<{
  scope: ChatScope;
  model: string;
  modes: ChatModeOption[];
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}> = ({ scope, model, modes, mode, onModeChange }) => (
  <div className={cn("mx-auto w-full px-4 pb-4 pt-2 sm:px-6", THREAD_WIDTH)}>
    <AgentStatus />
    <ComposerPrimitive.Root
      className={cn(
        "flex w-full items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm",
        "transition-[border-color,box-shadow] focus-within:border-primary/60 focus-within:shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]",
      )}
    >
      <ComposerPrimitive.Input
        rows={1}
        autoFocus
        placeholder={`Ask about ${scope.namespace && scope.namespace !== "all" ? scope.namespace : "your cluster"}: pods, rollouts, logs, health…`}
        aria-label="Message the assistant"
        className="max-h-40 flex-1 resize-none border-none bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed"
      />
      <SendOrStop />
    </ComposerPrimitive.Root>

    {/* one line: mode, scope, then the safety note and model, which give way before anything wraps */}
    <div className="mt-2 flex min-w-0 items-center gap-2">
      <ModeSwitch modes={modes} mode={mode} onChange={onModeChange} />
      <ScopePill scope={scope} className="max-w-[16rem] shrink" />
      <span
        className="ml-auto flex min-w-0 shrink items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground"
        title="Commands that change the cluster wait for your approval; delete, drain, cordon and taint are always blocked."
      >
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="hidden truncate lg:inline">Changes need approval · deletes blocked</span>
        {model && (
          <span className="hidden truncate font-mono text-[10.5px] text-muted-foreground/80 sm:inline" title="Model (Settings → AI)">
            {model}
          </span>
        )}
      </span>
    </div>
  </div>
);
