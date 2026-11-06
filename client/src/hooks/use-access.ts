import { useCallback, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api, buildUrl, type Access } from "@shared/routes";
import { allowed } from "@/lib/access";

const storageKey = (context: string, namespace: string) => `kubedeck:access:${context}|${namespace}`;

/**
 * The last answer for this context and namespace, kept for the browser session: a reload or a
 * namespace switch shows the right menus at once instead of everything first and then less.
 */
function remembered(context: string, namespace: string): { data: Access; at: number } | undefined {
  try {
    const raw = sessionStorage.getItem(storageKey(context, namespace));
    if (!raw) return undefined;
    const { data, at } = JSON.parse(raw);
    return { data: api.k8s.access.responses[200].parse(data), at: Number(at) || 0 };
  } catch {
    return undefined;
  }
}

/** Keep the answer for the session. Best effort: without storage (private mode, quota) it is only not remembered. */
function remember(context: string, namespace: string, data: Access): void {
  try {
    sessionStorage.setItem(storageKey(context, namespace), JSON.stringify({ data, at: Date.now() }));
  } catch {
    // nothing to do: the next load simply asks the server again
  }
}

const fetchAccess = async (context: string, namespace: string): Promise<Access> => {
  const res = await fetch(buildUrl(api.k8s.access.path, { context, namespace }));
  if (!res.ok) throw new Error(`access ${res.status}`);
  const data = api.k8s.access.responses[200].parse(await res.json());
  remember(context, namespace, data);
  return data;
};

/**
 * Why an action would be refused, for each namespace in view: `denied(ns, verb, resource, group)` is a
 * reason, or undefined when it is allowed. Write actions are hidden while access is still being checked
 * (so nothing appears and then vanishes); if the check itself fails or the server says its answer is
 * incomplete, nothing is held back: the API server still decides every request.
 */
export function useAccess(context: string, namespaces: string[]) {
  const unique = useMemo(() => [...new Set(namespaces.map((n) => (n && n !== "all" ? n : "default")))].sort(), [namespaces]);
  const results = useQueries({
    queries: unique.map((ns) => {
      const seen = context ? remembered(context, ns) : undefined;
      return {
        queryKey: [api.k8s.access.path, context, ns],
        queryFn: () => fetchAccess(context, ns),
        enabled: !!context,
        staleTime: 60_000,
        retry: false,
        // shown at once, then checked again in the background once a minute old
        initialData: seen?.data,
        initialDataUpdatedAt: seen?.at,
      };
    }),
  });
  const { byNs, failed } = useMemo(() => {
    const m = new Map<string, Access>();
    const f = new Set<string>();
    unique.forEach((ns, i) => {
      const r = results[i];
      if (r?.data) m.set(ns, r.data);
      else if (r?.isError) f.add(ns);
    });
    return { byNs: m, failed: f };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unique, ...results.map((r) => r.data), ...results.map((r) => r.isError)]);

  const denied = useCallback(
    (namespace: string, verb: string, resource: string, group = ""): string | undefined => {
      const ns = namespace && namespace !== "all" ? namespace : "default";
      const access = byNs.get(ns);
      if (!access) return failed.has(ns) || !context ? undefined : "Checking your access…";
      if (access.incomplete || allowed(access.rules, verb, resource, group)) return undefined;
      return `Your access does not allow this (needs ${verb} on ${resource}${group ? ` in ${group}` : ""})`;
    },
    [byNs, failed, context],
  );
  /** every namespace in view has an answer (or a failed check) */
  const ready = unique.every((ns) => byNs.has(ns) || failed.has(ns));
  return { denied, ready };
}
