import { describe, expect, it } from "vitest";
import { groupBy } from "./group-by";

describe("groupBy", () => {
  it("groups items in one pass while retaining first-seen group and item order", () => {
    const items = [
      { day: "today", id: "a" },
      { day: "tomorrow", id: "b" },
      { day: "today", id: "c" },
    ];

    expect([...groupBy(items, (item) => item.day)]).toEqual([
      ["today", [items[0], items[2]]],
      ["tomorrow", [items[1]]],
    ]);
    expect(items.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty map for an empty input", () => {
    expect(groupBy([], () => "unused").size).toBe(0);
  });
});
