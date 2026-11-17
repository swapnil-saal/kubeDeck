/**
 * Kubeconfigs an admin uploads (a cluster's connection, a group's service account on a cluster). Only what cannot run anything is accepted:
 * a token or an inline client certificate, an inline CA. Exec plugins, auth providers and file paths
 * are refused (an exec plugin would run a program on this server). What is kept is rewritten into a
 * one-context kubeconfig named after KubeDeck's context, so `--context=<name>` still selects it.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import os from "os";
import path from "path";
import { parse, stringify } from "yaml";
import { asKubeDeck } from "./identity";
import { spawnCommand } from "./kubectl-run";
import { getKubeconfigEnv } from "./settings";

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

  // one context: that one; several: the one named like KubeDeck's cluster, else the current one
  const ctxName = doc.contexts.length === 1 ? doc.contexts[0]?.name : named(doc.contexts, context) ? context : doc["current-context"];
  const ctx = named(doc.contexts, ctxName)?.context;
  if (!ctx) throw new CredentialsError(`The kubeconfig has several contexts and none is named ${context} or current: keep only the one to use.`);
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

/**
 * Where decrypted kubeconfigs live while KubeDeck runs: one folder per owner ("clusters", "groups"),
 * only this process's user can open it. Folders carry the pid, are removed when the process exits, and
 * folders of processes that are gone (killed, crashed) are swept when the first one is made.
 */
const dirs = new Map<string, string>();
const FOLDER = /^kubedeck-(?:clusters|groups)-(\d+)-/;

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === "EPERM"; }
};

function sweepLeftovers(): void {
  let names: string[] = [];
  try { names = readdirSync(os.tmpdir()); } catch { return; }
  for (const name of names) {
    const pid = Number(FOLDER.exec(name)?.[1]);
    if (pid && pid !== process.pid && !alive(pid)) rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
  }
}

const removeAll = () => { for (const scope of [...dirs.keys()]) clearCredentialsFiles(scope); };
let guarded = false;
function guardExit(): void {
  if (guarded) return;
  guarded = true;
  sweepLeftovers();
  process.once("exit", removeAll);
  // once: the handler is gone before it re-sends the signal, so the default (terminate) still happens
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(sig, () => { removeAll(); process.kill(process.pid, sig); });
}

const folder = (scope: string) => {
  let dir = dirs.get(scope);
  if (!dir) {
    guardExit();
    dir = mkdtempSync(path.join(os.tmpdir(), `kubedeck-${scope}-${process.pid}-`));
    dirs.set(scope, dir);
  }
  return dir;
};

/** Write a kubeconfig for kubectl to read (mode 600); the same scope and key overwrite its file. */
export function writeCredentialsFile(scope: string, key: string, yaml: string): string {
  const file = path.join(folder(scope), `${key.replace(/[^\w.-]/g, "_")}.yaml`);
  writeFileSync(file, yaml, { mode: 0o600 });
  return file;
}

/** identityOf on a kubeconfig not yet kept: its file exists only while the check runs. */
export async function checkKubeconfig(scope: string, yaml: string, context: string): Promise<string> {
  const file = writeCredentialsFile(scope, `check-${randomUUID()}`, yaml);
  try { return await identityOf(file, context); } finally { rmSync(file, { force: true }); }
}

/** Remove every kubeconfig one owner wrote (on stop, and before writing them again). */
export function clearCredentialsFiles(scope: string): void {
  const dir = dirs.get(scope);
  if (dir) rmSync(dir, { recursive: true, force: true });
  dirs.delete(scope);
}

/**
 * Whom a kubeconfig signs in as (`kubectl auth whoami`). Throws when the cluster refuses the
 * credentials; "" when it could not say (unreachable, or too old for whoami), which does not stop a save.
 */
const UNREACHABLE = /was refused|connection refused|i\/o timeout|no such host|network is unreachable|no route to host|Client\.Timeout|deadline exceeded/i;

function kubectlSays(stderr: string): string {
  const line = stderr.split("\n").map((l) => l.trim()).find(Boolean) ?? "no output";
  return line.replace(/^error:\s*/i, "").slice(0, 240);
}

/**
 * Who the cluster says these credentials are. Throws unless the cluster accepted them; a cluster that
 * does not answer gives "" (not checked), anything else wrong with the file is refused.
 */
export async function identityOf(file: string, context: string): Promise<string> {
  const run = (args: string[]) => asKubeDeck(() => spawnCommand("kubectl", [...args, "--request-timeout=8s", `--kubeconfig=${file}`, `--context=${context}`], getKubeconfigEnv()));
  let r = await run(["auth", "whoami", "-o", "json"]);
  if (r.code === 0) {
    try { return String(JSON.parse(r.stdout)?.status?.userInfo?.username ?? ""); } catch { return ""; }
  }
  // clusters older than 1.28 have no whoami: any authenticated request proves the credentials
  if (/could not find the requested resource|the server doesn't have a resource type/i.test(r.stderr)) {
    r = await run(["get", "--raw", "/api"]);
    if (r.code === 0) return "";
  }
  const err = r.stderr;
  if (/forbidden/i.test(err)) return "";
  if (UNREACHABLE.test(err)) return "";
  if (/unauthorized|provide credentials/i.test(err)) throw new CredentialsError("The cluster refused these credentials (the token may be expired, revoked or cut short).");
  if (/error loading config|illegal base64|unable to load root certificates|invalid configuration|yaml:/i.test(err)) {
    throw new CredentialsError(`This kubeconfig is incomplete or damaged: ${kubectlSays(err)}. Paste the whole file, unchanged.`);
  }
  if (/x509|certificate/i.test(err)) throw new CredentialsError(`The cluster's certificate does not match this kubeconfig: ${kubectlSays(err)}.`);
  throw new CredentialsError(`kubectl could not use this kubeconfig: ${kubectlSays(err)}.`);
}
