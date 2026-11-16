/**
 * Settings → Groups (web mode, admins only). Membership lives on each account (server/auth); these
 * routes define the groups and what each acts as per cluster.
 */
import type { Express, Request, Response } from "express";
import {
  createGroupSchema,
  groupOrderSchema,
  groupPaths,
  updateGroupSchema,
  type GroupList,
  type ServiceAccountsInfo,
} from "@shared/groups";
import { asKubeDeck } from "../identity";
import { spawnCommand } from "../kubectl-run";
import { findInvalidParam } from "../security";
import { getKubeconfigEnv } from "../settings";
import { createGroup, deleteGroup, GroupError, listGroups, reorderGroups, updateGroup } from "./manager";

export interface GroupRouteDeps {
  /** how many accounts carry this group */
  members(id: string): Promise<number>;
  userPrefix: string;
  groupPrefix: string;
}

const who = (req: Request) => req.kubedeckUser?.email || req.kubedeckUser?.name || "unknown";

function fail(res: Response, err: unknown): void {
  if (err instanceof GroupError) return void res.status(err.status).json({ message: err.message });
  res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
}

const adminOnly = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  if (req.kubedeckUser?.role !== "admin") return void res.status(403).json({ message: "Only a KubeDeck admin can manage groups." });
  handler(req, res).catch((err) => fail(res, err));
};

const lastLine = (text: string) => (text.trim().split("\n").pop() || "").slice(0, 300);

/** A namespace's service accounts and whether KubeDeck may impersonate them, both as KubeDeck itself. */
async function serviceAccountsOf(context: string, namespace: string): Promise<ServiceAccountsInfo> {
  const env = getKubeconfigEnv();
  const where = [`--context=${context}`, "-n", namespace, "--request-timeout=10s"];
  const [list, can] = await asKubeDeck(() => Promise.all([
    spawnCommand("kubectl", ["get", "serviceaccounts", "-o", "jsonpath={.items[*].metadata.name}", ...where], env),
    spawnCommand("kubectl", ["auth", "can-i", "impersonate", "serviceaccounts", ...where], env),
  ]));
  const canImpersonate = can.stdout.trim() === "yes";
  if (list.code !== 0) {
    const forbidden = /forbidden/i.test(list.stderr);
    return { context, namespace, canImpersonate, listError: forbidden ? `KubeDeck's credentials for ${context} may not list service accounts in ${namespace}.` : lastLine(list.stderr) || "The cluster did not answer." };
  }
  return { context, namespace, canImpersonate, names: list.stdout.trim().split(/\s+/).filter(Boolean).sort() };
}

export function registerGroupRoutes(app: Express, deps: GroupRouteDeps): void {
  const list = (): GroupList => ({ groups: listGroups(), userPrefix: deps.userPrefix, groupPrefix: deps.groupPrefix });

  app.get(groupPaths.list, adminOnly(async (_req, res) => res.json(list())));

  app.post(groupPaths.list, adminOnly(async (req, res) => {
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid group." });
    res.status(201).json(await createGroup(parsed.data, who(req)));
  }));

  // before /:id, which would otherwise take "order" as an id
  app.put(groupPaths.order, adminOnly(async (req, res) => {
    const parsed = groupOrderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid order." });
    await reorderGroups(parsed.data.ids, who(req));
    res.json(list());
  }));

  app.get(groupPaths.serviceAccounts, adminOnly(async (req, res) => {
    const context = String(req.params.context);
    const namespace = typeof req.query.namespace === "string" ? req.query.namespace : "";
    if (findInvalidParam({ context, namespace }) || !namespace || namespace === "all") return res.status(400).json({ message: "Pick a cluster and a namespace." });
    res.json(await serviceAccountsOf(context, namespace));
  }));

  app.patch(groupPaths.one, adminOnly(async (req, res) => {
    const parsed = updateGroupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid group." });
    res.json(await updateGroup(String(req.params.id), parsed.data, who(req)));
  }));

  app.delete(groupPaths.one, adminOnly(async (req, res) => {
    const id = String(req.params.id);
    await deleteGroup(id, await deps.members(id), who(req));
    res.json({ ok: true });
  }));
}
