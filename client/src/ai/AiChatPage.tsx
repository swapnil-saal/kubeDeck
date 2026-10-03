import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import {
  Bug, Search, Zap, Trash2, Network, Activity, Eye, MessageSquare,
  ClipboardList, Radar, Wrench,
} from "lucide-react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useSettings } from "@/hooks/use-settings";
import { useK8sPods, useK8sDeployments, useK8sServices } from "@/hooks/use-k8s";
import { useResourceNames } from "@/hooks/use-resource-names";
import { AppHeader } from "@/components/AppHeader";
import { Thread, type Suggestion } from "@/ai/chat/Thread";
import { ChatDeepLink } from "@/ai/chat/ChatDeepLink";
import { AiAvatarChip } from "@/ai/chat/AiAvatar";
import { ClusterRail } from "@/ai/chat/ClusterRail";
import { buildAgentTransport, resetThreadId, shouldResumeAgentTurn } from "@/ai/chat/runtime";

export type ChatMode = "chat" | "troubleshoot" | "briefing" | "investigate";

const MODE_KEY = "kubedeck.ai.chatMode";

const MODES: {
  id: ChatMode;
  label: string;
  hint: string;
  icon: typeof MessageSquare;
}[] = [
  { id: "chat", label: "Chat", hint: "General operator Q&A", icon: MessageSquare },
  { id: "troubleshoot", label: "Troubleshoot", hint: "Root-cause analysis", icon: Wrench },
  { id: "briefing", label: "Briefing", hint: "Status + dashboard", icon: ClipboardList },
  { id: "investigate", label: "Investigate", hint: "Deep multi-hop debug", icon: Radar },
];

const SUGGESTIONS_BY_MODE: Record<ChatMode, Suggestion[]> = {
  chat: [
    {
      category: "Cluster",
      label: "Health board",
      description: "Visual SRE dashboard for this namespace",
      prompt: "Build a full health dashboard for the current namespace: pod health, deployment readiness, top restarting pods. Use present_dashboard with KPIs, charts, and an issues list.",
      icon: <Zap className="w-3.5 h-3.5" />,
    },
    {
      category: "Cluster",
      label: "Performance",
      description: "CPU/memory tops and noisy neighbors",
      prompt: "Show performance for this namespace using kubectl top if available: busiest pods, utilization charts. Use present_dashboard.",
      icon: <Activity className="w-3.5 h-3.5" />,
    },
    {
      category: "Ask",
      label: "What's running?",
      description: "Summarize pods and deployments in scope",
      prompt: "List what's running in this namespace and give a concise summary of health.",
      icon: <Search className="w-3.5 h-3.5" />,
    },
  ],
  troubleshoot: [
    {
      category: "Investigate",
      label: "Pod crash",
      description: "Diagnose CrashLoopBackOff",
      prompt: "Why is my pod in CrashLoopBackOff? Find the worst offenders, describe and pull logs, state the root cause with evidence.",
      icon: <Bug className="w-3.5 h-3.5" />,
    },
    {
      category: "Investigate",
      label: "Restarts",
      description: "High restart pods",
      prompt: "Show pods with high restart counts, diagnose the worst one with describe + logs, and give a fix recommendation.",
      icon: <Search className="w-3.5 h-3.5" />,
    },
    {
      category: "Investigate",
      label: "Image pull",
      description: "ImagePullBackOff errors",
      prompt: "Find ImagePullBackOff / ErrImagePull pods and explain the cause from describe events.",
      icon: <Bug className="w-3.5 h-3.5" />,
    },
  ],
  briefing: [
    {
      category: "Cluster",
      label: "Namespace briefing",
      description: "Executive health snapshot",
      prompt: "Give me a briefing on this namespace: readiness, unhealthy deploys/pods, score 0–100. Use present_dashboard and keep it short.",
      icon: <ClipboardList className="w-3.5 h-3.5" />,
    },
    {
      category: "Cluster",
      label: "Rollout status",
      description: "Deploy readiness board",
      prompt: "Check all deployments' readiness and present a dashboard of ready vs desired plus issues.",
      icon: <Activity className="w-3.5 h-3.5" />,
    },
    {
      category: "Cluster",
      label: "Health board",
      description: "KPIs + issues",
      prompt: "Build a health dashboard for the current namespace with metrics, charts, and ranked issues.",
      icon: <Zap className="w-3.5 h-3.5" />,
    },
  ],
  investigate: [
    {
      category: "Debug API",
      label: "End-to-end call",
      description: "Map call graph + logs",
      prompt: "I need to debug an API call end-to-end. Ask me which service is the entrypoint if unclear, then map the path and pull logs from services on the path.",
      icon: <Network className="w-3.5 h-3.5" />,
    },
    {
      category: "Observe",
      label: "Watch logs",
      description: "Live-tail for new errors",
      prompt: "Watch the logs of a pod I'll specify and flag any new errors. Use monitor_logs.",
      icon: <Eye className="w-3.5 h-3.5" />,
    },
    {
      category: "Investigate",
      label: "Failing deploy",
      description: "Full rollout forensics",
      prompt: "Find deployments not fully ready, inspect related pods/events/logs, and produce a forensics summary with a dashboard of impact.",
      icon: <Radar className="w-3.5 h-3.5" />,
    },
  ],
};

function loadMode(): ChatMode {
  try {
    const v = sessionStorage.getItem(MODE_KEY) as ChatMode | null;
    if (v && MODES.some((m) => m.id === v)) return v;
  } catch { /* ignore */ }
  return "chat";
}

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
  const [mode, setMode] = useState<ChatMode>(loadMode);

  useK8sPods(context, namespace);
  useK8sDeployments(context, namespace);
  useK8sServices(context, namespace);
  const resourceNames = useResourceNames();

  const handleModeChange = useCallback((m: ChatMode) => {
    setMode(m);
    try { sessionStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const buildSystemMessage = useCallback(() => {
    const base = `[Context: ${context || "default"}, Namespace: ${namespace || "all"}, Mode: ${mode}]`;
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
  }, [context, namespace, mode, resourceNames]);

  const scopeRef = useRef({ context: "", namespace: "", mode, sessionContext: "" });
  scopeRef.current = { context, namespace, mode, sessionContext: buildSystemMessage() };
  const transport = useMemo(() => buildAgentTransport(() => scopeRef.current), []);

  const runtime = useChatRuntime({
    transport,
    sendAutomaticallyWhen: shouldResumeAgentTurn,
  });

  const handleClear = () => {
    resetThreadId();
    window.location.reload();
  };

  const scopeLabel = context
    ? `${context} / ${namespace || "all"}`
    : undefined;

  const modeMeta = MODES.find((m) => m.id === mode) || MODES[0];
  const suggestions = SUGGESTIONS_BY_MODE[mode];

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
          <div className="flex h-full min-h-0">
          <div className="min-w-0 flex-1">
          <Thread
            suggestions={suggestions}
            scopeLabel={scopeLabel}
            modes={MODES}
            mode={mode}
            onModeChange={(id) => handleModeChange(id as ChatMode)}
            welcomeTitle={
              mode === "briefing"
                ? "Ready for a cluster briefing"
                : mode === "troubleshoot"
                  ? "What should we diagnose?"
                  : mode === "investigate"
                    ? "What path should we investigate?"
                    : "What should we investigate?"
            }
            welcomeSubtitle={
              context
                ? `${modeMeta.hint}. Live kubectl · structured k8s tools · human approval for mutations.`
                : "Loading kubectl context… set one in the header if needed."
            }
          />
          </div>
          <ClusterRail context={context} namespace={namespace} />
          </div>
        </AssistantRuntimeProvider>
      </div>
    </div>
  );
}
