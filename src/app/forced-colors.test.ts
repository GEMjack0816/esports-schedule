import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const forcedColorsBlock = stylesheet.match(
  /@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*?)\n\}/,
)?.[1];

describe("Windows forced-colors support", () => {
  it("keeps the transparent outlined hero text readable", () => {
    expect(forcedColorsBlock).toContain(".hero-copy h1 span");
    expect(forcedColorsBlock).toContain("color: CanvasText");
    expect(forcedColorsBlock).toContain("-webkit-text-stroke: 0");
  });

  it("restores the native filter select indicator when gradients are suppressed", () => {
    expect(forcedColorsBlock).toContain(".filter-panel select");
    expect(forcedColorsBlock).toContain("appearance: auto");
    expect(forcedColorsBlock).toContain("background-image: none");
  });

  it("uses system-color outlines instead of focus shadows", () => {
    expect(forcedColorsBlock).toContain(":focus-visible");
    expect(forcedColorsBlock).toContain("outline: 2px solid Highlight !important");
    expect(forcedColorsBlock).toContain("box-shadow: none");
  });
});
