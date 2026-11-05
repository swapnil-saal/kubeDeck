/**
 * Per-user access in web mode: with KUBEDECK_ACCESS=impersonate, every kubectl call made for a
 * request carries `--as=<user> --as-group=<group>…` for the person the login proxy signed in, so the
 * API server applies that person's own RBAC. KubeDeck's service account then needs only `impersonate`.
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

let active: Pick<WebConfig, "impersonate" | "impersonateUser" | "impersonatePrefix" | "impersonateGroupPrefix"> | null = null;

/** Called once at startup with the web config (null on the desktop). */
export function setImpersonation(c: typeof active) {
  active = c?.impersonate ? c : null;
}

/** The Kubernetes identity for a signed-in user, per the configured claim and prefixes. */
export function identityFor(user: WebUser, c: NonNullable<typeof active>): Impersonation {
  const name = c.impersonateUser === "name" ? user.name : user.email || user.name;
  return {
    user: `${c.impersonatePrefix}${name}`,
    groups: user.groups.map((g) => `${c.impersonateGroupPrefix}${g}`),
  };
}

/** Express middleware (after the login gate): run the rest of the request as this user. */
export function bindIdentity(req: Request, _res: Response, next: NextFunction): void {
  if (!active || !req.kubedeckUser) return next();
  store.run(identityFor(req.kubedeckUser, active), next);
}

/** The current request's identity (for cache keys); undefined when not impersonating. */
export function currentIdentity(): Impersonation | undefined {
  return active ? store.getStore() : undefined;
}

/** `--as` flags for a kubectl invocation, or none when impersonation is off. */
export function impersonationFlags(): string[] {
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
  const flags = impersonationFlags();
  if (flags.length === 0) return args;
  // `kubectl exec pod -- cmd`: whatever follows "--" belongs to the container, so the flags go before it
  const dashes = args.indexOf("--");
  return dashes < 0 ? [...args, ...flags] : [...args.slice(0, dashes), ...flags, ...args.slice(dashes)];
}
