/**
 * Public surface of the AI module. Code outside `client/src/ai/` imports from
 * `@/ai` only — never from files inside this folder.
 */

export { default as AiChatPage } from "./AiChatPage";
export { AiExplainButton } from "./components/AiExplainYaml";
export { AiTroubleshootButton } from "./components/AiTroubleshoot";
export { ResourceAiInsight } from "./components/ResourceAiInsight";
export { AiAvatar } from "./chat/AiAvatar";
export { Markdown } from "./chat/Markdown";
export { useAiConfig } from "./hooks/use-ai-config";
export { useAiTooltip } from "./hooks/use-ai-tooltip";
export {
  fetchAiSuggestion,
  translateToKubectl,
  fetchClusterBriefing,
  testAiConnection,
  type TranslateRequest,
  type ClusterBriefingRequest,
  type AiConnectionResult,
} from "./api";
