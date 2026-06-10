import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";

export interface SmartSuggestion {
  /** Short, human description (e.g. "Logs from crashing pod e2-flarum-…"). */
  label: string;
  /** Why this suggestion appeared — shown as a subtle hint. */
  reason: string;
  /** The kubectl command to run. */
  command: string;
  /** Lucide icon name (resolved by caller). */
  icon: "bug" | "log" | "restart" | "deploy" | "event" | "cpu";
  /** Used to rank: higher = shown first. */
  priority: number;
}

function buildCtx(ctx: string) { return ctx ? ` --context=${ctx}` : ""; }
function buildNs(ns: string) { return ns && ns !== "all" ? ` -n ${ns}` : ""; }

interface PodLike { name: string; status?: string; restarts?: number; namespace?: string }
interface DeployLike { name: string; ready?: string; namespace?: string }

const ERROR_STATUSES = new Set([
  "CrashLoopBackOff", "Error", "ImagePullBackOff", "ErrImagePull",
  "OOMKilled", "CreateContainerConfigError", "InvalidImageName", "RunContainerError",
]);

/**
 * Reads pods/deployments from React Query cache and emits up-to-8 actionable
 * suggestions for the active context+namespace. Zero extra network calls.
 */
export function useSmartSuggestions(context: string, namespace: string): SmartSuggestion[] {
  const qc = useQueryClient();

  return useMemo(() => {
    if (!context) return [];
    const ns = namespace || "all";

    const pods = qc.getQueryData<PodLike[]>([api.k8s.pods.path, context, ns]) || [];
    const deploys = qc.getQueryData<DeployLike[]>([api.k8s.deployments.path, context, ns]) || [];

    const out: SmartSuggestion[] = [];
    const ctxFlag = buildCtx(context);
    const nsFlag = buildNs(ns);

    // 1. Crashing pods → tail logs (previous + current)
    const crashing = pods.filter((p) => p.status && ERROR_STATUSES.has(p.status));
    for (const p of crashing.slice(0, 3)) {
      const podNs = (p.namespace && ns === "all") ? ` -n ${p.namespace}` : nsFlag;
      out.push({
        label: `Logs from ${p.name}`,
        reason: `${p.status} — likely failing`,
        command: `kubectl logs ${p.name}${ctxFlag}${podNs} --tail=200 --previous`,
        icon: "log",
        priority: 100,
      });
    }

    // 2. Describe the most-broken pod
    if (crashing.length > 0) {
      const top = crashing[0];
      const podNs = (top.namespace && ns === "all") ? ` -n ${top.namespace}` : nsFlag;
      out.push({
        label: `Describe ${top.name}`,
        reason: `${top.status} — see container state + events`,
        command: `kubectl describe pod ${top.name}${ctxFlag}${podNs}`,
        icon: "bug",
        priority: 95,
      });
    }

    // 3. High-restart pods (not in obvious error)
    const restartHot = pods
      .filter((p) => (p.restarts ?? 0) > 5 && !(p.status && ERROR_STATUSES.has(p.status)))
      .sort((a, b) => (b.restarts ?? 0) - (a.restarts ?? 0));
    for (const p of restartHot.slice(0, 2)) {
      const podNs = (p.namespace && ns === "all") ? ` -n ${p.namespace}` : nsFlag;
      out.push({
        label: `Recent logs from ${p.name}`,
        reason: `${p.restarts} restarts — may be crashing intermittently`,
        command: `kubectl logs ${p.name}${ctxFlag}${podNs} --tail=200`,
        icon: "restart",
        priority: 80,
      });
    }

    // 4. Deployments not at full replicas
    const degradedDeploys = deploys.filter((d) => {
      if (!d.ready) return false;
      const [cur, tot] = d.ready.split("/");
      return Number(cur) < Number(tot) || Number(tot) === 0;
    });
    for (const d of degradedDeploys.slice(0, 2)) {
      const depNs = (d.namespace && ns === "all") ? ` -n ${d.namespace}` : nsFlag;
      out.push({
        label: `Rollout status of ${d.name}`,
        reason: `${d.ready} ready — check rollout progress`,
        command: `kubectl rollout status deployment/${d.name}${ctxFlag}${depNs}`,
        icon: "deploy",
        priority: 70,
      });
    }

    // 5. Always-useful for the scope: events + top
    out.push({
      label: ns === "all" ? "Recent warning events (cluster)" : `Recent events in ${ns}`,
      reason: "Last sorted by lastTimestamp",
      command: `kubectl get events${ctxFlag}${nsFlag} --sort-by='.lastTimestamp' --field-selector type=Warning`,
      icon: "event",
      priority: 30,
    });
    out.push({
      label: ns === "all" ? "Top pods by CPU (cluster)" : `Top pods by CPU in ${ns}`,
      reason: "Requires metrics-server",
      command: `kubectl top pods${ctxFlag}${nsFlag} --sort-by=cpu`,
      icon: "cpu",
      priority: 25,
    });

    return out.sort((a, b) => b.priority - a.priority).slice(0, 8);
  }, [qc, context, namespace]);
}
