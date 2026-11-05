import type { ApiResource, AccessRule } from "@shared/routes";

/**
 * Whether RBAC rules allow `verb` on `resource` (a plural, optionally with a subresource: "pods/exec")
 * in API group `group` ("" = core). Rules limited to named objects do not grant the kind as a whole.
 */
export function allowed(rules: AccessRule[], verb: string, resource: string, group = ""): boolean {
  const [base, sub] = resource.split("/");
  return rules.some((r) =>
    r.resourceNames.length === 0 &&
    (r.verbs.includes(verb) || r.verbs.includes("*")) &&
    (r.apiGroups.includes(group) || r.apiGroups.includes("*")) &&
    r.resources.some((res) =>
      res === "*" || res === resource || (sub ? res === `${base}/*` || res === `*/${sub}` : false),
    ),
  );
}

/** The discovery entry for a route type: "deployment", "pvc", "replicasets" or "certificates.cert-manager.io". */
export function findApiResource(list: ApiResource[] | undefined, type: string): ApiResource | undefined {
  if (!list) return undefined;
  const t = type.toLowerCase();
  return (
    list.find((r) => r.id === t) ??
    // a plain name prefers the built-in kind over a same-named custom one (events vs events.k8s.io)
    list.find((r) => (r.name === t || r.singular === t || r.shortNames.includes(t)) && !r.group.includes(".")) ??
    list.find((r) => r.name === t || r.singular === t || r.shortNames.includes(t))
  );
}
