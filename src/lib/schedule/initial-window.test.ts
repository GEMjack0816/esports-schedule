import { describe, expect, it } from "vitest";
import type { EsportsMatch } from "./types";
import { dateKeyInTimeZone } from "./time";
import { selectInitialScheduleWindow } from "./initial-window";

const DAY_MS = 24 * 60 * 60 * 1_000;

function matchAt(
  startTimeUtc: string | null,
  id = "test",
  status: EsportsMatch["status"] = "scheduled",
): EsportsMatch {
  return {
    id,
    provider: "manual",
    providerMatchId: id,
    game: "lol",
    tournament: null,
    league: "Test League",
    stage: null,
    homeTeam: { name: "Home", logo: "/team-placeholder.svg" },
    awayTeam: { name: "Away", logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: null,
    status,
    startTimeUtc,
    streams: [],
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("initial schedule window", () => {
  it("covers local today through day six at the UTC-12 and UTC+14 boundaries", () => {
    const timezoneCases = [
      { timeZone: "Pacific/Pago_Pago", now: new Date("2026-10-25T00:00:00.000Z") },
      { timeZone: "Pacific/Kiritimati", now: new Date("2026-10-25T23:59:00.000Z") },
      { timeZone: "America/Los_Angeles", now: new Date("2026-03-08T08:00:00.000Z") },
      { timeZone: "Asia/Shanghai", now: new Date("2026-10-25T12:00:00.000Z") },
    ];

    for (const { timeZone, now } of timezoneCases) {
      const firstLocalDay = dateKeyInTimeZone(now, timeZone);
      const endLocalDay = dateKeyInTimeZone(new Date(now.getTime() + 6 * DAY_MS), timeZone);
      const candidates = Array.from({ length: 12 * 24 }, (_, hour) => {
        const timestamp = new Date(now.getTime() - DAY_MS + hour * 60 * 60 * 1_000);
        const localDay = dateKeyInTimeZone(timestamp, timeZone);
        return localDay >= firstLocalDay && localDay <= endLocalDay
          ? matchAt(timestamp.toISOString(), `${timeZone}-${hour}`)
          : null;
      }).filter((candidate): candidate is EsportsMatch => candidate !== null);

      const selected = new Set(selectInitialScheduleWindow(candidates, now).map((match) => match.id));
      expect(candidates.length, timeZone).toBeGreaterThan(0);
      expect(candidates.every((match) => selected.has(match.id)), timeZone).toBe(true);
    }
  });

  it("excludes historical, out-of-window, unscheduled, and invalid-time matches", () => {
    const now = new Date("2026-10-25T12:00:00.000Z");
    const matches: EsportsMatch[] = [
      matchAt("2026-10-23T23:59:59.999Z", "too-old"),
      matchAt("2026-10-24T00:00:00.000Z", "window-start"),
      matchAt("2026-11-01T23:59:59.999Z", "window-end-minus-one"),
      matchAt("2026-11-02T00:00:00.000Z", "too-far"),
      matchAt(null, "unscheduled"),
      matchAt("not-a-date", "invalid"),
    ];

    expect(selectInitialScheduleWindow(matches, now).map((match) => match.id)).toEqual([
      "window-start",
      "window-end-minus-one",
    ]);
  });

  it("keeps running matches in the initial payload even when undated or outside the date window", () => {
    const now = new Date("2026-10-25T12:00:00.000Z");
    const matches = [
      matchAt(null, "undated-running", "running"),
      matchAt("2026-10-10T12:00:00.000Z", "older-running", "running"),
      matchAt("not-a-date", "invalid-running", "running"),
      matchAt(null, "undated-scheduled"),
      matchAt("2026-10-10T12:00:00.000Z", "older-scheduled"),
    ];

    expect(selectInitialScheduleWindow(matches, now).map((match) => match.id)).toEqual([
      "undated-running",
      "older-running",
    ]);
  });
});
