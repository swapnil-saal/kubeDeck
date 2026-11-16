/**
 * Who each kubectl call runs as, per cluster. In web mode, for the signed-in person:
 *
 *  1. the service account of the first of their KubeDeck groups that covers the cluster (Settings →
 *     Groups): one KubeDeck impersonates (`--as=system:serviceaccount:<ns>:<name>`), or the
 *     kubeconfig an admin uploaded for it (`--kubeconfig=<its file>`);
 *  2. otherwise, for a KubeDeck admin, KubeDeck's own credentials (so a new install works as soon as
 *     its first admin signs in);
 *  3. otherwise the person themselves, `--as=kubedeck:<email> --as-group=kubedeck:<group>…`, so the
 *     RBAC those names are bound to applies (KUBEDECK_ACCESS=shared turns this off: KubeDeck's own
 *     credentials then).
 *
 * The cluster is the call's `--context` (or the kubeconfig's current context). On the desktop every
 * call runs with the person's own kubeconfig.
 *
 * The identity rides on the request's async context (AsyncLocalStorage), so it reaches kubectl calls
 * made deep inside route handlers and the assistant's tools without being passed around. A kubectl
 * call with impersonation on but no request identity runs as system:anonymous: it fails closed,
 * never as the service account.
 */
import { AsyncLocalStorage } from "async_hooks";
import type { NextFunction, Request, Response } from "express";
import type { WebConfig, WebUser } from "./web-mode";

export interface Impersonation {
  user: string;
  groups: string[];
}

const store = new AsyncLocalStorage<Impersonation>();
/** The signed-in person (or the desktop's local user), whether or not impersonation is on. */
const people = new AsyncLocalStorage<WebUser>();

/** set by asKubeDeck(): KubeDeck itself, not a person, is asking */
const serverItself = new AsyncLocalStorage<true>();

let active: Pick<WebConfig, "impersonate" | "impersonatePrefix" | "impersonateGroupPrefix"> | null = null;

/** What one of a person's groups lets them act as on a cluster (see shared/groups.ts). */
export type ClusterGrant = { as: "serviceaccount"; namespace: string; serviceAccount: string } | { as: "credentials"; kubeconfig: string };
type GrantResolver = (person: WebUser, context: string) => ClusterGrant | undefined;
let grants: GrantResolver | null = null;
let defaultContext = "";

/**
 * Web mode, at startup: how to find a person's grant on a cluster (from their groups), and the
 * kubeconfig's current context, which a call without `--context` goes to.
 */
export function setClusterGrants(resolve: GrantResolver | null, currentContext = ""): void {
  grants = resolve;
  defaultContext = currentContext;
}

/** Called once at startup with the web config (null on the desktop). */
export function setImpersonation(c: typeof active) {
  active = c?.impersonate ? c : null;
}

/** The Kubernetes identity for a signed-in user, per the configured claim and prefixes. */
export function identityFor(user: WebUser, c: NonNullable<typeof active>): Impersonation {
  const name = user.email || user.name;
  return {
    user: `${c.impersonatePrefix}${name}`,
    groups: user.groups.map((g) => `${c.impersonateGroupPrefix}${g}`),
  };
}

/** Express middleware (after the login gate): run the rest of the request as this user. */
export function bindIdentity(req: Request, _res: Response, next: NextFunction): void {
  const user = req.kubedeckUser;
  if (!user) return next();
  people.run(user, () => (active ? store.run(identityFor(user, active), next) : next()));
}

/**
 * Who the current request is for, with their KubeDeck groups (unprefixed): web mode's signed-in
 * person, the desktop's local user; undefined outside a request. It is set
 * when KUBEDECK_ACCESS=shared too, so features limited to groups work in every mode.
 */
export function currentPerson(): WebUser | undefined {
  return people.getStore();
}

/**
 * A key that differs whenever two requests may get different answers from a cluster: the person and
 * their groups ("" outside a request, and on the desktop's single user that is fine too).
 */
export function identityKey(): string {
  const p = people.getStore();
  return p ? `${p.email || p.name}|${p.groups.join(",")}` : "";
}

/**
 * Run `fn` with KubeDeck's own credentials, as no person. Only for what KubeDeck checks about
 * itself (whom a kubeconfig context authenticates as, for an admin); never with a request's input
 * beyond a validated context name.
 */
export function asKubeDeck<T>(fn: () => T): T {
  return serverItself.run(true, fn);
}

/** The cluster a kubectl call goes to: its last `--context` (as kubectl reads it), else the current context. */
export function contextOf(args: string[]): string {
  let ctx = "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") break;
    if (a.startsWith("--context=")) ctx = a.slice("--context=".length);
    else if (a === "--context" && i + 1 < args.length) ctx = args[++i];
  }
  return ctx || defaultContext;
}

/** The identity flags for a kubectl call to `context`: `--as…`, an uploaded `--kubeconfig`, or none (KubeDeck's own). */
export function impersonationFlags(context = defaultContext): string[] {
  if (serverItself.getStore()) return [];
  const person = people.getStore();
  const grant = person && grants ? grants(person, context) : undefined;
  if (grant?.as === "credentials") return [`--kubeconfig=${grant.kubeconfig}`];
  if (grant?.as === "serviceaccount") return [`--as=system:serviceaccount:${grant.namespace}:${grant.serviceAccount}`];
  if (grants && person?.role === "admin") return [];
  if (!active) return [];
  const id = store.getStore();
  if (!id) return ["--as=system:anonymous"];
  // with explicit groups Kubernetes no longer adds system:authenticated, which discovery needs
  const groups = [...new Set([...id.groups, "system:authenticated"])];
  return [`--as=${id.user}`, ...groups.map((g) => `--as-group=${g}`)];
}

const isKubectl = (cmd: string) => /(^|\/)kubectl(\.exe)?$/.test(cmd);

/**
 * Arguments for spawning `cmd`, with the request's identity added when `cmd` is kubectl, or runs
 * kubectl (xargs kubectl …). Every place that spawns kubectl goes through this.
 */
export function asUser(cmd: string, args: string[]): string[] {
  const runsKubectl = isKubectl(cmd) || (/(^|\/)xargs$/.test(cmd) && args.some(isKubectl));
  if (!runsKubectl) return args;
  const flags = impersonationFlags(contextOf(args));
  if (flags.length === 0) return args;
  // `kubectl exec pod -- cmd`: whatever follows "--" belongs to the container, so the flags go before it
  const dashes = args.indexOf("--");
  return dashes < 0 ? [...args, ...flags] : [...args.slice(0, dashes), ...flags, ...args.slice(dashes)];
}
