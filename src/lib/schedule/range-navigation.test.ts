import { describe, expect, it } from "vitest";
import { rangeForNavigationKey, scheduleRangeTabs } from "./range-navigation";

describe("schedule range keyboard navigation", () => {
  it("advances and wraps in both directions", () => {
    expect(rangeForNavigationKey("today", "ArrowRight")).toBe("tomorrow");
    expect(rangeForNavigationKey("all", "ArrowRight")).toBe("today");
    expect(rangeForNavigationKey("today", "ArrowLeft")).toBe("all");
    expect(rangeForNavigationKey("history", "ArrowLeft")).toBe("seven");
  });

  it("jumps to the first and last tab", () => {
    for (const [range] of scheduleRangeTabs) {
      expect(rangeForNavigationKey(range, "Home")).toBe("today");
      expect(rangeForNavigationKey(range, "End")).toBe("all");
    }
  });

  it.each(["Tab", "Enter", " ", "ArrowUp", "ArrowDown", "Escape"])(
    "does not intercept %s",
    (key) => expect(rangeForNavigationKey("today", key)).toBeNull(),
  );
});
