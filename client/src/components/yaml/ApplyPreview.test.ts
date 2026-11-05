import { describe, expect, it } from "vitest";
import { diffHeading } from "./ApplyPreview";

describe("diffHeading", () => {
  it.each([
    ["diff -u -N /tmp/LIVE-1/apps.v1.Deployment.e2.web /tmp/MERGED-1/apps.v1.Deployment.e2.web", "Deployment e2/web"],
    ["diff -u -N /tmp/LIVE-2/v1.ConfigMap.e2.app.settings /tmp/M/x", "ConfigMap e2/app.settings"],
    ["diff -u -N /tmp/LIVE-3/networking.k8s.io.v1.Ingress.e2.web /tmp/M/x", "Ingress e2/web"],
    ["diff -u -N /tmp/LIVE-4/v1.Namespace.team-a /tmp/M/x", "Namespace team-a"],
    ["diff -u -N /tmp/LIVE-5/cert-manager.io.v1beta1.Certificate.e2.tls /tmp/M/x", "Certificate e2/tls"],
  ])("%s", (line, want) => expect(diffHeading(line)).toBe(want));
  it("ignores other lines", () => expect(diffHeading("@@ -1,3 +1,4 @@")).toBeNull());
});
