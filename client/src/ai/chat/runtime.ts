import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";

/** Thread id scopes the server-side repeat-call guards; history itself lives in the client. */
const THREAD_KEY = "kubedeck.ai.threadId";

export function getThreadId(): string {
  try {
    let id = sessionStorage.getItem(THREAD_KEY);
    if (!id) {
      id = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(THREAD_KEY, id);
    }
    return id;
  } catch {
    return `thread_${Date.now()}`;
  }
}

export function resetThreadId(): string {
  const id = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try { sessionStorage.setItem(THREAD_KEY, id); } catch {}
  return id;
}

export interface AgentRequestScope {
  context: string;
  namespace: string;
  mode: string;
  sessionContext: string;
}

/** Transport to `/api/ai/agent`; `getScope` is read on every request so scope changes apply immediately. */
export function buildAgentTransport(getScope: () => AgentRequestScope) {
  return new AssistantChatTransport<UIMessage>({
    api: "/api/ai/agent",
    body: () => ({ ...getScope(), threadId: getThreadId() }),
  });
}

/**
 * Resume the turn automatically once the user has answered what the agent was
 * waiting on: a tool-approval response, or an `ask_human` answer. Deliberately
 * NOT "any completed tool call" — that would re-run a turn that merely hit the step cap.
 */
export function shouldResumeAgentTurn({ messages }: { messages: UIMessage[] }): boolean {
  if (lastAssistantMessageIsCompleteWithApprovalResponses({ messages })) return true;
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant") return false;
  const lastPart = last.parts[last.parts.length - 1] as { type: string; state?: string } | undefined;
  return lastPart?.type === "tool-ask_human" && lastPart.state === "output-available";
}
