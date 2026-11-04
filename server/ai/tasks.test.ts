import { describe, expect, it } from "vitest";
import { AI_TASKS, getAiTask } from "./tasks";
import { commandRisk, normalizeKubectl } from "./translate";

describe("AI task registry", () => {
  it("finds real tasks only", () => {
    expect(getAiTask("troubleshoot")).toBe(AI_TASKS.troubleshoot);
    expect(getAiTask("__proto__")).toBeUndefined();
    expect(getAiTask("toString")).toBeUndefined();
  });

  it("clips oversized input instead of sending it all to the model", () => {
    const parsed = AI_TASKS["summarize-logs"].input.parse({ source: 'pod "a"', logs: "x".repeat(50_000) });
    expect(parsed.logs).toHaveLength(7000);
  });

  it("rejects missing or empty input", () => {
    expect(AI_TASKS["explain-yaml"].input.safeParse({ yaml: "" }).success).toBe(false);
    expect(AI_TASKS["explain-status"].input.safeParse({ resource: "x" }).success).toBe(false);
    expect(AI_TASKS.troubleshoot.input.safeParse(undefined).success).toBe(false);
  });

  it("builds the prompt from data, leaving out what was not sent", () => {
    const task = AI_TASKS.troubleshoot;
    const prompt = task.prompt(task.input.parse({ resourceType: "pod", name: "api-1", namespace: "e2", logs: "boom" }));
    expect(prompt).toContain("Resource: pod/api-1 in namespace e2");
    expect(prompt).toContain("### Recent logs");
    expect(prompt).not.toContain("### Events");
  });
});

describe("normalizeKubectl", () => {
  it.each([
    ["kubectl get pods -n e2", "kubectl get pods -n e2"],
    ["get pods", "kubectl get pods"],
    ["```bash\nkubectl get pods\n```", "kubectl get pods"],
    ["`kubectl cluster info`", "kubectl cluster-info"],
    ["kubectl --context=dev get pods", "kubectl get pods --context=dev"],
    ["   ", ""],
  ])("%j → %j", (raw, expected) => expect(normalizeKubectl(raw)).toBe(expected));
});

describe("commandRisk", () => {
  it.each([
    ["kubectl logs api-1 -n e2", "read"],
    ["kubectl scale deploy api --replicas=2", "write"],
    ["kubectl delete pod api-1", "blocked"],
    ["kubectl logs $(kubectl get pods -o name | head -1)", "blocked"],
    ["kubectl get pods | grep api", "blocked"],
    ["kubectl get pods; kubectl delete pod x", "blocked"],
    ["", "blocked"],
  ])("%j → %s", (command, risk) => expect(commandRisk(command)).toBe(risk));
});
