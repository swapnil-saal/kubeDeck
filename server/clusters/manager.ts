/**
 * The clusters an admin added, and KubeDeck's own connection to each as a private kubeconfig file
 * that kubectl reads (`--kubeconfig=<file>`). An uploaded kubeconfig is checked when it is added,
 * stored encrypted, and decrypted into its file at start; the pod's own service account is written
 * as a kubeconfig that reads its rotating token file.
 */
import type { ClusterInfo } from "@shared/clusters";
import { emit } from "../events";
import { podServiceAccountKubeconfig } from "../incluster";
import { clearCredentialsFiles, CredentialsError, checkKubeconfig, normalizeKubeconfig, writeCredentialsFile } from "../kubeconfig-files";
import { decrypt, encrypt, secretKey } from "../secrets";
import type { ClusterStore, StoredCluster } from "./store";

export class ClusterError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const SCOPE = "clusters";
let store: ClusterStore | null = null;
let clusters: StoredCluster[] = [];
let key: Buffer | null = null;
const files = new Map<string, string>();

/** The kubeconfig text a stored cluster connects with, or null when it cannot be read. */
function kubeconfigOf(c: StoredCluster): string | null {
  if (c.source === "in-cluster") return podServiceAccountKubeconfig(c.name);
  try { return decrypt(c.credentials, key!); } catch { return null; }
}

function writeFiles(): void {
  clearCredentialsFiles(SCOPE);
  files.clear();
  for (const c of clusters) {
    const yaml = kubeconfigOf(c);
    if (yaml) files.set(c.name, writeCredentialsFile(SCOPE, c.name, yaml));
    else console.warn(`[kubedeck] Cluster ${c.name}: its connection cannot be read (${c.source === "in-cluster" ? "not running in that cluster" : "was KUBEDECK_AUTH_SECRET changed?"}). Upload a new kubeconfig for it in Settings → Clusters.`);
  }
}

export async function startClusters(s: ClusterStore, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  store = s;
  key = secretKey(env, undefined, "clusters");
  clusters = await s.all();
  writeFiles();
}

export function stopClusters(): void {
  store = null;
  clusters = [];
  files.clear();
  clearCredentialsFiles(SCOPE);
}

const need = (): ClusterStore => {
  if (!store) throw new ClusterError(503, "Clusters need KubeDeck's database.");
  return store;
};

export const clusterNames = (): string[] => clusters.map((c) => c.name);
export const inClusterAvailable = (): boolean => podServiceAccountKubeconfig("probe") !== null;

/** KubeDeck's own kubeconfig file for a cluster (one context, named like the cluster), or undefined. */
export const clusterFile = (name: string): string | undefined => files.get(name);

export function listClusters(usedBy: (name: string) => string[]): ClusterInfo[] {
  return clusters.map((c) => ({ name: c.name, source: c.source, identity: c.identity, server: c.server, usedBy: usedBy(c.name) }));
}

/** Check a connection and seal it: what it signs in as, and its API server. */
async function connect(name: string, source: StoredCluster["source"], uploaded?: string): Promise<StoredCluster> {
  try {
    let yaml: string;
    let server = "";
    let credentials = "";
    if (source === "in-cluster") {
      const own = podServiceAccountKubeconfig(name);
      if (!own) throw new ClusterError(400, "KubeDeck is not running inside a Kubernetes cluster, so it has no service account of its own to use.");
      yaml = own;
      server = "this cluster";
    } else {
      ({ yaml, server } = normalizeKubeconfig(uploaded ?? "", name));
      credentials = encrypt(yaml, key!);
    }
    const identity = await checkKubeconfig(SCOPE, yaml, name);
    return { name, source, credentials, identity, server };
  } catch (err) {
    if (err instanceof CredentialsError) throw new ClusterError(400, err.message);
    throw err;
  }
}

async function reload(name: string, change: "added" | "updated" | "removed", by: string): Promise<void> {
  clusters = await need().all();
  writeFiles();
  emit("cluster.changed", { name, change, by });
}

export async function addCluster(name: string, source: StoredCluster["source"], kubeconfig: string | undefined, by: string): Promise<void> {
  const s = need();
  if (clusters.some((c) => c.name === name)) throw new ClusterError(409, `A cluster named ${name} already exists.`);
  await s.save(await connect(name, source, kubeconfig), by);
  await reload(name, "added", by);
}

/** A new kubeconfig for a cluster's connection (an expired token, a rotated certificate). */
export async function replaceConnection(name: string, kubeconfig: string, by: string): Promise<void> {
  const s = need();
  if (!clusters.some((c) => c.name === name)) throw new ClusterError(404, `No cluster named ${name}.`);
  await s.save(await connect(name, "kubeconfig", kubeconfig), by);
  await reload(name, "updated", by);
}

/** Refused while a group still uses the cluster. */
export async function removeCluster(name: string, usedBy: string[], by: string): Promise<void> {
  const s = need();
  if (!clusters.some((c) => c.name === name)) throw new ClusterError(404, `No cluster named ${name}.`);
  if (usedBy.length) throw new ClusterError(409, `${usedBy.join(", ")} still ${usedBy.length === 1 ? "uses" : "use"} ${name}. Remove it from ${usedBy.length === 1 ? "that group" : "those groups"} first.`);
  await s.remove(name);
  await reload(name, "removed", by);
}
