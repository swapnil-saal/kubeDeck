import { useMemo } from "react";
import {
  Bug, Search, Zap, Trash2, Network, Activity, Eye,
} from "lucide-react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useSettings } from "@/hooks/use-settings";
import { useK8sPods, useK8sDeployments, useK8sServices } from "@/hooks/use-k8s";
import { useResourceNames } from "@/hooks/use-resource-names";
import { AppHeader } from "@/components/AppHeader";
import { Thread, type Suggestion } from "@/components/assistant/Thread";
import { ChatDeepLink } from "@/components/assistant/ChatDeepLink";
import { AiAvatarChip } from "@/components/assistant/AiAvatar";
import { buildKubeChatStream, getThreadId, resetThreadId } from "@/lib/ai-runtime";

const SUGGESTIONS: Suggestion[] = [
  {
    category: "Investigate",
    label: "Pod crash",
    description: "Diagnose CrashLoopBackOff and find the root cause",
    prompt: "Why is my pod in CrashLoopBackOff? Inspect the worst offenders in this namespace, then show a dashboard of restarts and issues.",
    icon: <Bug className="w-3.5 h-3.5" />,
  },
  {
    category: "Cluster",
    label: "Health board",
    description: "Visual SRE dashboard for this namespace",
    prompt: "Build a full health dashboard for the current namespace: pod health, deployment readiness, top restarting pods, recent warning/error events. Use present_dashboard with KPIs, charts, and an issues list.",
    icon: <Zap className="w-3.5 h-3.5" />,
  },
  {
    category: "Cluster",
    label: "Performance",
    description: "CPU/memory tops and noisy neighbors",
    prompt: "Show performance for this namespace using kubectl top if available: busiest pods/nodes, utilization charts, and flag anything over-pressured. Use present_dashboard.",
    icon: <Activity className="w-3.5 h-3.5" />,
  },
  {
    category: "Investigate",
    label: "Restarts",
    description: "Find high-restart pods and explain what broke",
    prompt: "Show pods with high restart counts, chart the top 10, and diagnose the worst one.",
    icon: <Search className="w-3.5 h-3.5" />,
  },
  {
    category: "Investigate",
    label: "Rollouts",
    description: "Check deployment readiness across the namespace",
    prompt: "Check all deployments' rollout status and list any that are not fully ready, as a dashboard plus findings.",
    icon: <Activity className="w-3.5 h-3.5" />,
  },
  {
    category: "Debug API",
    label: "End-to-end call",
    description: "Map the call graph and pull service logs",
    prompt: "I need to debug an API call end-to-end. Ask me which service is the entrypoint, then map the call graph and pull logs from every service in the path.",
    icon: <Network className="w-3.5 h-3.5" />,
  },
  {
    category: "Observe",
    label: "Watch logs",
    description: "Live-tail a pod for new errors",
    prompt: "Watch the logs of a pod I'll specify and alert me to any new errors over the next few minutes.",
    icon: <Eye className="w-3.5 h-3.5" />,
  },
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
    <div className="flex items-center justify-between gap-3 px-5 h-14 border-b border-border bg-card shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <AiAvatarChip size="md" />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground leading-tight tracking-tight">
              AI Operator
            </span>
            <span className="hidden sm:inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/15">
              live
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono leading-tight truncate">
            {provider} · {model}
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1.5 ml-1 pl-3 border-l border-border/50 min-w-0">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.14em] shrink-0">
            Scope
          </span>
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-mono bg-secondary/80 text-secondary-foreground border border-border/50 truncate max-w-[16rem]"
            title="Default kubectl context and namespace for this session"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
            {context || "current-context"}
            <span className="text-muted-foreground/50">/</span>
            {namespace || "all"}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors shrink-0"
        title="Start new conversation"
      >
        <Trash2 size={12} />
        <span className="hidden sm:inline">New chat</span>
      </button>
    </div>
  );
}

export default function AiChatPage() {
  const { context, namespace } = useTerminalStore();
  const { data: settings } = useSettings();
  const provider = settings?.ai?.provider || "openai";
  const model = settings?.ai?.model || "gpt-4o-mini";

  useK8sPods(context, namespace);
  useK8sDeployments(context, namespace);
  useK8sServices(context, namespace);
  const resourceNames = useResourceNames();

  const buildSystemMessage = () => {
    const base = `[Context: ${context || "default"}, Namespace: ${namespace || "all"}]`;
    if (resourceNames.length === 0) return base;
    const byKind: Record<string, string[]> = {};
    for (const r of resourceNames) {
      if (!byKind[r.type]) byKind[r.type] = [];
      if (!byKind[r.type].includes(r.name)) byKind[r.type].push(r.name);
    }
    const lines: string[] = [];
    for (const [k, ns] of Object.entries(byKind)) {
      if (ns.length === 0) continue;
      lines.push(`${k}: ${ns.slice(0, 40).join(", ")}`);
    }
    if (lines.length === 0) return base;
    return `${base}\n\nAvailable resources in scope (use these EXACT names when the user refers to a resource by a fragment like "course" or "flarum"):\n${lines.join("\n")}`;
  };

  const stream = useMemo(
    () =>
      buildKubeChatStream({
        systemMessage: buildSystemMessage,
        threadId: () => getThreadId(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context, namespace, resourceNames.length],
  );

  const runtime = useLangGraphRuntime({
    stream,
    unstable_allowCancellation: true,
  });

  const handleClear = () => {
    resetThreadId();
    window.location.reload();
  };

  const scopeLabel = context
    ? `${context} / ${namespace || "all"}`
    : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden text-foreground bg-background">
      <AppHeader />
      <ChatHeader
        provider={provider}
        model={model}
        context={context}
        namespace={namespace}
        onClear={handleClear}
      />
      <div className="flex-1 min-h-0">
        <AssistantRuntimeProvider runtime={runtime}>
          <ChatDeepLink />
          <Thread
            suggestions={SUGGESTIONS}
            scopeLabel={scopeLabel}
            welcomeTitle="What should we investigate?"
            welcomeSubtitle={
              context
                ? "Cluster-aware SRE assistant with live kubectl. Pick a skill or type a question."
                : "Loading kubectl context… set one in the header if needed."
            }
          />
        </AssistantRuntimeProvider>
      </div>
    </div>
  );
}
