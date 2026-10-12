import { describe, expect, it } from "vitest";
import { countLiveAndUpcoming } from "./status-counts";

describe("countLiveAndUpcoming", () => {
  it("counts running and scheduled matches while ignoring other states", () => {
    expect(countLiveAndUpcoming([
      { status: "running" },
      { status: "scheduled" },
      { status: "running" },
      { status: "finished" },
      { status: "postponed" },
    ])).toEqual({ live: 2, upcoming: 1 });
  });

  it("returns zero counts for an empty schedule", () => {
    expect(countLiveAndUpcoming([])).toEqual({ live: 0, upcoming: 0 });
  });
});
