import { describe, expect, it } from "vitest";
import { auditOutcome, auditSentence, auditWhen, describeAudit } from "./audit-format";

const say = (method: string, path: string, detail = "", emailOf?: (id: string) => string | undefined) =>
  auditSentence(describeAudit({ method, path, detail }, emailOf));

const ID = "WndNflNcqRgh2uqVxlolRkFsNkPrVHCG";

describe("describeAudit", () => {
  it("names cluster actions and their target", () => {
    expect(say("POST", "/api/k8s/deployments/web/scale")).toBe("Scaled deployment web");
    expect(say("POST", "/api/k8s/deployments/api/restart")).toBe("Restarted deployment api");
    expect(say("POST", "/api/k8s/nodes/worker-2/drain")).toBe("Drained node worker-2");
    expect(say("POST", "/api/k8s/nodes/worker-2/uncordon")).toBe("Uncordoned node worker-2");
    expect(say("DELETE", "/api/k8s/pods/web-1")).toBe("Deleted pod web-1");
    expect(say("POST", "/api/k8s/pods/web-1/port-forward")).toBe("Started a port-forward to pod web-1");
    expect(say("DELETE", "/api/k8s/port-forwards/7")).toBe("Stopped a port-forward");
    expect(say("POST", "/api/k8s/apply")).toBe("Applied YAML");
  });

  it("keeps the target separate, so the page can set it in monospace", () => {
    expect(describeAudit({ method: "POST", path: "/api/k8s/deployments/web%2Dv2/scale", detail: "" }))
      .toEqual({ lead: "Scaled deployment", target: "web-v2" });
  });

  it("shows a palette command in full", () => {
    const a = describeAudit({ method: "POST", path: "/api/kubectl/exec", detail: "kubectl delete configmap old -n shop" });
    expect(a).toEqual({ lead: "Ran a kubectl command", command: "kubectl delete configmap old -n shop" });
    expect(auditSentence(a)).toBe("Ran a kubectl command: kubectl delete configmap old -n shop");
    expect(say("POST", "/api/kubectl/exec")).toBe("Ran a kubectl command");
  });

  it("describes the assistant's requests", () => {
    expect(say("POST", "/api/ai/agent")).toBe("Asked the assistant");
    expect(say("POST", "/api/ai/translate")).toBe("Asked the assistant for a kubectl command");
    expect(say("POST", "/api/ai/tasks/troubleshoot")).toBe("Asked the assistant to troubleshoot");
    expect(say("POST", "/api/ai/test")).toBe("Tested the AI provider");
  });

  it("names the user an admin acted on when the email is known, and says 'a user' when not", () => {
    const emailOf = (id: string) => (id === ID ? "dana@example.com" : undefined);
    expect(say("POST", "/api/admin/users")).toBe("Added a user");
    expect(say("PATCH", `/api/admin/users/${ID}`, "", emailOf)).toBe("Changed the name, role or groups of dana@example.com");
    expect(say("POST", `/api/admin/users/${ID}/password`, "", emailOf)).toBe("Set a new password for dana@example.com");
    expect(say("POST", `/api/admin/users/${ID}/password`)).toBe("Set a new password for a user");
    expect(say("POST", `/api/admin/users/${ID}/ban`, "", emailOf)).toBe("Blocked or unblocked dana@example.com");
    expect(say("DELETE", `/api/admin/users/${ID}/sessions`, "", emailOf)).toBe("Signed dana@example.com out everywhere");
    expect(say("DELETE", `/api/admin/users/${ID}/sessions`)).toBe("Signed a user out everywhere");
    expect(say("DELETE", `/api/admin/users/${ID}`)).toBe("Deleted a user");
  });

  it("describes plugin changes", () => {
    expect(say("POST", "/api/plugins")).toBe("Added a plugin");
    expect(say("PUT", "/api/plugins/tempo")).toBe("Changed plugin tempo");
    expect(say("DELETE", "/api/plugins/mcp-runbooks")).toBe("Removed plugin mcp-runbooks");
    expect(say("POST", "/api/plugins/loki/test")).toBe("Tested plugin loki");
    expect(say("PUT", "/api/plugins/ai")).toBe("Changed the AI provider");
    expect(say("POST", "/api/plugins/ai/test")).toBe("Tested the AI provider");
    expect(say("PUT", "/api/settings")).toBe("Changed KubeDeck's settings");
  });

  it("falls back to a readable verb and the path for anything else", () => {
    expect(say("POST", "/api/something/new")).toBe("Called something/new");
    expect(say("DELETE", "/api/k8s/widgets/a")).toBe("Deleted k8s/widgets/a");
    expect(say("PATCH", "/api/admin/users/x/unknown")).toBe("Changed admin/users/x/unknown");
  });
});

describe("auditOutcome", () => {
  it("tells done, refused and failed apart", () => {
    expect(auditOutcome(200)).toBe("done");
    expect(auditOutcome(204)).toBe("done");
    expect(auditOutcome(403)).toBe("refused");
    expect(auditOutcome(401)).toBe("refused");
    expect(auditOutcome(400)).toBe("failed");
    expect(auditOutcome(500)).toBe("failed");
  });
});

describe("auditWhen", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  it("is relative for the last week and a date after", () => {
    expect(auditWhen("2026-11-12T11:59:40Z", now)).toBe("just now");
    expect(auditWhen("2026-11-12T11:30:00Z", now)).toBe("30m ago");
    expect(auditWhen("2026-11-12T06:00:00Z", now)).toBe("6h ago");
    expect(auditWhen("2026-11-09T12:00:00Z", now)).toBe("3d ago");
    expect(auditWhen("2026-10-01T12:00:00Z", now)).not.toMatch(/ago/);
    expect(auditWhen("not a date", now)).toBe("");
  });
});
