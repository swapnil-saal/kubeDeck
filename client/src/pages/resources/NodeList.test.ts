import { describe, expect, it } from "vitest";
import { memoryGi } from "./NodeList";

describe("memoryGi", () => {
  it("reads binary quantities", () => {
    expect(memoryGi("7786824Ki")).toBeCloseTo(7.43, 2);
    expect(memoryGi("16Gi")).toBe(16);
    expect(memoryGi("2048Mi")).toBe(2);
    expect(memoryGi("-")).toBeNull();
  });
});
