/**
 * Inside a pod there is no kubeconfig, but KubeDeck (like the CLI it drives) is built around named
 * contexts. In web mode we write a kubeconfig from the pod's service account — a single context
 * called "in-cluster" — so every existing code path works unchanged. The token is read from its
 * file on each use (`tokenFile`), so the kubelet's token rotation is picked up without a restart.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const IN_CLUSTER_CONTEXT = "in-cluster";
const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";

export function inClusterKubeconfig(opts: { host: string; port: string; caFile: string; tokenFile: string }): string {
  const host = opts.host.includes(":") && !opts.host.startsWith("[") ? `[${opts.host}]` : opts.host; // IPv6
  const q = (s: string) => JSON.stringify(s); // YAML-safe quoting
  return [
    "apiVersion: v1",
    "kind: Config",
    `current-context: ${IN_CLUSTER_CONTEXT}`,
    "clusters:",
    `- name: ${IN_CLUSTER_CONTEXT}`,
    "  cluster:",
    `    server: ${q(`https://${host}:${opts.port}`)}`,
    `    certificate-authority: ${q(opts.caFile)}`,
    "users:",
    "- name: serviceaccount",
    "  user:",
    `    tokenFile: ${q(opts.tokenFile)}`,
    "contexts:",
    `- name: ${IN_CLUSTER_CONTEXT}`,
    "  context:",
    `    cluster: ${IN_CLUSTER_CONTEXT}`,
    "    user: serviceaccount",
    "",
  ].join("\n");
}

/** When running in a pod with no kubeconfig of its own, point KUBECONFIG at one built from the service account. */
export function ensureInClusterKubeconfig(env: NodeJS.ProcessEnv = process.env): string | null {
  const host = env.KUBERNETES_SERVICE_HOST;
  if (!host || env.KUBECONFIG) return null;
  if (fs.existsSync(path.join(os.homedir(), ".kube", "config"))) return null;
  const tokenFile = path.join(SA_DIR, "token");
  const caFile = path.join(SA_DIR, "ca.crt");
  if (!fs.existsSync(tokenFile)) return null;
  const file = path.join(os.tmpdir(), "kubedeck-in-cluster.kubeconfig");
  fs.writeFileSync(file, inClusterKubeconfig({ host, port: env.KUBERNETES_SERVICE_PORT || "443", caFile, tokenFile }), { mode: 0o600 });
  env.KUBECONFIG = file;
  return file;
}
