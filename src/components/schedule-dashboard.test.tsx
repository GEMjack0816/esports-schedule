import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScheduleDashboard } from "@/components/schedule-dashboard";
import type { DataCoverage, GameCoverage, GameKey, SchedulePayload } from "@/lib/schedule/types";

const endpointCoverage = {
  pages: 0,
  xTotal: 0,
  raw: 0,
  normalized: 0,
  deduplicated: 0,
  final: 0,
  filtered: { missingId: 0, missingTime: 0, invalidTime: 0, outsideWindow: 0, duplicate: 0 },
};

function gameCoverage(): GameCoverage {
  return {
    endpoints: { upcoming: endpointCoverage, running: endpointCoverage, past: endpointCoverage },
    pages: 0,
    xTotal: 0,
    raw: 0,
    normalized: 0,
    deduplicated: 0,
    final: 0,
    statusCounts: {
      scheduled: 0,
      running: 0,
      finished: 0,
      postponed: 0,
      cancelled: 0,
      forfeit: 0,
      unknown: 0,
    },
    earliestMatchAt: null,
    latestMatchAt: null,
    lastSuccessfulSyncAt: null,
    lastAttemptAt: null,
    sourceFetchedAt: null,
    snapshotAgeSeconds: null,
    refreshInProgress: false,
    syncStatus: "normal",
    staleMinutes: null,
    dataSource: "persistent",
    lastErrorCode: null,
    lastError: null,
  };
}

const coverage: DataCoverage = {
  mode: "live",
  stale: false,
  syncAttemptedAt: null,
  lastAttemptAt: null,
  lastSuccessfulSyncAt: null,
  sourceFetchedAt: null,
  snapshotAgeSeconds: null,
  refreshInProgress: false,
  lastError: null,
  rateLimitRemaining: null,
  range: { pastDays: 30, futureDays: 60, earliestMatchAt: null, latestMatchAt: null },
  totals: {
    xTotal: 0,
    raw: 0,
    normalized: 0,
    deduplicated: 0,
    finalPandaScore: 0,
    finalWithManual: 0,
    filtered: 0,
  },
  games: {
    lol: gameCoverage(),
    valorant: gameCoverage(),
    "honor-of-kings": gameCoverage(),
    cs2: gameCoverage(),
    dota2: gameCoverage(),
  } satisfies Record<GameKey, GameCoverage>,
  manual: { honorOfKings: 0, supplemental: 0, overrides: 0, hidden: 0, published: 0, database: 0 },
};

const initialData: SchedulePayload = {
  matches: [],
  generatedAt: "2026-10-22T00:00:00.000Z",
  mode: "live",
  demoMode: false,
  stale: false,
  lastSuccessfulSyncAt: null,
  providers: { pandascore: "connected", manual: "json+database" },
  coverage,
  deployment: { id: null, commitSha: null, productionUrl: null, environment: "test" },
};

describe("ScheduleDashboard named data groups", () => {
  it("exposes the coverage summary and per-game sync status as named groups", () => {
    const markup = renderToStaticMarkup(<ScheduleDashboard initialData={initialData} />);

    expect(markup).toMatch(/class="data-summary" role="group" aria-label="数据覆盖信息"/);
    expect(markup).toMatch(/class="sync-status-grid" role="group" aria-label="各游戏数据同步状态"/);
  });
});
