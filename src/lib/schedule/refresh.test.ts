import { describe, expect, it } from "vitest";
import {
  deriveGameCoverage,
  stateAfterFailure,
  stateAfterSuccess,
} from "./index";
import type { PandaScoreGameSyncState } from "./cache";
import { createSingleFlight } from "./single-flight";
import type { PandaGameSnapshot } from "./pandascore";
import type { GameCoverage, PandaGameKey } from "./types";
import { pandaGameKeys } from "./types";

function coverage(): GameCoverage {
  const endpoint = {
    pages: 1,
    xTotal: 1,
    raw: 1,
    normalized: 1,
    deduplicated: 1,
    final: 1,
    filtered: { missingId: 0, missingTime: 0, invalidTime: 0, outsideWindow: 0, duplicate: 0 },
  };
  return {
    endpoints: { upcoming: endpoint, running: endpoint, past: endpoint },
    pages: 3,
    xTotal: 3,
    raw: 3,
    normalized: 3,
    deduplicated: 1,
    final: 1,
    statusCounts: { scheduled: 1, running: 0, finished: 0, postponed: 0, cancelled: 0, forfeit: 0, unknown: 0 },
    earliestMatchAt: "2026-07-20T00:00:00.000Z",
    latestMatchAt: "2026-07-20T00:00:00.000Z",
    lastSuccessfulSyncAt: "2026-07-18T00:00:00.000Z",
    lastAttemptAt: "2026-07-18T00:00:00.000Z",
    sourceFetchedAt: "2026-07-18T00:00:00.000Z",
    snapshotAgeSeconds: 0,
    refreshInProgress: false,
    syncStatus: "normal",
    staleMinutes: 0,
    dataSource: "fresh",
    lastErrorCode: null,
    lastError: null,
    verificationSample: {
      providerMatchId: "1",
      endpoint: "upcoming",
      providerTournament: "League",
      providerStartTimeUtc: "2026-07-20T00:00:00.000Z",
      normalizedTournament: "League",
      normalizedStartTimeUtc: "2026-07-20T00:00:00.000Z",
    },
  };
}

function snapshot(game: PandaGameKey, fetchedAt = "2026-07-18T00:00:00.000Z"): PandaGameSnapshot {
  return { game, matches: [], fetchedAt, rateLimitRemaining: 100, coverage: coverage() };
}

describe("refresh coordination and health metadata", () => {
  it("executes one upstream operation for concurrent refresh callers", async () => {
    const flight = createSingleFlight<number>();
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const operation = async () => {
      calls += 1;
      await gate;
      return 42;
    };

    const first = flight.run(operation);
    const second = flight.run(operation);
    const third = flight.run(operation);
    expect(calls).toBe(1);
    expect(flight.isRunning()).toBe(true);
    release();
    await expect(Promise.all([first, second, third])).resolves.toEqual([42, 42, 42]);
    expect(flight.isRunning()).toBe(false);
  });

  it("uses the source snapshot time for age and marks a fresh successful sync normal", () => {
    const snapshots = Object.fromEntries(pandaGameKeys.map((game) => [game, snapshot(game)]));
    const states = Object.fromEntries(pandaGameKeys.map((game) => [
      game,
      stateAfterSuccess(game, snapshots[game], new Date("2026-07-18T00:00:05.000Z")),
    ]));
    const games = deriveGameCoverage(
      snapshots,
      states,
      new Date("2026-07-18T00:10:00.000Z"),
      false,
    );
    expect(games.lol).toMatchObject({
      sourceFetchedAt: "2026-07-18T00:00:00.000Z",
      snapshotAgeSeconds: 600,
      syncStatus: "normal",
      lastError: null,
    });
  });

  it("does not advance lastSuccessfulSyncAt after a failed attempt and keeps the snapshot usable", () => {
    const oldSnapshot = snapshot("lol");
    const previous: PandaScoreGameSyncState = {
      game: "lol",
      lastAttemptAt: "2026-07-18T00:00:05.000Z",
      lastSuccessfulSyncAt: oldSnapshot.fetchedAt,
      lastErrorAt: null,
      lastErrorCode: null,
      lastHttpStatus: null,
    };
    const failed = stateAfterFailure(
      "lol",
      previous,
      oldSnapshot,
      { code: "TIMEOUT", status: null },
      new Date("2026-07-18T00:20:00.000Z"),
    );
    const game = deriveGameCoverage(
      { lol: oldSnapshot },
      { lol: failed },
      new Date("2026-07-18T00:20:01.000Z"),
      true,
    ).lol;

    expect(failed.lastSuccessfulSyncAt).toBe(oldSnapshot.fetchedAt);
    expect(game).toMatchObject({
      dataSource: "cache",
      refreshInProgress: true,
      lastAttemptAt: "2026-07-18T00:20:00.000Z",
      lastSuccessfulSyncAt: oldSnapshot.fetchedAt,
      sourceFetchedAt: oldSnapshot.fetchedAt,
      syncStatus: "failed",
      lastError: { code: "TIMEOUT", httpStatus: null },
    });
  });
});
