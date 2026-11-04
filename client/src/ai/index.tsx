/**
 * Public surface of the AI module. Code outside `client/src/ai/` imports from
 * `@/ai` only — never from files inside this folder.
 *
 * Components are loaded on demand: the AI UI (assistant-ui, markdown, charts, the AI SDK)
 * is most of the app's weight, and none of it is needed to show the cluster overview.
 */
import { lazy, Suspense, type ComponentProps, type ComponentType, type ReactNode } from "react";
import type { AiStatusHintProps } from "./components/AiStatusHint";

/** A lazily loaded component that renders `fallback` (default: nothing) until its code arrives. */
function deferred<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  fallback: (props: P) => ReactNode = () => null,
) {
  const Lazy = lazy(load) as unknown as ComponentType<P>;
  return function Deferred(props: P) {
    return (
      <Suspense fallback={fallback(props)}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}

type TaskDialogs = typeof import("./components/AiTaskDialog");
type Insight = typeof import("./components/ResourceAiInsight");
type MarkdownModule = typeof import("./chat/Markdown");

/** The chat page; routes have their own Suspense boundary. */
export const AiChatPage = lazy(() => import("./AiChatPage"));

export const AiTroubleshootButton = deferred<ComponentProps<TaskDialogs["AiTroubleshootButton"]>>(() =>
  import("./components/AiTaskDialog").then((m) => ({ default: m.AiTroubleshootButton })),
);
export const AiExplainButton = deferred<ComponentProps<TaskDialogs["AiExplainButton"]>>(() =>
  import("./components/AiTaskDialog").then((m) => ({ default: m.AiExplainButton })),
);
export const ResourceAiInsight = deferred<ComponentProps<Insight["ResourceAiInsight"]>>(() =>
  import("./components/ResourceAiInsight").then((m) => ({ default: m.ResourceAiInsight })),
);
export const Markdown = deferred<ComponentProps<MarkdownModule["Markdown"]>>(
  () => import("./chat/Markdown").then((m) => ({ default: m.Markdown })),
  ({ text }) => <span className="whitespace-pre-wrap">{text}</span>,
);
/** Shows the plain badge until the AI tooltip code has loaded. */
export const AiStatusHint = deferred<AiStatusHintProps>(
  () => import("./components/AiStatusHint"),
  ({ children }) => children,
);

export { AiAvatar, type AiAvatarState } from "./chat/AiAvatar";
export { useAiConfig } from "./hooks/use-ai-config";
export { useAiTask } from "./hooks/use-ai-task";
export { translateToKubectl, testAiConnection, type AiConnectionResult } from "./api";
