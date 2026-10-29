import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SchedulePayload } from "@/lib/schedule";
import type { GameCoverage } from "@/lib/schedule/types";
import { ScheduleDashboard } from "./schedule-dashboard";

const failedGameCoverage = {
  sourceFetchedAt: "2026-10-29T16:05:00.000Z",
  lastError: null,
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
  it("renders the all-games-failed copy from live coverage instead of the generic delay label", () => {
    const markup = renderToStaticMarkup(createElement(ScheduleDashboard, { initialData: staleFailedSchedule }));

    expect(markup).toContain("PandaScore 聚合数据（同步失败，当前显示上次成功快照）");
    expect(markup).not.toContain("PandaScore 聚合数据（部分延迟）");
    expect((markup.match(/>同步失败</g) ?? [])).toHaveLength(5);
  });
});
