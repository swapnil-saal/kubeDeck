import { useQuery } from "@tanstack/react-query";

/** Which pod (and container) the file browser reads from. */
export interface PodFilesTarget {
  pod: string;
  context: string;
  namespace: string;
  container?: string;
}

export interface FileEntry { name: string; dir: boolean }
export interface Listing { path: string; entries: FileEntry[]; truncated: boolean }
export interface FileContent { path: string; size: number; truncated: boolean; binary: boolean; text: string }
export interface SearchResult {
  mode: "content" | "name";
  path: string;
  q: string;
  results: { path: string; line?: number; text?: string }[];
  capped: boolean;
}

class FilesError extends Error {}

async function get<T>(t: PodFilesTarget, op: string, extra: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ context: t.context, namespace: t.namespace, ...(t.container ? { container: t.container } : {}), ...extra });
  const res = await fetch(`/api/k8s/pods/${encodeURIComponent(t.pod)}/files/${op}?${qs}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new FilesError((body as { message?: string }).message || `Request failed (${res.status})`);
  return body as T;
}

/** Link that downloads a file, or a folder as .tar.gz (streamed by the server; the browser saves it). */
export function downloadHref(t: PodFilesTarget, path: string, folder: boolean): string {
  const qs = new URLSearchParams({ context: t.context, namespace: t.namespace, ...(t.container ? { container: t.container } : {}), path, ...(folder ? { archive: "1" } : {}) });
  return `/api/k8s/pods/${encodeURIComponent(t.pod)}/files/download?${qs}`;
}

const key = (t: PodFilesTarget, ...rest: unknown[]) => ["pod-files", t.context, t.namespace, t.pod, t.container ?? "", ...rest];
// exec is not free: never retry a refusal, keep listings for a while
const opts = { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } as const;

export function usePodContainers(t: Omit<PodFilesTarget, "container">) {
  return useQuery({ queryKey: key(t, "containers"), queryFn: () => get<{ name: string; workingDir: string | null }[]>(t, "containers"), ...opts });
}

/** A folder; `path` undefined = the container's working directory. */
export function useFolder(t: PodFilesTarget, path: string | undefined, enabled = true) {
  return useQuery({
    queryKey: key(t, "list", path ?? "~"),
    queryFn: () => get<Listing>(t, "list", path ? { path } : {}),
    enabled: enabled && !!t.container,
    ...opts,
  });
}

export function useFile(t: PodFilesTarget, path: string | null) {
  return useQuery({ queryKey: key(t, "read", path), queryFn: () => get<FileContent>(t, "read", { path: path! }), enabled: !!path && !!t.container, ...opts });
}

export interface FileSearch {
  path: string;
  q: string;
  mode: "content" | "name";
  /** also search node_modules, .git, vendor… */
  all: boolean;
}

export function useFileSearch(t: PodFilesTarget, search: FileSearch | null) {
  return useQuery({
    queryKey: key(t, "search", search?.mode, search?.path, search?.q, search?.all),
    queryFn: () => get<SearchResult>(t, "search", { path: search!.path, q: search!.q, mode: search!.mode, ...(search!.all ? { all: "1" } : {}) }),
    enabled: !!search && !!t.container,
    ...opts,
  });
}
