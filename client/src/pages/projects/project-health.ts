import type { K8sDeployment, K8sPod } from "@shared/schema";

export interface ScopeHealth {
  pods: number;
  running: number;
  failing: number;
  deployments: number;
  degraded: number;
}

const FAILING = /^(CrashLoopBackOff|Error|ImagePullBackOff|ErrImagePull|OOMKilled|CreateContainerConfigError|CreateContainerError|InvalidImageName|Failed|Evicted)$/;

export const podFailing = (status: string) => FAILING.test(status);

export function deploymentDegraded(ready: string): boolean {
  const [have, want] = ready.split("/").map(Number);
  return Number.isFinite(have) && Number.isFinite(want) && have < want;
}

/** Counts for one scope, or for a whole project when given every scope's lists. */
export function healthOf(pods: K8sPod[] = [], deployments: K8sDeployment[] = []): ScopeHealth {
  return {
    pods: pods.length,
    running: pods.filter((p) => p.status === "Running" || p.status === "Completed" || p.status === "Succeeded").length,
    failing: pods.filter((p) => podFailing(p.status)).length,
    deployments: deployments.length,
    degraded: deployments.filter((d) => deploymentDegraded(d.ready)).length,
  };
}
