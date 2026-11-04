import {
  Activity, Eye, GitBranch, HelpCircle, LayoutDashboard, ScrollText, Terminal, FileSearch,
  type LucideIcon,
} from "lucide-react";

/**
 * One source of truth for how a tool call is named and what state it is in.
 * Used by the inline tool cards, the agent status bar and the activity rail.
 */

export type ToolState =
  | "running"   // executing, or the model is still streaming its input
  | "done"      // finished with output
  | "error"     // finished, but the output is an error (Forbidden, not found…)
  | "approval"  // waiting for the user to allow or deny it
  | "denied"    // the user denied it
  | "blocked"   // KubeDeck's policy refused it without asking
  | "question"  // ask_human waiting for an answer
  | "stopped";  // the turn ended before it ran

/** The subset of an assistant-ui tool-call part this module reads. */
export interface ToolCallLike {
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  status?: { type: string };
  approval?: { approved?: boolean; isAutomatic?: boolean; reason?: string; resolution?: string };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

const ERROR_OUTPUT = /^(error from server|error:|blocked:|access_denied)/i;

/** Is a finished tool's text output actually an error? */
export function looksLikeErrorOutput(text: string | undefined): boolean {
  if (!text) return false;
  const head = text.trim();
  return ERROR_OUTPUT.test(head) || /\bforbidden\b/i.test(head.slice(0, 200));
}

/** A tool result as text. A denied or failed call arrives as `{ error }`: show the reason, not JSON. */
export function resultAsText(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result === "string") return result;
  if (typeof result === "object" && typeof (result as { error?: unknown }).error === "string") {
    return (result as { error: string }).error;
  }
  return JSON.stringify(result);
}

export function toolState(part: ToolCallLike, messageRunning: boolean): ToolState {
  const { approval } = part;
  if (approval?.approved === false) return approval.isAutomatic ? "blocked" : "denied";
  if (approval && approval.approved === undefined && !approval.resolution && part.result === undefined) return "approval";
  if (part.result !== undefined) {
    const text = resultAsText(part.result);
    if (/^blocked:/i.test(text?.trim() ?? "")) return "blocked";
    if (part.isError || looksLikeErrorOutput(text)) return "error";
    return "done";
  }
  if (part.toolName === "ask_human") return "question";
  if (part.status?.type === "running" || messageRunning) return "running";
  return "stopped";
}

export interface ToolDescription {
  /** short verb shown on the card, e.g. "describe" */
  label: string;
  /** the command line the call amounts to, without the `kubectl` prefix */
  command: string;
  icon: LucideIcon;
  /** true when `command` is a kubectl command (shown with a `kubectl` prompt) */
  kubectl: boolean;
}

/** How a tool call reads to a human. */
export function describeToolCall(tool: string | undefined, rawArgs: unknown): ToolDescription {
  const a = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  switch (tool) {
    case "kubectl":
      return { label: "kubectl", command: str(a.command), icon: Terminal, kubectl: true };
    case "bash":
      return { label: "shell", command: str(a.command), icon: Activity, kubectl: false };
    case "k8s_list": {
      const bits = [`get ${str(a.resource) || "…"}`];
      if (a.name) bits.push(str(a.name));
      if (a.allNamespaces) bits.push("-A");
      if (a.wide) bits.push("-o wide");
      if (a.labelSelector) bits.push(`-l ${str(a.labelSelector)}`);
      if (a.fieldSelector) bits.push(`--field-selector=${str(a.fieldSelector)}`);
      if (a.view === "names") bits.push("-o name");
      // a summary is computed by KubeDeck from the full list, so say so instead of showing a flag that doesn't exist
      return { label: a.view === "summary" ? "summary" : "list", command: bits.join(" "), icon: GitBranch, kubectl: true };
    }
    case "k8s_describe": {
      const ns = a.namespace ? ` -n ${str(a.namespace)}` : "";
      return { label: "describe", command: `describe ${str(a.resource) || "…"} ${str(a.name)}${ns}`.trim(), icon: FileSearch, kubectl: true };
    }
    case "k8s_logs": {
      const bits = [`logs ${str(a.name) || "…"}`, `--tail=${typeof a.tail === "number" ? a.tail : 100}`];
      if (a.namespace) bits.push(`-n ${str(a.namespace)}`);
      if (a.container) bits.push(`-c ${str(a.container)}`);
      if (a.previous) bits.push("--previous");
      if (a.since) bits.push(`--since=${str(a.since)}`);
      return { label: "logs", command: bits.join(" "), icon: ScrollText, kubectl: true };
    }
    case "monitor_logs":
      return { label: "live tail", command: `logs -f ${str(a.pod) || "…"}`, icon: Eye, kubectl: true };
    case "ask_human":
      return { label: "question", command: str(a.question), icon: HelpCircle, kubectl: false };
    case "present_dashboard":
      return { label: "dashboard", command: str(a.title) || "Dashboard", icon: LayoutDashboard, kubectl: false };
    default:
      return { label: tool ?? "tool", command: "", icon: Terminal, kubectl: false };
  }
}

/** Text + colours for each state; tuned for contrast in both themes. */
export const TOOL_STATE_UI: Record<ToolState, { label: string; text: string; chip: string; border: string }> = {
  running: {
    label: "Running",
    text: "text-primary",
    chip: "bg-primary/10 text-primary ring-primary/30",
    border: "border-primary/40",
  },
  done: {
    label: "Done",
    text: "text-emerald-700 dark:text-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
    border: "border-border",
  },
  error: {
    label: "Failed",
    text: "text-red-700 dark:text-red-400",
    chip: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30",
    border: "border-red-500/40",
  },
  approval: {
    label: "Needs your approval",
    text: "text-amber-700 dark:text-amber-300",
    chip: "bg-amber-500/15 text-amber-800 dark:text-amber-200 ring-amber-500/40",
    border: "border-amber-500/60",
  },
  denied: {
    label: "Denied by you",
    text: "text-slate-600 dark:text-slate-300",
    chip: "bg-slate-500/10 text-slate-700 dark:text-slate-200 ring-slate-500/30",
    border: "border-slate-500/40",
  },
  blocked: {
    label: "Blocked by policy",
    text: "text-red-700 dark:text-red-400",
    chip: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30",
    border: "border-red-500/40",
  },
  question: {
    label: "Waiting for you",
    text: "text-amber-700 dark:text-amber-300",
    chip: "bg-amber-500/15 text-amber-800 dark:text-amber-200 ring-amber-500/40",
    border: "border-amber-500/60",
  },
  stopped: {
    label: "Not run",
    text: "text-muted-foreground",
    chip: "bg-muted text-muted-foreground ring-border",
    border: "border-border",
  },
};

/** A message part as far as the mascot cares: its type, plus tool-call fields when it is one. */
export interface MessagePartLike extends ToolCallLike {
  type: string;
}

/** What a live assistant message is doing right now, as a mascot state. */
export type LiveAgentState = "waiting" | "working" | "answering" | "thinking";

export function liveAgentState(parts: readonly MessagePartLike[]): LiveAgentState {
  const tools = parts.filter((p) => p.type === "tool-call");
  if (tools.some((p) => {
    const s = toolState(p, false);
    return s === "approval" || s === "question";
  })) return "waiting";
  if (tools.some((p) => toolState(p, true) === "running")) return "working";
  return parts[parts.length - 1]?.type === "text" ? "answering" : "thinking";
}
