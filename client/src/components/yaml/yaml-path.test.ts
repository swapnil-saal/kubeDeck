import { describe, expect, it } from "vitest";
import { explainPath, locate } from "./yaml-path";

const doc = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: web
          image: nginx
          ports:
            - containerPort: 80
`;

const at = (needle: string, delta = 0) => doc.indexOf(needle) + delta;

describe("locate", () => {
  it("reads apiVersion and kind", () => {
    expect(locate(doc, at("replicas"))).toMatchObject({ apiVersion: "apps/v1", kind: "Deployment", path: ["spec", "replicas"] });
  });
  it("skips list items: a key inside one belongs to the list's field", () => {
    expect(locate(doc, at("image")).path).toEqual(["spec", "template", "spec", "containers", "image"]);
    expect(locate(doc, at("- name")).path).toEqual(["spec", "template", "spec", "containers", "name"]);
    expect(locate(doc, at("containerPort")).path).toEqual(["spec", "template", "spec", "containers", "ports", "containerPort"]);
  });
  it("on a key with a block value, explains that key", () => {
    expect(locate(doc, at("template:")).path).toEqual(["spec", "template"]);
  });
  it("on a blank line, uses the enclosing field", () => {
    const text = "kind: Service\nspec:\n  \n";
    expect(locate(text, text.indexOf("  \n") + 2).path).toEqual(["spec"]);
  });
  it("keeps to the cursor's document in a multi-document file", () => {
    const multi = "kind: ConfigMap\ndata:\n  a: b\n---\nkind: Secret\nstringData:\n  x: y\n";
    expect(locate(multi, multi.indexOf("x: y"))).toMatchObject({ kind: "Secret", path: ["stringData", "x"] });
  });
});

describe("explainPath", () => {
  it("joins the lower-cased kind and the field path", () => {
    expect(explainPath({ kind: "Deployment", path: ["spec", "replicas"] })).toBe("deployment.spec.replicas");
    expect(explainPath({ kind: "Deployment", path: ["kind"] })).toBe("deployment");
    expect(explainPath({ path: ["spec"] })).toBeNull();
  });
  it("stops at a map: its keys are not fields", () => {
    expect(explainPath({ kind: "Deployment", path: ["metadata", "annotations", "deployment.kubernetes.io/revision"] })).toBe("deployment.metadata.annotations");
    expect(explainPath({ kind: "ConfigMap", path: ["data", "LOG_LEVEL"] })).toBe("configmap.data");
    expect(explainPath({ kind: "Pod", path: ["spec", "containers", "resources", "limits", "cpu"] })).toBe("pod.spec.containers.resources.limits");
  });
});
