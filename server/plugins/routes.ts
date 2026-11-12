/**
 * Settings → Plugins. Everyone signed in sees which plugins are on and their status; only someone who
 * may manage plugins (a KubeDeck admin, or the desktop's own user) sees settings and changes them.
 */
import type { Express, Request, Response } from "express";
import { pluginCreateSchema, pluginPaths, pluginUpdateSchema, type PluginList } from "@shared/plugins";
import { addableKinds, createPlugin, getPlugin, listPlugins, PluginError, removePlugin, testPlugin, updatePlugin } from "./manager";

const canManage = (req: Request) => req.kubedeckUser?.role === "admin";
const who = (req: Request) => req.kubedeckUser?.email || req.kubedeckUser?.name || "unknown";

function fail(res: Response, err: unknown): void {
  if (err instanceof PluginError) return void res.status(err.status).json({ message: err.message });
  res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
}

/** Run a change only for someone who may manage plugins, answering any error with its own status. */
const managed = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  if (!canManage(req)) return void res.status(403).json({ message: "Only a KubeDeck admin can change plugins." });
  handler(req, res).catch((err) => fail(res, err));
};

export function registerPluginRoutes(app: Express): void {
  app.get(pluginPaths.list, (req, res) => {
    const manage = canManage(req);
    listPlugins(manage).then(
      (plugins) => res.json({ plugins, canManage: manage, addable: manage ? (addableKinds() as PluginList["addable"]) : [] } satisfies PluginList),
      (err) => fail(res, err),
    );
  });

  app.get(pluginPaths.one, (req, res) => {
    getPlugin(String(req.params.id), canManage(req)).then((p) => res.json(p), (err) => fail(res, err));
  });

  app.post(pluginPaths.list, managed(async (req, res) => {
    const parsed = pluginCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid plugin." });
    res.status(201).json(await createPlugin(parsed.data.kind, parsed.data.name, parsed.data.values, who(req)));
  }));

  app.put(pluginPaths.one, managed(async (req, res) => {
    const parsed = pluginUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid settings." });
    res.json(await updatePlugin(String(req.params.id), parsed.data, who(req)));
  }));

  app.post(pluginPaths.test, managed(async (req, res) => {
    res.json(await testPlugin(String(req.params.id)));
  }));

  app.delete(pluginPaths.one, managed(async (req, res) => {
    await removePlugin(String(req.params.id), who(req));
    res.json({ ok: true });
  }));
}
