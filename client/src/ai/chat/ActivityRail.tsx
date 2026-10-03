import { useMemo, useState, type FC, type ReactNode } from "react";
import { useAuiState } from "@assistant-ui/react";
import {
  CheckCircle2, XCircle, Loader2, ShieldAlert, HelpCircle, Terminal, LayoutDashboard,
  Activity, GitBranch, Eye, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type StepState = "running" | "done" | "error" | "approval" | "denied" | "question" | "stopped";

interface Step {
  id: string;
  tool: string;
  label: string;
  detail: string;
  state: StepState;
}

interface ToolPart {
  type: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  approval?: { approved?: boolean };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Short human label + command text for a tool call. */
function describeCall(tool: string, a: Record<string, unknown> = {}): { label: string; detail: string } {
  switch (tool) {
    case "kubectl":
      return { label: "kubectl", detail: str(a.command) };
    case "bash":
      return { label: "bash", detail: str(a.command) };
    case "k8s_list": {
      const bits = [`get ${str(a.resource) || "…"}`];
      if (a.name) bits.push(str(a.name));
      if (a.allNamespaces) bits.push("-A");
      return { label: "list", detail: bits.join(" ") };
    }
    case "k8s_describe":
      return { label: "describe", detail: `${str(a.resource)} ${str(a.name)}`.trim() };
    case "k8s_logs":
      return { label: "logs", detail: str(a.name) };
    case "monitor_logs":
      return { label: "monitor", detail: str(a.pod) };
    case "ask_human":
      return { label: "question", detail: str(a.question) };
    case "present_dashboard":
      return { label: "dashboard", detail: str(a.title) || "Dashboard" };
    default:
      return { label: tool, detail: "" };
  }
}

const TOOL_ICON: Record<string, typeof Terminal> = {
  kubectl: Terminal,
  bash: Activity,
  k8s_list: GitBranch,
  k8s_describe: GitBranch,
  k8s_logs: GitBranch,
  monitor_logs: Eye,
  ask_human: HelpCircle,
  present_dashboard: LayoutDashboard,
};

function stepState(part: ToolPart, messageRunning: boolean): StepState {
  if (part.approval && part.approval.approved === undefined && part.result === undefined) return "approval";
  if (part.approval?.approved === false) return "denied";
  if (part.result !== undefined) {
    if (part.isError) return "error";
    const text = typeof part.result === "string" ? part.result : "";
    if (/^(error from server|error:|blocked:|access_denied)/i.test(text.trim()) || /\bforbidden\b/i.test(text.slice(0, 200))) {
      return "error";
    }
    return "done";
  }
  if (part.toolName === "ask_human") return "question";
  return messageRunning ? "running" : "stopped";
}

/** Every tool call in the conversation, in order, flattened from the thread messages. */
function useSteps(): Step[] {
  const messages = useAuiState((s) => s.thread.messages) as readonly {
    role: string;
    status?: { type: string };
    content?: readonly ToolPart[];
  }[];

  return useMemo(() => {
    const out: Step[] = [];
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      const running = m.status?.type === "running";
      for (const part of m.content ?? []) {
        if (part.type !== "tool-call" || !part.toolName) continue;
        const { label, detail } = describeCall(part.toolName, part.args);
        out.push({
          id: part.toolCallId ?? `${out.length}`,
          tool: part.toolName,
          label,
          detail,
          state: stepState(part, running),
        });
      }
    }
    return out;
  }, [messages]);
}

const STATE_UI: Record<StepState, { icon: ReactNode; text: string; tone: string }> = {
  running: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />, text: "running", tone: "text-primary" },
  done: { icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />, text: "done", tone: "text-muted-foreground" },
  error: { icon: <XCircle className="h-3.5 w-3.5 text-destructive" />, text: "failed", tone: "text-destructive" },
  approval: { icon: <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />, text: "needs approval", tone: "text-rose-500" },
  denied: { icon: <XCircle className="h-3.5 w-3.5 text-muted-foreground" />, text: "denied", tone: "text-muted-foreground" },
  question: { icon: <HelpCircle className="h-3.5 w-3.5 text-amber-500" />, text: "waiting for you", tone: "text-amber-500" },
  stopped: { icon: <XCircle className="h-3.5 w-3.5 text-muted-foreground/60" />, text: "stopped", tone: "text-muted-foreground" },
};

/** Collapsible audit trail of every command the agent ran in this conversation. */
export const AgentActivity: FC = () => {
  const steps = useSteps();
  const [open, setOpen] = useState(false);
  const ordered = useMemo(() => [...steps].reverse(), [steps]);
  const failed = steps.filter((s) => s.state === "error").length;
  const attention = steps.filter((s) => s.state === "approval" || s.state === "question" || s.state === "running").length;
  const expanded = open || attention > 0;

  return (
    <section className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/40"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Agent activity</span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {steps.length} call{steps.length === 1 ? "" : "s"}
          {failed > 0 && <span className="text-destructive"> · {failed} failed</span>}
        </span>
      </button>

      {expanded && (
        steps.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-muted-foreground">Commands the agent runs show up here.</p>
        ) : (
          <ol className="px-2 pb-3">
            {ordered.map((s) => {
              const ui = STATE_UI[s.state];
              const Icon = TOOL_ICON[s.tool] ?? Terminal;
              return (
                <li key={s.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-semibold text-foreground">{s.label}</span>
                      <span className={cn("text-[10px]", ui.tone)}>{ui.text}</span>
                    </div>
                    {s.detail && (
                      <code className="block truncate font-mono text-[11px] text-muted-foreground" title={s.detail}>
                        {s.detail}
                      </code>
                    )}
                  </div>
                  <span className="mt-1 shrink-0">{ui.icon}</span>
                </li>
              );
            })}
          </ol>
        )
      )}
    </section>
  );
};
