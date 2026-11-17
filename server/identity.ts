/**
 * Who each kubectl call runs as.
 *
 * On the desktop: the person's own kubeconfig, with no flags added.
 *
 * In web mode, KubeDeck reads no kubeconfig from the server's disk. A call to a cluster runs as the
 * service accounts the person's KubeDeck groups have on that cluster (Settings → Groups), in the
 * groups' order: one impersonated through the cluster's connection (Settings → Clusters,
 * `--kubeconfig=<cluster's file> --as=system:serviceaccount:<ns>:<name>`), or a group's uploaded
 * kubeconfig (`--kubeconfig=<its file>`). When the cluster answers Forbidden the next is tried
 * (spawnCommand does this), so a person may do whatever ANY of their service accounts may. A person
 * none of whose groups covers the cluster (admins too) gets no access: the call is refused before
 * kubectl runs.
 *
 * The cluster is the call's `--context`. The identity rides on the request's async context
 * (AsyncLocalStorage), so it reaches kubectl calls made deep inside route handlers and the
 * assistant's tools without being passed around. A call outside a request has no person and so no
 * access: it fails closed.
 */
import { AsyncLocalStorage } from "async_hooks";
import type { NextFunction, Request, Response } from "express";
import type { WebUser } from "./web-mode";

/** The signed-in person (or the desktop's local user). */
const people = new AsyncLocalStorage<WebUser>();
/** set by asKubeDeck(): KubeDeck itself, not a person, is asking */
const serverItself = new AsyncLocalStorage<true>();
/** set by asEachIdentity(): this one identity only */
const pinned = new AsyncLocalStorage<string[]>();

/** What one of a person's groups lets them act as on a cluster (see shared/groups.ts). */
export type ClusterGrant =
  | { as: "serviceaccount"; kubeconfig: string; namespace: string; serviceAccount: string }
  | { as: "credentials"; kubeconfig: string };
type GrantResolver = (person: WebUser, context: string) => ClusterGrant[];
let grants: GrantResolver | null = null;
let clustersOf: ((person: WebUser) => string[]) | null = null;

/**
 * Flags that leave kubectl with no cluster at all: what a call gets when the person has no identity
 * on its cluster. spawnCommand answers such a call itself, without running kubectl.
 */
export const NO_ACCESS = ["--kubeconfig=/dev/null"];

/**
 * Web mode, at startup: how to find a person's grants on a cluster (from their groups, in order) and
 * which clusters they can reach at all. Never set on the desktop.
 */
export function setClusterGrants(resolve: GrantResolver | null, reachable: ((person: WebUser) => string[]) | null = null): void {
  grants = resolve;
  clustersOf = reachable;
}

/** Express middleware (after the login gate): run the rest of the request as this person. */
export function bindIdentity(req: Request, _res: Response, next: NextFunction): void {
  const user = req.kubedeckUser;
  if (!user) return next();
  people.run(user, next);
}

/** Who the current request is for, with their KubeDeck groups: web mode's signed-in person, the desktop's local user. */
export function currentPerson(): WebUser | undefined {
  return people.getStore();
}

/** Web mode: the clusters the current person's groups give them, in name order; null on the desktop (its kubeconfig decides). */
export function visibleClusters(): string[] | null {
  if (!grants) return null;
  const person = people.getStore();
  return person && clustersOf ? clustersOf(person) : [];
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
 * Run `fn` as KubeDeck itself, as no person: no identity flags are added, so each call must name its
 * connection (`--kubeconfig=<file>`). Only for what KubeDeck checks about a connection or a cluster for
 * an admin; never with a request's input beyond validated names.
 */
export function asKubeDeck<T>(fn: () => T): T {
  return serverItself.run(true, fn);
}

/** The cluster a kubectl call goes to: its last `--context`, as kubectl reads it ("" when it has none). */
export function contextOf(args: string[]): string {
  let ctx = "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") break;
    if (a.startsWith("--context=")) ctx = a.slice("--context=".length);
    else if (a === "--context" && i + 1 < args.length) ctx = args[++i];
  }
  return ctx;
}

const grantFlags = (g: ClusterGrant): string[] =>
  g.as === "credentials" ? [`--kubeconfig=${g.kubeconfig}`] : [`--kubeconfig=${g.kubeconfig}`, `--as=system:serviceaccount:${g.namespace}:${g.serviceAccount}`];

/**
 * Every identity a kubectl call to `context` may run as, in the order they are tried. Never empty:
 * `[]` = no flags (the desktop's kubeconfig, or KubeDeck itself naming its own connection);
 * NO_ACCESS = none (web mode, no group of the person's covers the cluster).
 */
export function identityChoices(context: string): string[][] {
  if (serverItself.getStore()) return [[]];
  const only = pinned.getStore();
  if (only) return [only];
  if (!grants) return [[]];
  const person = people.getStore();
  const choices = person ? grants(person, context).map(grantFlags) : [];
  const seen = new Set<string>();
  const unique = choices.filter((c) => { const k = c.join(" "); if (seen.has(k)) return false; seen.add(k); return true; });
  return unique.length ? unique : [NO_ACCESS];
}

/** The identity flags a kubectl call to `context` starts with (the first choice). */
export function impersonationFlags(context: string): string[] {
  return identityChoices(context)[0];
}

/** Run `fn` once per identity the current person has on `context`, each time as that identity only. */
export function asEachIdentity<T>(context: string, fn: () => Promise<T>): Promise<T[]> {
  return Promise.all(identityChoices(context).map((flags) => pinned.run(flags, fn)));
}

const isKubectl = (cmd: string) => /(^|\/)kubectl(\.exe)?$/.test(cmd);

/**
 * Arguments for spawning `cmd`, with the request's identity added when `cmd` is kubectl, or runs
 * kubectl (xargs kubectl …). Every place that spawns kubectl goes through this.
 */
export function asUser(cmd: string, args: string[], choice = 0): string[] {
  const all = asUserChoices(cmd, args);
  return all[Math.min(choice, all.length - 1)];
}

/** Arguments for `cmd` as each identity the person has on the call's cluster, in the order to try them. */
export function asUserChoices(cmd: string, args: string[]): string[][] {
  const runsKubectl = isKubectl(cmd) || (/(^|\/)xargs$/.test(cmd) && args.some(isKubectl));
  if (!runsKubectl) return [args];
  // `kubectl exec pod -- cmd`: whatever follows "--" belongs to the container, so the flags go before it
  const dashes = args.indexOf("--");
  return identityChoices(contextOf(args)).map((flags) =>
    flags.length === 0 ? args : dashes < 0 ? [...args, ...flags] : [...args.slice(0, dashes), ...flags, ...args.slice(dashes)]);
}

/** True when these arguments carry NO_ACCESS: the person has no identity on that cluster. */
export const hasNoAccess = (args: string[]): boolean => args.includes(NO_ACCESS[0]);
