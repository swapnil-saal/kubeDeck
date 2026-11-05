import { describe, expect, it } from "vitest";
import type { AccessRule, ApiResource } from "@shared/routes";
import { allowed, findApiResource } from "./access";

const rule = (verbs: string[], apiGroups: string[], resources: string[], resourceNames: string[] = []): AccessRule =>
  ({ verbs, apiGroups, resources, resourceNames });

describe("allowed", () => {
  const rules = [
    rule(["get", "list", "watch"], ["*"], ["pods", "deployments"]),
    rule(["delete"], [""], ["pods"]),
    rule(["create"], [""], ["pods/exec"]),
    rule(["patch"], ["apps"], ["deployments"], ["only-this-one"]),
    rule(["*"], ["batch"], ["*"]),
  ];
  it("matches verb, group and resource, with wildcards", () => {
    expect(allowed(rules, "list", "deployments", "apps")).toBe(true);
    expect(allowed(rules, "delete", "pods")).toBe(true);
    expect(allowed(rules, "delete", "deployments", "apps")).toBe(false);
    expect(allowed(rules, "create", "jobs", "batch")).toBe(true);
  });
  it("treats subresources as their own resource", () => {
    expect(allowed(rules, "create", "pods/exec")).toBe(true);
    expect(allowed(rules, "create", "pods/portforward")).toBe(false);
    expect(allowed([rule(["create"], [""], ["pods/*"])], "create", "pods/portforward")).toBe(true);
  });
  it("does not let a rule for named objects grant the whole kind", () => {
    expect(allowed(rules, "patch", "deployments", "apps")).toBe(false);
  });
});

describe("findApiResource", () => {
  const r = (name: string, group: string, singular: string, shortNames: string[] = []): ApiResource => ({
    id: group ? `${name}.${group}` : name, name, singular, group, kind: name, version: "v1", namespaced: true, shortNames, verbs: [], categories: [],
  });
  const list = [r("events", "", "event", ["ev"]), r("events", "events.k8s.io", "event"), r("deployments", "apps", "deployment", ["deploy"]), r("persistentvolumeclaims", "", "persistentvolumeclaim", ["pvc"])];
  it("finds by id, plural, singular or short name, preferring built-ins", () => {
    expect(findApiResource(list, "deployment")?.group).toBe("apps");
    expect(findApiResource(list, "pvc")?.name).toBe("persistentvolumeclaims");
    expect(findApiResource(list, "events")?.group).toBe("");
    expect(findApiResource(list, "events.events.k8s.io")?.group).toBe("events.k8s.io");
  });
});
