import type { ReactNode } from "react";
import {
  Activity, Bug, ClipboardList, Eye, MessageSquare, Network, Radar, Search, Wrench, Zap, ImageOff, RotateCw,
  type LucideIcon,
} from "lucide-react";

/** Agent modes; the server reads the id (see server/ai/chat/prompts.ts). */
export type ChatMode = "chat" | "troubleshoot" | "briefing" | "investigate";

export interface ChatModeOption {
  id: ChatMode;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** heading of the empty thread in this mode */
  welcome: string;
}

export interface Suggestion {
  label: string;
  description: string;
  prompt: string;
  icon: ReactNode;
}

export const CHAT_MODES: ChatModeOption[] = [
  { id: "chat", label: "Chat", hint: "Ask anything about your cluster", icon: MessageSquare, welcome: "What should we look at?" },
  { id: "troubleshoot", label: "Troubleshoot", hint: "Find the root cause of a failure", icon: Wrench, welcome: "What should we diagnose?" },
  { id: "briefing", label: "Briefing", hint: "A short status report with a dashboard", icon: ClipboardList, welcome: "Ready for a cluster briefing" },
  { id: "investigate", label: "Investigate", hint: "Follow a request across services, live", icon: Radar, welcome: "What path should we investigate?" },
];

const icon = (I: LucideIcon) => <I className="h-4 w-4" />;

export const SUGGESTIONS_BY_MODE: Record<ChatMode, Suggestion[]> = {
  chat: [
    {
      label: "Health board",
      description: "Pods, rollouts and restarts as a dashboard",
      prompt: "Build a full health dashboard for the current namespace: pod health, deployment readiness, top restarting pods. Use present_dashboard with KPIs, charts, and an issues list.",
      icon: icon(Zap),
    },
    {
      label: "What's running?",
      description: "Summarize pods and deployments in scope",
      prompt: "List what's running in this namespace and give a concise summary of health.",
      icon: icon(Search),
    },
    {
      label: "Performance",
      description: "Busiest pods and noisy neighbours",
      prompt: "Show performance for this namespace using kubectl top if available: busiest pods, utilization charts. Use present_dashboard.",
      icon: icon(Activity),
    },
    {
      label: "Why did it restart?",
      description: "Explain the pods with the most restarts",
      prompt: "Find the pods with the most restarts in this namespace, check the worst one's previous logs and events, and explain why it restarts.",
      icon: icon(RotateCw),
    },
  ],
  troubleshoot: [
    {
      label: "Pod crash",
      description: "Diagnose CrashLoopBackOff",
      prompt: "Why is my pod in CrashLoopBackOff? Find the worst offenders, describe and pull logs, state the root cause with evidence.",
      icon: icon(Bug),
    },
    {
      label: "Restarts",
      description: "Pods with high restart counts",
      prompt: "Show pods with high restart counts, diagnose the worst one with describe + logs, and give a fix recommendation.",
      icon: icon(RotateCw),
    },
    {
      label: "Image pull",
      description: "ImagePullBackOff and ErrImagePull",
      prompt: "Find ImagePullBackOff / ErrImagePull pods and explain the cause from describe events.",
      icon: icon(ImageOff),
    },
    {
      label: "Not ready",
      description: "Deployments below their desired replicas",
      prompt: "Find deployments that are not fully ready, inspect their pods and events, and tell me the root cause for each.",
      icon: icon(Search),
    },
  ],
  briefing: [
    {
      label: "Namespace briefing",
      description: "Executive health snapshot",
      prompt: "Give me a briefing on this namespace: readiness, unhealthy deploys/pods, score 0–100. Use present_dashboard and keep it short.",
      icon: icon(ClipboardList),
    },
    {
      label: "Rollout status",
      description: "Ready vs desired for every deployment",
      prompt: "Check all deployments' readiness and present a dashboard of ready vs desired plus issues.",
      icon: icon(Activity),
    },
  ],
  investigate: [
    {
      label: "End-to-end call",
      description: "Map the request path and pull logs",
      prompt: "I need to debug an API call end-to-end. Ask me which service is the entrypoint if unclear, then map the path and pull logs from services on the path.",
      icon: icon(Network),
    },
    {
      label: "Watch logs",
      description: "Live-tail a pod for new errors",
      prompt: "Watch the logs of a pod I'll specify and flag any new errors. Use monitor_logs.",
      icon: icon(Eye),
    },
    {
      label: "Failing deploy",
      description: "Full rollout forensics",
      prompt: "Find deployments not fully ready, inspect related pods/events/logs, and produce a forensics summary with a dashboard of impact.",
      icon: icon(Radar),
    },
  ],
};

const MODE_KEY = "kubedeck.ai.chatMode";

export function loadChatMode(): ChatMode {
  try {
    const v = sessionStorage.getItem(MODE_KEY);
    if (CHAT_MODES.some((m) => m.id === v)) return v as ChatMode;
  } catch {
    // storage unavailable
  }
  return "chat";
}

export function saveChatMode(mode: ChatMode): void {
  try {
    sessionStorage.setItem(MODE_KEY, mode);
  } catch {
    // storage unavailable
  }
}
