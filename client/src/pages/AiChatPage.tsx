import { useMemo } from "react";
import {
  Bot, Bug, Search, Zap, GitBranch, Trash2, Network, Activity, Eye,
} from "lucide-react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useSettings } from "@/hooks/use-settings";
import { AppHeader } from "@/components/AppHeader";
import { Thread, type Suggestion } from "@/components/assistant/Thread";
import { ChatDeepLink } from "@/components/assistant/ChatDeepLink";
import { buildKubeChatStream, getThreadId, resetThreadId } from "@/lib/ai-runtime";

const SUGGESTIONS: Suggestion[] = [
  { label: "DEBUG API",   prompt: "I need to debug an API call end-to-end. Ask me which service is the entrypoint, then map the call graph and pull logs from every service in the path.", icon: <Network className="w-3.5 h-3.5" /> },
  { label: "TRACE ID",    prompt: "I'm going to give you a request id. Find every log line mentioning it across all services in the current namespace and build a chronological timeline.", icon: <GitBranch className="w-3.5 h-3.5" /> },
  { label: "WATCH",       prompt: "Watch the logs of a pod I'll specify and alert me to any new errors over the next few minutes.", icon: <Eye className="w-3.5 h-3.5" /> },
  { label: "DIAGNOSE",    prompt: "Why is my pod in CrashLoopBackOff?", icon: <Bug className="w-3.5 h-3.5" /> },
  { label: "INSPECT",     prompt: "Show pods with high restart counts and tell me what's wrong with the worst one.", icon: <Search className="w-3.5 h-3.5" /> },
  { label: "HEALTH",      prompt: "Give me a full cluster health report.", icon: <Zap className="w-3.5 h-3.5" /> },
  { label: "ROLLOUT",     prompt: "Check all deployments' rollout status.", icon: <Activity className="w-3.5 h-3.5" /> },
];

function ChatHeader({
  provider, model, context, namespace, onClear,
}: {
  provider: string;
  model: string;
  context: string;
  namespace: string;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-5 h-12 border-b border-border bg-card/40 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-primary/10 ring-1 ring-primary/20">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground leading-tight">KubeDeck AI</span>
          <span className="text-[10px] text-muted-foreground font-mono leading-tight">
            {provider} · {model}
          </span>
        </div>
        <div className="flex items-center gap-1.5 ml-2 pl-3 border-l border-border">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Scope</span>
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono bg-primary/10 text-primary border border-primary/20"
            title="The agent will scope kubectl commands to this context and namespace by default."
          >
            {context || "current-context"}
            <span className="text-primary/40">/</span>
            {namespace || "all"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onClear}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          title="Start new conversation"
        >
          <Trash2 className="w-3 h-3" />
          New chat
        </button>
      </div>
    </div>
  );
}

export default function AiChatPage() {
  const { context, namespace } = useTerminalStore();
  const { data: settings } = useSettings();
  const provider = settings?.ai?.provider || "openai";
  const model = settings?.ai?.model || "gpt-4o-mini";

  const stream = useMemo(
    () =>
      buildKubeChatStream({
        systemMessage: () => `[Context: ${context || "default"}, Namespace: ${namespace || "all"}]`,
        threadId: () => getThreadId(),
      }),
    [context, namespace],
  );

  const runtime = useLangGraphRuntime({
    stream,
    unstable_allowCancellation: true,
  });

  const handleClear = () => {
    resetThreadId();
    // Re-mount to wipe runtime state (cheap and reliable).
    window.location.reload();
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden text-foreground">
      <AppHeader />
      <ChatHeader
        provider={provider}
        model={model}
        context={context}
        namespace={namespace}
        onClear={handleClear}
      />
      <AssistantRuntimeProvider runtime={runtime}>
        <ChatDeepLink />
        <Thread
          suggestions={SUGGESTIONS}
          welcomeTitle="How can I help with your cluster?"
          welcomeSubtitle={
            context
              ? `Scoped to context "${context}", namespace "${namespace || "all"}" — change in the header above. Ask anything.`
              : `Loading your kubectl context... Pick one in the header above if it doesn't auto-select.`
          }
        />
      </AssistantRuntimeProvider>
    </div>
  );
}
