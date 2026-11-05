import { describe, expect, it } from "vitest";
import { normalizeScopes, projectId } from "./projects";

describe("projectId", () => {
  it("slugs the name and avoids ids already taken", () => {
    expect(projectId("Payments API", [])).toBe("payments-api");
    expect(projectId("Payments API", ["payments-api", "payments-api-2"])).toBe("payments-api-3");
    expect(projectId("  ***  ", [])).toBe("project");
  });
});

describe("normalizeScopes", () => {
  it("drops empty and all-namespace scopes and duplicates, and sorts", () => {
    expect(normalizeScopes([
      { context: "uat", namespace: "pay" },
      { context: "dev", namespace: "pay" },
      { context: "dev", namespace: "pay" },
      { context: "dev", namespace: "all" },
      { context: "", namespace: "x" },
    ])).toEqual([{ context: "dev", namespace: "pay" }, { context: "uat", namespace: "pay" }]);
  });
});
