import { describe, expect, it } from "vitest";
import { DEFAULT_PALETTE, PALETTES, getPalette } from "./themes";
import { readFileSync } from "fs";
import path from "path";

const css = readFileSync(path.join(__dirname, "../themes.css"), "utf-8");
const html = readFileSync(path.join(__dirname, "../../index.html"), "utf-8");

describe("themes", () => {
  it("defaults to OLED black and Paper when nothing is saved", () => {
    expect(DEFAULT_PALETTE).toEqual({ dark: "oled", light: "paper" });
    expect(getPalette("dark")).toBe("oled");
    expect(getPalette("light")).toBe("paper");
  });
  it("the pre-paint script in index.html uses the same defaults", () => {
    expect(html).toContain(`mode === "light" ? "${DEFAULT_PALETTE.light}" : "${DEFAULT_PALETTE.dark}"`);
  });
  it("every listed palette except the two base ones has its colours in themes.css", () => {
    for (const p of PALETTES) {
      if (p.id === "paper" || p.id === "charcoal") continue; // the base tokens in index.css
      expect(css, p.id).toContain(`[data-palette="${p.id}"]`);
    }
  });
});
