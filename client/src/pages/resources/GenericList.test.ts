import { describe, expect, it } from "vitest";
import { ageSeconds } from "./GenericList";

describe("ageSeconds", () => {
  it.each([["462d", 462 * 86_400], ["5h12m", 5 * 3_600 + 12 * 60], ["3y45d", 3 * 31_536_000 + 45 * 86_400], ["40s", 40]])(
    "reads %s",
    (age, s) => expect(ageSeconds(age)).toBe(s),
  );
  it("is null for something that is not an age", () => expect(ageSeconds("<none>")).toBeNull());
});
