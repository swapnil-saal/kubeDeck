import { useEffect, useRef, useSyncExternalStore } from "react";
import { useK8sDeployments, useK8sPods } from "@/hooks/use-k8s";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { getAlertState, publishAlerts, subscribeAlerts } from "@/lib/alert-store";
import { newTracker, trackAlerts, type TrackerState } from "@/lib/alerts";
import type { DeployLike, PodLike } from "@/lib/cluster-health";

export function useAlertState() {
  return useSyncExternalStore(subscribeAlerts, getAlertState, getAlertState);
}

/**
 * Watches the selected cluster + namespace (the same pod / deployment polls the rest of the app
 * uses, so no extra requests) and raises alerts for what newly breaks. Mount once, in the shell.
 */
export function useAlertWatcher() {
  const { context, namespace } = useTerminalStore();
  const { prefs } = useAlertState();
  const pods = useK8sPods(context, namespace);
  const deployments = useK8sDeployments(context, namespace);
  const tracker = useRef<{ scope: string; state: TrackerState }>({ scope: "", state: newTracker() });

  useEffect(() => {
    if (!prefs.enabled || !context) return;
    const scope = `${context}/${namespace}`;
    // a new scope starts from a fresh baseline: what is already broken there is not "new"
    if (tracker.current.scope !== scope) tracker.current = { scope, state: newTracker() };
    // data left over from the previous scope while the new one loads must not be read as this scope's
    if (pods.isFetching && !pods.data) return;
    const { alerts } = trackAlerts(
      tracker.current.state,
      {
        pods: pods.data as unknown as PodLike[] | undefined,
        deployments: deployments.data as unknown as DeployLike[] | undefined,
      },
      { recoveries: prefs.recoveries },
    );
    if (alerts.length) publishAlerts(alerts, { context, namespace });
  }, [pods.data, pods.isFetching, deployments.data, context, namespace, prefs.enabled, prefs.recoveries]);
}
