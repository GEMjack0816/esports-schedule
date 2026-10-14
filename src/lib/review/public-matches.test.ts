import { describe, expect, it, vi } from "vitest";
import type { PublishedManualMatchRow } from "@/db/schema";
import {
  preserveLastSuccessfulPublicMatches,
  publishedRowToMatch,
  selectRuntimeFallback,
  shouldRefreshCachedSnapshot,
  synchronizePublishedManualMatchesSnapshot,
} from "./public-matches";

function row(overrides: Partial<PublishedManualMatchRow> = {}): PublishedManualMatchRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    operationKey: null,
    sourceSubmissionId: null,
    game: "honor-of-kings",
    league: "KPL",
    tournament: "Summer",
    stage: null,
    homeTeamName: "Alpha",
    homeTeamAcronym: null,
    homeTeamLogo: null,
    awayTeamName: "Beta",
    awayTeamAcronym: null,
    awayTeamLogo: null,
    startTimeUtc: new Date("2026-08-01T00:00:00.000Z"),
    bestOf: 5,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    streamUrl: null,
    sourceUrl: "https://example.com/source",
    publishedAt: new Date("2026-07-26T00:00:00.000Z"),
    updatedAt: new Date("2026-07-26T01:00:00.000Z"),
    publishedBy: "user_1",
    hidden: false,
    ...overrides,
  };
}

describe("published database manual matches", () => {
  it("uses a stable manual provider key and safe local logo fallback", () => {
    const match = publishedRowToMatch(row());
    expect(match.id).toBe("manual:honor-of-kings:db-11111111-1111-4111-8111-111111111111");
    expect(match.providerMatchId).toBe("db-11111111-1111-4111-8111-111111111111");
    expect(match.homeTeam.logo).toBe("/team-placeholder.svg");
    expect(match.awayTeam.logo).toBe("/team-placeholder.svg");
  });

  it("publishes only a validated HTTPS stream supplied by the database layer", () => {
    const match = publishedRowToMatch(row({ streamUrl: "https://live.example/match" }));
    expect(match.streams).toEqual([{
      label: "直播",
      url: "https://live.example/match",
      official: false,
    }]);
  });

  it("returns the last successful public snapshot when the database read fails", async () => {
    const cached = {
      matches: [publishedRowToMatch(row())],
      fetchedAt: "2026-07-26T01:00:00.000Z",
      revision: 1,
    };
    const result = await preserveLastSuccessfulPublicMatches(
      async () => {
        throw new Error("database unavailable");
      },
      async () => cached,
    );
    expect(result).toEqual({ value: cached, fallback: true });
  });

  it("does not read fallback data after a successful database read", async () => {
    const current = {
      matches: [publishedRowToMatch(row())],
      fetchedAt: "2026-07-26T02:00:00.000Z",
      revision: 2,
    };
    let fallbackRead = false;
    const result = await preserveLastSuccessfulPublicMatches(
      async () => current,
      async () => {
        fallbackRead = true;
        return null;
      },
    );
    expect(result).toEqual({ value: current, fallback: false });
    expect(fallbackRead).toBe(false);
  });

  it("rejects a Runtime Cache snapshot older than the committed mutation fence", () => {
    const cached = {
      matches: [publishedRowToMatch(row())],
      fetchedAt: "2026-07-26T01:00:00.000Z",
      revision: 4,
    };
    expect(selectRuntimeFallback(cached, { revision: 5 })).toBeNull();
    expect(selectRuntimeFallback(cached, { revision: 4 })).toBe(cached);
  });

  it.each([null, undefined, { revision: "unknown" }])("fails closed when the Runtime Cache fence is missing or malformed: %j", (fence) => {
    const cached = {
      matches: [publishedRowToMatch(row())],
      fetchedAt: "2026-07-26T01:00:00.000Z",
      revision: 4,
    };
    expect(selectRuntimeFallback(cached, fence)).toBeNull();
  });

  it("bypasses an old Next Data Cache value when the fence is newer, missing, or unreadable", () => {
    expect(shouldRefreshCachedSnapshot(4, { available: true, revision: 5 })).toBe(true);
    expect(shouldRefreshCachedSnapshot(5, { available: true, revision: 5 })).toBe(false);
    // Missing and malformed/failed Runtime Cache reads all produce an
    // unavailable fence at the caller; none may be treated as revision-zero proof.
    expect(shouldRefreshCachedSnapshot(5, { available: false, revision: 0 })).toBe(true);
  });

  it("keeps a failed cache delivery pending without losing current database results", async () => {
    const repository = {
      readManualMatchCacheSnapshot: async () => ({ rows: [row()], revision: 8, pendingRevisions: 1 }),
      markManualMatchCacheDelivered: async () => undefined,
      markManualMatchCacheDeliveryFailed: vi.fn().mockResolvedValue(undefined),
    };
    const snapshot = await synchronizePublishedManualMatchesSnapshot(
      repository,
      async () => { throw new Error("runtime cache unavailable"); },
    );
    expect(snapshot.revision).toBe(8);
    expect(snapshot.matches).toHaveLength(1);
    expect(snapshot.cacheSynchronized).toBe(false);
    expect(repository.markManualMatchCacheDeliveryFailed).toHaveBeenCalledWith(8);
  });

  it("confirms Runtime Cache delivery separately from the cached snapshot payload", async () => {
    const repository = {
      readManualMatchCacheSnapshot: async () => ({ rows: [row()], revision: 9, pendingRevisions: 1 }),
      markManualMatchCacheDelivered: vi.fn().mockResolvedValue(undefined),
      markManualMatchCacheDeliveryFailed: vi.fn().mockResolvedValue(undefined),
    };
    let written: unknown;
    const snapshot = await synchronizePublishedManualMatchesSnapshot(
      repository,
      async (value) => { written = value; },
    );

    expect(snapshot.cacheSynchronized).toBe(true);
    expect(written).not.toHaveProperty("cacheSynchronized");
    expect(repository.markManualMatchCacheDelivered).toHaveBeenCalledWith(9);
  });
});

