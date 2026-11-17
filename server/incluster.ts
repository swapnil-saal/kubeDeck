/**
 * The pod's own service account as a kubeconfig, for a cluster an admin adds under Settings → Clusters
 * as "this cluster" (KubeDeck never uses it on its own). One context, named like the cluster; the
 * token is read from its file on each use (`tokenFile`), so the kubelet's token rotation is picked up
 * without a restart.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const IN_CLUSTER_CONTEXT = "in-cluster";
const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";

export function inClusterKubeconfig(opts: { host: string; port: string; caFile: string; tokenFile: string }, name = IN_CLUSTER_CONTEXT): string {
  const host = opts.host.includes(":") && !opts.host.startsWith("[") ? `[${opts.host}]` : opts.host; // IPv6
  const q = (s: string) => JSON.stringify(s); // YAML-safe quoting
  return [
    "apiVersion: v1",
    "kind: Config",
    `current-context: ${q(name)}`,
    "clusters:",
    `- name: ${q(name)}`,
    "  cluster:",
    `    server: ${q(`https://${host}:${opts.port}`)}`,
    `    certificate-authority: ${q(opts.caFile)}`,
    "users:",
    "- name: serviceaccount",
    "  user:",
    `    tokenFile: ${q(opts.tokenFile)}`,
    "contexts:",
    `- name: ${q(name)}`,
    "  context:",
    `    cluster: ${q(name)}`,
    "    user: serviceaccount",
    "",
  ].join("\n");
}

/** The pod's service account as a kubeconfig whose one context is `name`; null outside a pod. */
export function podServiceAccountKubeconfig(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const host = env.KUBERNETES_SERVICE_HOST;
  const tokenFile = path.join(SA_DIR, "token");
  if (!host || !fs.existsSync(tokenFile)) return null;
  return inClusterKubeconfig({ host, port: env.KUBERNETES_SERVICE_PORT || "443", caFile: path.join(SA_DIR, "ca.crt"), tokenFile }, name);
}
