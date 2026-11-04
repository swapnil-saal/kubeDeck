import { useState, type FC } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, ScrollText, Sparkles } from "lucide-react";
import { diagnoseAllPrompt, type ClusterHealth, type Issue } from "@/lib/cluster-health";
import { listHref } from "@/lib/resource-kinds";
import { cn } from "@/lib/utils";
import { Panel, SEVERITY, issueTarget } from "./parts";

interface Actions {
  onAsk?: (prompt: string) => void;
  onOpen: (type: string, name: string, namespace: string) => void;
  onLogs: (type: string, name: string, namespace: string) => void;
}

const IssueRow: FC<{ issue: Issue; askLabel: string } & Actions> = ({ issue, askLabel, onAsk, onOpen, onLogs }) => {
  const ui = SEVERITY[issue.severity];
  const target = issueTarget(issue);
  return (
    <li className="group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-muted/50">
      <span className="shrink-0">{ui.icon}</span>
      <button
        type="button"
        disabled={!target}
        onClick={() => target && onOpen(target.type, target.name, target.namespace)}
        className="min-w-0 flex-1 text-left disabled:cursor-default"
        title={target ? `Open ${issue.title}` : undefined}
      >
        <span className="block truncate font-mono text-[13px] text-foreground group-hover:underline group-hover:underline-offset-2">{issue.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className={cn("shrink-0 rounded-md px-1.5 py-px text-[10px] font-semibold ring-1", ui.pill)}>{issue.reason}</span>
          {issue.meta && <span className="truncate text-[11px] text-muted-foreground">{issue.meta}</span>}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1">
        {target?.type === "pod" && (
          <button
            type="button"
            onClick={() => onLogs(target.type, target.name, target.namespace)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ScrollText className="h-3.5 w-3.5" />Logs
          </button>
        )}
        {onAsk && (
          <button
            type="button"
            onClick={() => onAsk(issue.prompt)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
          >
            <Sparkles className="h-3.5 w-3.5" />{askLabel}
          </button>
        )}
      </span>
    </li>
  );
};

/** What is broken now, then what keeps restarting — every row one click from its logs or a diagnosis. */
export const AttentionPanel: FC<{ health: ClusterHealth; namespace: string } & Actions> = ({ health, namespace, ...actions }) => {
  const [showAllFlaky, setShowAllFlaky] = useState(false);
  const [, navigate] = useLocation();
  const problems = health.issues;
  const flaky = showAllFlaky ? health.flaky : health.flaky.slice(0, 3);

  return (
    <Panel
      title={<>Needs attention{problems.length > 0 && <span className="ml-1.5 rounded-full bg-destructive/15 px-1.5 py-px text-[11px] text-destructive">{problems.length}</span>}</>}
      right={actions.onAsk && problems.length > 1 ? (
        <button
          type="button"
          onClick={() => actions.onAsk?.(diagnoseAllPrompt(problems, namespace))}
          className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary ring-1 ring-primary/20 hover:bg-primary/15"
        >
          <Sparkles className="h-3.5 w-3.5" />Diagnose all
        </button>
      ) : null}
    >
      <div className="p-2">
        {problems.length === 0 ? (
          <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Nothing is failing: every pod is up and every deployment has its replicas.
          </p>
        ) : (
          <ul>
            {problems.slice(0, 8).map((i) => <IssueRow key={i.id} issue={i} askLabel="Diagnose" {...actions} />)}
          </ul>
        )}
        {problems.length > 8 && <p className="px-3 pb-1 text-[11px] text-muted-foreground">+{problems.length - 8} more{actions.onAsk ? " — Diagnose all covers them." : ""}</p>}

        {health.flaky.length > 0 && (
          <div className="mt-1 border-t border-border/60 pt-1">
            <p className="flex items-center justify-between px-3 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
              <span>Restarting often · {health.flakyTotal} pod{health.flakyTotal === 1 ? "" : "s"}</span>
              <span className="tabular-nums">{health.restarts.toLocaleString()} restarts in scope</span>
            </p>
            <ul>{flaky.map((i) => <IssueRow key={i.id} issue={i} askLabel="Why?" {...actions} />)}</ul>
            <div className="flex items-center gap-3 px-3 py-1 text-[11px] font-medium">
              {health.flaky.length > 3 && (
                <button type="button" onClick={() => setShowAllFlaky((v) => !v)} className="text-primary hover:underline">
                  {showAllFlaky ? "Show fewer" : `Show ${health.flaky.length - 3} more`}
                </button>
              )}
              {health.flakyTotal > 3 && (
                <button type="button" onClick={() => navigate(listHref("pods", "restarts"))} className="text-muted-foreground hover:text-foreground hover:underline">
                  All {health.flakyTotal} in the pod list →
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
};
