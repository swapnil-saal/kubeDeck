import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { useSearch } from "wouter";
import type { UIMessage } from "ai";
import { AlertTriangle, History, MessageSquarePlus, X } from "lucide-react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useSettings } from "@/hooks/use-settings";
import { useK8sPods, useK8sDeployments, useK8sNodes } from "@/hooks/use-k8s";
import { useResourceNames } from "@/hooks/use-resource-names";
import { analyzeHealth, type DeployLike, type NodeLike, type PodLike } from "@/lib/cluster-health";
import { AppHeader } from "@/components/AppHeader";
import { Thread } from "@/ai/chat/Thread";
import { ChatDeepLink } from "@/ai/chat/ChatDeepLink";
import { HistoryDrawer } from "@/ai/chat/HistoryDrawer";
import type { ChatScope } from "@/ai/chat/Composer";
import { CHAT_MODES, SUGGESTIONS_BY_MODE, loadChatMode, saveChatMode, type ChatMode, type Suggestion } from "@/ai/chat/chat-config";
import { buildAgentTransport, shouldResumeAgentTurn } from "@/ai/chat/runtime";
import {
  getActiveChatId, loadChat, newChatId, onChatsChanged, saveChat, setActiveChatId,
} from "@/ai/chat/chat-store";

export type { ChatMode };

/** Resource names in scope, so the agent resolves "the course pod" to a real name. */
function useSessionContext(context: string, namespace: string, mode: ChatMode): string {
  const resourceNames = useResourceNames();
  return useMemo(() => {
    const base = `[Context: ${context || "default"}, Namespace: ${namespace || "all"}, Mode: ${mode}]`;
    const byKind = new Map<string, Set<string>>();
    for (const r of resourceNames) {
      if (!byKind.has(r.type)) byKind.set(r.type, new Set());
      byKind.get(r.type)!.add(r.name);
    }
    const lines = Array.from(byKind, ([kind, names]) => `${kind}: ${Array.from(names).slice(0, 40).join(", ")}`);
    if (lines.length === 0) return base;
    return `${base}\n\nAvailable resources in scope (use these EXACT names when the user refers to a resource by a fragment like "course" or "flarum"):\n${lines.join("\n")}`;
  }, [context, namespace, mode, resourceNames]);
}

/** What is broken right now, as one-click questions for the empty chat (from already-cached queries). */
function useAttentionPrompts(context: string, namespace: string): Suggestion[] {
  const pods = useK8sPods(context, namespace);
  const deployments = useK8sDeployments(context, namespace);
  const nodes = useK8sNodes(context);
  return useMemo(() => {
    const { issues } = analyzeHealth({
      pods: pods.data as unknown as PodLike[] | undefined,
      deployments: deployments.data as unknown as DeployLike[] | undefined,
      nodes: nodes.data as unknown as NodeLike[] | undefined,
    });
    return issues
      .filter((i) => i.severity !== "info")
      .slice(0, 4)
      .map((i) => ({
        label: i.title,
        description: [i.reason, i.meta].filter(Boolean).join(" · "),
        prompt: i.prompt,
        icon: <AlertTriangle className={i.severity === "critical" ? "h-4 w-4 text-destructive" : "h-4 w-4 text-amber-500"} />,
      }));
  }, [pods.data, deployments.data, nodes.data]);
}

/** Shown when a restored chat ran in another scope: switching is the user's call, never silent. */
const ScopeNotice: FC<{ stored: ChatScope; current: ChatScope; onSwitch: () => void; onDismiss: () => void }> = ({
  stored, current, onSwitch, onDismiss,
}) => (
  <div className="absolute left-1/2 top-3 z-30 flex max-w-[calc(100%-7rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-amber-500/40 bg-card px-3 py-1.5 text-xs shadow-sm">
    <span className="truncate text-muted-foreground">
      This chat ran in <span className="font-mono text-foreground">{stored.context || "default"} / {stored.namespace || "all"}</span>
      {" "}— you're in <span className="font-mono text-foreground">{current.context || "default"} / {current.namespace || "all"}</span>
    </span>
    <button type="button" onClick={onSwitch} className="shrink-0 rounded-full bg-primary px-2.5 py-0.5 font-semibold text-primary-foreground hover:bg-primary/90">
      Switch
    </button>
    <button type="button" onClick={onDismiss} aria-label="Keep the current scope" className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted">
      <X className="h-3.5 w-3.5" />
    </button>
  </div>
);

const FloatingButton: FC<{ label: string; onClick: () => void; children: React.ReactNode; shortcut?: string }> = ({ label, onClick, children, shortcut }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={shortcut ? `${label} (${shortcut})` : label}
    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
  >
    {children}
  </button>
);

interface SessionSeed {
  id: string;
  messages: UIMessage[];
  /** where a restored chat last ran */
  scope?: ChatScope;
}

/** One conversation. Keyed by its id, so opening another chat starts from that chat's messages. */
const ChatSession: FC<SessionSeed & { onOpenHistory: () => void; onNewChat: () => void }> = ({
  id, messages, scope: storedScope, onOpenHistory, onNewChat,
}) => {
  const { context, namespace, setContext, setNamespace } = useTerminalStore();
  const { data: settings } = useSettings();
  const model = settings?.ai?.model || "";
  const [mode, setMode] = useState<ChatMode>(loadChatMode);
  const [scopeNoticeOpen, setScopeNoticeOpen] = useState(true);
  const sessionContext = useSessionContext(context, namespace, mode);
  const attention = useAttentionPrompts(context, namespace);

  const changeMode = useCallback((m: ChatMode) => {
    setMode(m);
    saveChatMode(m);
  }, []);

  // read on every request and save, so a scope or mode change applies to the next message
  const scopeRef = useRef({ threadId: id, context, namespace, mode, sessionContext });
  scopeRef.current = { threadId: id, context, namespace, mode, sessionContext };
  const createdAt = useRef(Date.now());
  const transport = useMemo(() => buildAgentTransport(() => scopeRef.current), []);
  const runtime = useChatRuntime({
    id,
    messages,
    transport,
    sendAutomaticallyWhen: shouldResumeAgentTurn,
    // every finished turn (answered, failed or stopped) is kept on this device
    onFinish: ({ messages: all }) => {
      const s = scopeRef.current;
      void saveChat({ id, messages: all, createdAt: createdAt.current, updatedAt: Date.now(), context: s.context, namespace: s.namespace, mode: s.mode }).catch(() => {});
    },
  });

  const current: ChatScope = { context, namespace };
  const scopeDiffers = !!storedScope && (storedScope.context !== context || storedScope.namespace !== namespace);
  const modeMeta = CHAT_MODES.find((m) => m.id === mode) ?? CHAT_MODES[0];

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatDeepLink />
      <div className="absolute left-3 top-3 z-30 flex gap-1.5">
        <FloatingButton label="Chat history" onClick={onOpenHistory}>
          <History className="h-4 w-4" />
        </FloatingButton>
        <FloatingButton label="New chat" onClick={onNewChat}>
          <MessageSquarePlus className="h-4 w-4" />
        </FloatingButton>
      </div>
      {scopeDiffers && scopeNoticeOpen && storedScope && (
        <ScopeNotice
          stored={storedScope}
          current={current}
          onSwitch={() => {
            setContext(storedScope.context);
            setNamespace(storedScope.namespace);
            setScopeNoticeOpen(false);
          }}
          onDismiss={() => setScopeNoticeOpen(false)}
        />
      )}
      <Thread
        scope={current}
        model={model}
        modes={CHAT_MODES}
        mode={mode}
        onModeChange={changeMode}
        welcomeTitle={modeMeta.welcome}
        welcomeSubtitle={
          context
            ? `${modeMeta.hint}. I work with live kubectl in your scope and ask before changing anything.`
            : "Loading your kubectl context… pick one in the header if it doesn't appear."
        }
        attention={attention}
        suggestions={SUGGESTIONS_BY_MODE[mode]}
      />
    </AssistantRuntimeProvider>
  );
};

function freshSession(): SessionSeed {
  const id = newChatId();
  setActiveChatId(id);
  return { id, messages: [] };
}

export default function AiChatPage() {
  const search = useSearch();
  const [session, setSession] = useState<SessionSeed | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const openHistory = useCallback(() => setHistoryOpen(true), []);

  const open = useCallback(async (id: string) => {
    const chat = await loadChat(id).catch(() => null);
    if (!chat) return setSession(freshSession());
    setActiveChatId(chat.id);
    setSession({ id: chat.id, messages: chat.messages, scope: { context: chat.context, namespace: chat.namespace } });
  }, []);

  const newChat = useCallback(() => {
    setSession(freshSession());
    setHistoryOpen(false);
  }, []);

  // Reopen the last chat after a reload; a deep link (?prompt=…) always starts a new one.
  useEffect(() => {
    const activeId = new URLSearchParams(search).has("prompt") ? null : getActiveChatId();
    if (activeId) void open(activeId);
    else setSession(freshSession());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The open chat was deleted (or all chats were): start a new one.
  useEffect(() => onChatsChanged(() => {
    if (getActiveChatId() === null) setSession(freshSession());
  }), []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <AppHeader breadcrumbs={[{ label: "Ask Deck" }]} />
      <main className="relative min-h-0 flex-1" aria-label="Ask Deck">
        {session && (
          <ChatSession
            key={session.id}
            {...session}
            onOpenHistory={openHistory}
            onNewChat={newChat}
          />
        )}
        <HistoryDrawer
          open={historyOpen}
          activeId={session?.id ?? ""}
          onClose={closeHistory}
          onOpenChat={(id) => {
            setHistoryOpen(false);
            if (id !== session?.id) void open(id);
          }}
          onNewChat={newChat}
        />
      </main>
    </div>
  );
}
