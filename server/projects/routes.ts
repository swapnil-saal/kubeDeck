/**
 * Projects for everyone signed in: anyone lists and creates them; a project's creator or an admin
 * changes or deletes it. Nothing here touches a cluster.
 */
import type { Express, Request, Response } from "express";
import {
  importProjectsSchema,
  normalizeScopes,
  projectId,
  projectPaths,
  saveProjectSchema,
  type Project,
} from "@shared/projects";
import { permissionsFor } from "../web-mode";
import type { ProjectStore, StoredProject } from "./store";

const who = (req: Request) => req.kubedeckUser?.email || req.kubedeckUser?.name || "";
const mayEdit = (req: Request, p: StoredProject) =>
  permissionsFor(req.kubedeckUser).projects && (req.kubedeckUser?.role === "admin" || (p.createdBy !== "" && p.createdBy === who(req)));

function toProject(req: Request, p: StoredProject): Project {
  return {
    id: p.id,
    name: p.name,
    description: p.description || undefined,
    scopes: p.scopes,
    createdAt: Date.parse(p.createdAt) || 0,
    createdBy: p.createdBy,
    canEdit: mayEdit(req, p),
  };
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
const handle = (h: Handler) => (req: Request, res: Response) => {
  h(req, res).catch((err) => res.status(500).json({ message: err instanceof Error ? err.message : String(err) }));
};

export function registerProjectRoutes(app: Express, store: ProjectStore): void {
  /** the stored project in the path, or an answer saying why not */
  const editable = async (req: Request, res: Response): Promise<StoredProject | null> => {
    const p = (await store.all()).find((x) => x.id === String(req.params.id));
    if (!p) {
      res.status(404).json({ message: "No such project." });
      return null;
    }
    if (!mayEdit(req, p)) {
      res.status(403).json({ message: "Only its creator or an admin can change this project." });
      return null;
    }
    return p;
  };

  app.get(projectPaths.list, handle(async (req, res) => {
    res.json({ projects: (await store.all()).map((p) => toProject(req, p)) });
  }));

  app.post(projectPaths.list, handle(async (req, res) => {
    const parsed = saveProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid project." });
    const now = new Date().toISOString();
    const p: StoredProject = {
      id: projectId(parsed.data.name, (await store.all()).map((x) => x.id)),
      name: parsed.data.name,
      description: parsed.data.description ?? "",
      scopes: normalizeScopes(parsed.data.scopes),
      createdAt: now,
      createdBy: who(req),
      updatedAt: now,
    };
    await store.save(p);
    res.status(201).json(toProject(req, p));
  }));

  // before /:id, which would otherwise take "import" as an id
  app.post(projectPaths.import, handle(async (req, res) => {
    const parsed = importProjectsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid projects." });
    const existing = await store.all();
    let added = 0;
    for (const p of parsed.data.projects) {
      // the same browser sending again (another tab) adds nothing twice
      if (existing.some((x) => x.name === p.name && x.createdBy === who(req))) continue;
      const at = new Date(p.createdAt ?? Date.now()).toISOString();
      const row: StoredProject = {
        id: projectId(p.name, existing.map((x) => x.id)),
        name: p.name, description: p.description ?? "", scopes: normalizeScopes(p.scopes),
        createdAt: at, createdBy: who(req), updatedAt: new Date().toISOString(),
      };
      await store.save(row);
      existing.push(row);
      added++;
    }
    res.json({ added });
  }));

  app.put(projectPaths.one, handle(async (req, res) => {
    const parsed = saveProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid project." });
    const p = await editable(req, res);
    if (!p) return;
    const next: StoredProject = { ...p, name: parsed.data.name, description: parsed.data.description ?? "", scopes: normalizeScopes(parsed.data.scopes), updatedAt: new Date().toISOString() };
    await store.save(next);
    res.json(toProject(req, next));
  }));

  app.delete(projectPaths.one, handle(async (req, res) => {
    const p = await editable(req, res);
    if (!p) return;
    await store.remove(p.id);
    res.json({ ok: true });
  }));
}
