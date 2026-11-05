import { useCallback, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api, buildUrl, type Access } from "@shared/routes";
import { allowed } from "@/lib/access";

const fetchAccess = async (context: string, namespace: string): Promise<Access> => {
  const res = await fetch(buildUrl(api.k8s.access.path, { context, namespace }));
  if (!res.ok) throw new Error(`access ${res.status}`);
  return api.k8s.access.responses[200].parse(await res.json());
};

/**
 * Why an action would be refused, for each namespace in view: `denied(ns, verb, resource, group)` is a
 * reason to show, or undefined when it is allowed or not known yet. Unknown never disables anything:
 * the API server still decides.
 */
export function useAccess(context: string, namespaces: string[]) {
  const unique = useMemo(() => [...new Set(namespaces.map((n) => (n && n !== "all" ? n : "default")))].sort(), [namespaces]);
  const results = useQueries({
    queries: unique.map((ns) => ({
      queryKey: [api.k8s.access.path, context, ns],
      queryFn: () => fetchAccess(context, ns),
      enabled: !!context,
      staleTime: 60_000,
      retry: false,
    })),
  });
  const byNs = useMemo(() => {
    const m = new Map<string, Access>();
    unique.forEach((ns, i) => {
      const data = results[i]?.data;
      if (data) m.set(ns, data);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unique, ...results.map((r) => r.data)]);

  const denied = useCallback(
    (namespace: string, verb: string, resource: string, group = ""): string | undefined => {
      const access = byNs.get(namespace && namespace !== "all" ? namespace : "default");
      if (!access || access.incomplete || allowed(access.rules, verb, resource, group)) return undefined;
      return `Your access does not allow this (needs ${verb} on ${resource}${group ? ` in ${group}` : ""})`;
    },
    [byNs],
  );
  return { denied, ready: unique.every((ns) => byNs.has(ns)) };
}
