import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { deriveGameCoverage } from "@/lib/schedule/index";
import type { SchedulePayload } from "@/lib/schedule";
import type { PandaGameSnapshot } from "@/lib/schedule/pandascore";
import type { GameCoverage } from "@/lib/schedule/types";
import { pandaGameKeys } from "@/lib/schedule/types";
import { ScheduleDashboard } from "./schedule-dashboard";

const failedGameCoverage = {
  sourceFetchedAt: "2026-10-29T16:05:00.000Z",
  lastError: { at: "2026-10-29T16:05:12.000Z", code: "UPSTREAM", httpStatus: 502 },
  refreshInProgress: false,
  syncStatus: "failed",
} as GameCoverage;

const staleFailedSchedule = {
  matches: [],
  mode: "live",
  stale: true,
  lastSuccessfulSyncAt: "2026-10-29T16:05:11.000Z",
  coverage: {
    sourceFetchedAt: "2026-10-29T16:05:00.000Z",
    lastAttemptAt: "2026-10-29T16:05:12.000Z",
    refreshInProgress: false,
    range: { earliestMatchAt: null, latestMatchAt: null },
    games: {
      lol: failedGameCoverage,
      valorant: failedGameCoverage,
      "honor-of-kings": failedGameCoverage,
      cs2: failedGameCoverage,
      dota2: failedGameCoverage,
    },
  },
} as unknown as SchedulePayload;

describe("ScheduleDashboard stale-state rendering", () => {
  it("renders the all-games-failed copy when coverage contains a recorded provider error", () => {
    const markup = renderToStaticMarkup(createElement(ScheduleDashboard, { initialData: staleFailedSchedule }));

    expect(markup).toContain("PandaScore 聚合数据（同步失败，当前显示上次成功快照）");
    expect((markup.match(/>同步失败</g) ?? [])).toHaveLength(5);
  });

  it("renders an expired snapshot, not a failed sync, for the former all-games-stale Production shape", () => {
    const fetchedAt = "2026-10-29T16:05:00.000Z";
    const snapshots = Object.fromEntries(pandaGameKeys.map((game) => [game, {
      game,
      matches: [],
      fetchedAt,
      rateLimitRemaining: null,
      coverage: failedGameCoverage,
    }])) as Partial<Record<(typeof pandaGameKeys)[number], PandaGameSnapshot>>;
    const games = deriveGameCoverage(
      snapshots,
      {},
      new Date("2026-10-29T17:50:00.000Z"),
      false,
    );
    const staleSchedule = {
      ...staleFailedSchedule,
      coverage: { ...staleFailedSchedule.coverage, games },
    } as SchedulePayload;

    const markup = renderToStaticMarkup(createElement(ScheduleDashboard, { initialData: staleSchedule }));

    expect(markup).toContain("PandaScore 聚合数据（赛程快照已过期，当前显示已缓存数据）");
    expect((markup.match(/>快照过期</g) ?? [])).toHaveLength(5);
    expect(markup).not.toContain("同步失败");
    expect(markup).not.toContain("PandaScore 聚合数据（部分延迟）");
  });
});
