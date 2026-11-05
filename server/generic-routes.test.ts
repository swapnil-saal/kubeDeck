import { describe, expect, it } from "vitest";
import { parseApiResources, toGenericList } from "./generic-routes";
import { missingPermission } from "./kubectl-run";

describe("parseApiResources", () => {
  const json = JSON.stringify({
    resources: [
      { name: "deployments", namespaced: true, kind: "Deployment", group: "apps", version: "v1", shortNames: ["deploy"], verbs: ["get", "list"], categories: ["all"] },
      { name: "namespaces", namespaced: false, kind: "Namespace", version: "v1", shortNames: ["ns"], verbs: ["get", "list"] },
      { name: "certificates", namespaced: true, kind: "Certificate", group: "cert-manager.io", version: "v1", verbs: ["get", "list"] },
      { name: "bindings", namespaced: true, kind: "Binding", version: "v1", verbs: ["create"] },
      { name: "deployments/scale", namespaced: true, kind: "Scale", group: "apps", version: "v1", verbs: ["get", "list"] },
    ],
  });
  it("keeps listable kinds, gives non-core ones a group-qualified id, and sorts by group", () => {
    const r = parseApiResources(json);
    expect(r.map((x) => x.id)).toEqual(["namespaces", "deployments.apps", "certificates.cert-manager.io"]);
    expect(r[0]).toMatchObject({ group: "", namespaced: false, shortNames: ["ns"], categories: [] });
  });
});

describe("toGenericList", () => {
  it("turns kubectl's aligned table into columns and rows, values with spaces included", () => {
    const out = [
      "NAMESPACE   NAME      READY   STATUS             AGE",
      "e2          web-1     1/1     Running            3d",
      "e2          worker    0/1     CrashLoopBackOff   5h12m",
    ].join("\n");
    expect(toGenericList(out)).toEqual({
      columns: ["NAMESPACE", "NAME", "READY", "STATUS", "AGE"],
      rows: [["e2", "web-1", "1/1", "Running", "3d"], ["e2", "worker", "0/1", "CrashLoopBackOff", "5h12m"]],
    });
  });
});

describe("missingPermission", () => {
  it("says which permission the account lacks", () => {
    expect(missingPermission('Error from server (Forbidden): resourcequotas is forbidden: User "x" cannot list resource "resourcequotas" in API group "" in the namespace "e2"'))
      .toBe("this account cannot list resourcequotas in namespace e2");
    expect(missingPermission('User "x" cannot get resource "certificates" in API group "cert-manager.io" at the cluster scope'))
      .toBe("this account cannot get certificates.cert-manager.io");
    expect(missingPermission("connection refused")).toBeNull();
  });
});

import { parseExplain } from "./generic-routes";

describe("parseExplain", () => {
  const text = [
    "GROUP:      apps", "KIND:       Deployment", "VERSION:    v1", "", "FIELD: containers <[]Container>", "", "",
    "DESCRIPTION:", "    List of containers belonging to the pod. Containers cannot currently be", "    added or removed.",
    "    ", "    A single application container.", "    ", "FIELDS:",
    "  args\t<[]string>", "    Arguments to the entrypoint. The image's CMD is used if this is", "    not provided.", "",
    "  name\t<string> -required-", "    Name of the container.", "",
  ].join("\n");
  it("reads the header, joins wrapped description lines, and lists fields with required flags", () => {
    expect(parseExplain(text)).toEqual({
      kind: "Deployment",
      version: "apps/v1",
      field: "containers",
      type: "[]Container",
      description: "List of containers belonging to the pod. Containers cannot currently be added or removed.\n\nA single application container.",
      fields: [
        { name: "args", type: "[]string", required: false, description: "Arguments to the entrypoint. The image's CMD is used if this is not provided." },
        { name: "name", type: "string", required: true, description: "Name of the container." },
      ],
    });
  });
});
