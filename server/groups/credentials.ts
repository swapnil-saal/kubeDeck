/**
 * Kubeconfigs an admin uploads for a group on one cluster. Only what cannot run anything is accepted:
 * a token or an inline client certificate, an inline CA. Exec plugins, auth providers and file paths
 * are refused (an exec plugin would run a program on this server). What is kept is rewritten into a
 * one-context kubeconfig named after KubeDeck's context, so `--context=<name>` still selects it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { parse, stringify } from "yaml";
import { asKubeDeck } from "../identity";
import { spawnCommand } from "../kubectl-run";
import { getKubeconfigEnv } from "../settings";

export class CredentialsError extends Error {}

/* eslint-disable @typescript-eslint/no-explicit-any */
const named = (list: unknown, name: string): any => (Array.isArray(list) ? list.find((x: any) => x?.name === name) : undefined);

const REFUSED_USER_FIELDS: Record<string, string> = {
  exec: "an exec plugin (it would run a program on the KubeDeck server)",
  "auth-provider": "an auth provider",
  tokenFile: "a token file path",
  "client-certificate": "a client certificate file path",
  "client-key": "a client key file path",
  username: "a username and password",
  password: "a username and password",
  as: "impersonation",
  "as-groups": "impersonation",
  "as-uid": "impersonation",
  "as-user-extra": "impersonation",
};

/** The uploaded text as a minimal kubeconfig for `context`, and its API server; throws a readable CredentialsError. */
export function normalizeKubeconfig(text: string, context: string): { yaml: string; server: string } {
  let doc: any;
  try { doc = parse(text); } catch { throw new CredentialsError("That is not a kubeconfig: it is not valid YAML."); }
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.contexts)) throw new CredentialsError("That is not a kubeconfig: it has no contexts.");

  const ctxName = doc.contexts.length === 1 ? doc.contexts[0]?.name : doc["current-context"];
  const ctx = named(doc.contexts, ctxName)?.context;
  if (!ctx) throw new CredentialsError("The kubeconfig has several contexts and no current-context: keep only the one to use.");
  const cluster = named(doc.clusters, ctx.cluster)?.cluster;
  const user = named(doc.users, ctx.user)?.user;
  if (!cluster?.server || typeof cluster.server !== "string") throw new CredentialsError("The kubeconfig's cluster has no server address.");
  if (!user || typeof user !== "object") throw new CredentialsError("The kubeconfig's context names no user.");

  for (const [field, what] of Object.entries(REFUSED_USER_FIELDS)) {
    if (user[field] !== undefined) throw new CredentialsError(`The kubeconfig uses ${what}. Upload one with a service account token instead.`);
  }
  if (cluster["certificate-authority"] !== undefined) throw new CredentialsError("The kubeconfig points at a CA file: use certificate-authority-data instead.");
  if (cluster["proxy-url"] !== undefined) throw new CredentialsError("Kubeconfigs with a proxy-url are not accepted.");

  const hasToken = typeof user.token === "string" && user.token.trim() !== "";
  const hasCert = typeof user["client-certificate-data"] === "string" && typeof user["client-key-data"] === "string";
  if (!hasToken && !hasCert) throw new CredentialsError("The kubeconfig's user has no token or client certificate.");

  const keepCluster: Record<string, unknown> = { server: cluster.server };
  for (const k of ["certificate-authority-data", "insecure-skip-tls-verify", "tls-server-name"]) if (cluster[k] !== undefined) keepCluster[k] = cluster[k];
  const keepUser: Record<string, unknown> = hasToken ? { token: user.token.trim() } : { "client-certificate-data": user["client-certificate-data"], "client-key-data": user["client-key-data"] };
  const keepContext: Record<string, unknown> = { cluster: context, user: context };
  if (typeof ctx.namespace === "string" && ctx.namespace) keepContext.namespace = ctx.namespace;

  const yaml = stringify({
    apiVersion: "v1",
    kind: "Config",
    clusters: [{ name: context, cluster: keepCluster }],
    users: [{ name: context, user: keepUser }],
    contexts: [{ name: context, context: keepContext }],
    "current-context": context,
  });
  return { yaml, server: cluster.server };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Where decrypted kubeconfigs live while KubeDeck runs: a folder only this process's user can open. */
let dir: string | null = null;
const folder = () => (dir ??= mkdtempSync(path.join(os.tmpdir(), "kubedeck-credentials-")));

/** Write a kubeconfig for kubectl to read (mode 600); the same key overwrites its file. */
export function writeCredentialsFile(key: string, yaml: string): string {
  const file = path.join(folder(), `${key.replace(/[^\w.-]/g, "_")}.yaml`);
  writeFileSync(file, yaml, { mode: 0o600 });
  return file;
}

/** Remove every written kubeconfig (on stop, and before writing them again). */
export function clearCredentialsFiles(): void {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
}

/**
 * Whom a kubeconfig signs in as (`kubectl auth whoami`). Throws when the cluster refuses the
 * credentials; "" when it could not say (unreachable, or too old for whoami), which does not stop a save.
 */
export async function identityOf(file: string, context: string): Promise<string> {
  const r = await asKubeDeck(() => spawnCommand("kubectl", ["auth", "whoami", "-o", "json", "--request-timeout=8s", `--kubeconfig=${file}`, `--context=${context}`], getKubeconfigEnv()));
  if (r.code === 0) {
    try { return String(JSON.parse(r.stdout)?.status?.userInfo?.username ?? ""); } catch { return ""; }
  }
  if (/unauthorized|provide credentials/i.test(r.stderr)) throw new CredentialsError("The cluster refused these credentials (the token may be expired or revoked).");
  return "";
}
