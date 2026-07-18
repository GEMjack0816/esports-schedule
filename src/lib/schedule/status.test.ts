import { describe, expect, it, vi } from "vitest";
import { normalizeMatchStatus } from "./status";

const base = {
  endpoint: "upcoming" as const,
  startTimeUtc: "2026-07-20T00:00:00.000Z",
  now: new Date("2026-07-18T00:00:00.000Z"),
};

describe("match status normalization", () => {
  it.each([
    ["running", "running"],
    ["live", "running"],
    ["started", "running"],
    ["in_progress", "running"],
    ["not_started", "scheduled"],
    ["upcoming", "scheduled"],
    ["scheduled", "scheduled"],
    ["finished", "finished"],
    ["completed", "finished"],
    ["complete", "finished"],
    ["canceled", "cancelled"],
    ["cancelled", "cancelled"],
    ["postponed", "postponed"],
    ["forfeit", "forfeit"],
    ["walkover", "forfeit"],
  ] as const)("maps %s to %s", (upstream, expected) => {
    expect(normalizeMatchStatus(upstream, base).status).toBe(expected);
  });

  it("normalizes casing, spaces, and hyphens", () => {
    expect(normalizeMatchStatus("  In Progress  ", base).status).toBe("running");
    expect(normalizeMatchStatus("NOT-STARTED", base).status).toBe("scheduled");
    expect(normalizeMatchStatus(" COMPLETED ", base).status).toBe("finished");
  });

  it("keeps an explicit not_started status scheduled after the planned start", () => {
    expect(normalizeMatchStatus("not_started", {
      ...base,
      startTimeUtc: "2026-07-17T23:00:00.000Z",
    }).status).toBe("scheduled");
  });

  it("uses time only when upstream status is blank", () => {
    expect(normalizeMatchStatus(null, {
      ...base,
      startTimeUtc: "2026-07-17T23:00:00.000Z",
    })).toMatchObject({ status: "running", source: "time" });
  });

  it("treats the PandaScore running collection as authoritative over a stale scheduled value", () => {
    expect(normalizeMatchStatus("not_started", {
      ...base,
      endpoint: "running",
    })).toMatchObject({ status: "running", source: "endpoint" });
  });

  it("reports and preserves an unknown status instead of silently guessing", () => {
    const onUnknown = vi.fn();
    expect(normalizeMatchStatus("Paused_By_Admin", { ...base, onUnknown })).toMatchObject({
      status: "unknown",
      source: "unknown",
    });
    expect(onUnknown).toHaveBeenCalledWith("paused_by_admin");
  });
});
