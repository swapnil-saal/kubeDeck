/**
 * Projects, kept by the server (shared/projects.ts). Projects a browser kept before that are sent to
 * the server once, then removed from the browser.
 */
import { useQuery } from "@tanstack/react-query";
import { buildUrl } from "@shared/routes";
import { projectPaths, type Project, type SaveProjectInput } from "@shared/projects";
import { useInvalidatingMutation } from "@/hooks/use-invalidating-mutation";
import { requestJson } from "@/lib/request-json";

export { normalizeScopes, projectId, type Project, type ProjectScope } from "@shared/projects";

const PROJECTS = [projectPaths.list];
const OLD_KEY = "kubedeck.projects";

/** Hand this browser's old projects to the server, once; kept in the browser if that fails. */
async function moveBrowserProjects(): Promise<void> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(OLD_KEY); } catch { return; }
  if (!raw) return;
  let old: unknown;
  try { old = JSON.parse(raw); } catch { old = []; }
  const projects = (Array.isArray(old) ? old : [])
    .filter((p) => p && typeof p.name === "string" && Array.isArray(p.scopes) && p.scopes.length > 0)
    .map((p) => ({ name: String(p.name).slice(0, 80), description: typeof p.description === "string" ? p.description.slice(0, 300) : undefined, scopes: p.scopes, createdAt: typeof p.createdAt === "number" ? p.createdAt : undefined }));
  if (projects.length) await requestJson("POST", projectPaths.import, { projects });
  try { localStorage.removeItem(OLD_KEY); } catch { /* nothing to clean */ }
}

let moved: Promise<void> | null = null;

export function useProjects() {
  return useQuery({
    queryKey: PROJECTS,
    queryFn: async () => {
      moved ??= moveBrowserProjects().catch(() => { moved = null; });
      await moved;
      return (await requestJson<{ projects: Project[] }>("GET", projectPaths.list)).projects;
    },
    staleTime: 15_000,
  });
}

const projectUrl = (id: string) => buildUrl(projectPaths.one, { id });

export const useSaveProject = () =>
  useInvalidatingMutation(
    ({ id, ...v }: SaveProjectInput & { id?: string }) => requestJson<Project>(id ? "PUT" : "POST", id ? projectUrl(id) : projectPaths.list, v),
    [{ queryKey: PROJECTS }],
  );

export const useDeleteProject = () => useInvalidatingMutation((id: string) => requestJson("DELETE", projectUrl(id)), [{ queryKey: PROJECTS }]);
