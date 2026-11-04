import { makeAssistantToolUI } from "@assistant-ui/react";
import { AskHumanCard } from "./AskHumanCard";
import { MonitorCard } from "./MonitorCard";
import { resultAsText } from "./tool-state";

/**
 * A tool result as text. A denied or failed call arrives as `{ error }`: show the reason, not JSON.
 * (Kept here as the public name; the logic lives in tool-state.ts.)
 */
export const toolResultText = resultAsText;

const MonitorLogsToolUI = makeAssistantToolUI({ toolName: "monitor_logs", render: MonitorCard });
const AskHumanToolUI = makeAssistantToolUI({ toolName: "ask_human", render: AskHumanCard });

/**
 * Registers the tools that render as their own cards. Command tools (kubectl, bash, k8s_*)
 * are drawn by the message as one timeline per run of calls (see ToolTimeline.tsx);
 * present_dashboard registers itself in DashboardToolUI.tsx.
 */
export function ToolUIRegistry() {
  return (
    <>
      <MonitorLogsToolUI />
      <AskHumanToolUI />
    </>
  );
}
