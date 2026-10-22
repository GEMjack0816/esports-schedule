import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SchedulePayload } from "@/lib/schedule/types";

const matchStartTime = new Date();
matchStartTime.setUTCHours(12, 0, 0, 0);
const matchDateKey = matchStartTime.toISOString().slice(0, 10);

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement("img", props),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) => {
    const { prefetch, ...anchorProps } = props;
    void prefetch;
    return React.createElement("a", { href, ...anchorProps }, children);
  },
}));

import { ScheduleDashboard } from "./schedule-dashboard";

const payload = {
  matches: [{
    id: "pandascore:lol:match-1",
    provider: "pandascore",
    providerMatchId: "match-1",
    game: "lol",
    tournament: "春季赛",
    league: "LPL",
    stage: "常规赛",
    homeTeam: { name: "Team Alpha", acronym: "TA", logo: "" },
    awayTeam: { name: "Team Beta", acronym: "TB", logo: "" },
    homeScore: null,
    awayScore: null,
    bestOf: 3,
    status: "scheduled",
    startTimeUtc: matchStartTime.toISOString(),
    streams: [],
    lastUpdatedAt: "2026-10-22T00:00:00.000Z",
  }],
  generatedAt: "2026-10-22T00:00:00.000Z",
  mode: "live",
  demoMode: false,
  stale: false,
  lastSuccessfulSyncAt: "2026-10-22T00:00:00.000Z",
  providers: { pandascore: "connected", manual: "json+database" },
  coverage: {
    mode: "live",
    stale: false,
    syncAttemptedAt: null,
    lastAttemptAt: null,
    lastSuccessfulSyncAt: null,
    sourceFetchedAt: "2026-10-22T00:00:00.000Z",
    snapshotAgeSeconds: 0,
    refreshInProgress: false,
    lastError: null,
    rateLimitRemaining: null,
    range: { pastDays: 30, futureDays: 60, earliestMatchAt: matchStartTime.toISOString(), latestMatchAt: matchStartTime.toISOString() },
    totals: { xTotal: 1, raw: 1, normalized: 1, deduplicated: 1, finalPandaScore: 1, finalWithManual: 1, filtered: 0 },
    games: Object.fromEntries(["lol", "valorant", "honor-of-kings", "cs2", "dota2"].map((game) => [game, {
      syncStatus: "normal",
      refreshInProgress: false,
      sourceFetchedAt: "2026-10-22T00:00:00.000Z",
    }])) as SchedulePayload["coverage"]["games"],
    manual: { honorOfKings: 0, supplemental: 0, overrides: 0, hidden: 0, published: 0, database: 0 },
  },
  deployment: { id: null, commitSha: null, productionUrl: null, environment: null },
} satisfies SchedulePayload;

describe("schedule date heading semantics", () => {
  it("exposes each day as a named section heading above match event headings", () => {
    const markup = renderToStaticMarkup(React.createElement(ScheduleDashboard, { initialData: payload }));

    expect(markup).toContain(`aria-labelledby="date-group-${matchDateKey}"`);
    expect(markup).toContain(`<h3 id="date-group-${matchDateKey}">`);
    expect(markup).toContain("<h4>LPL</h4>");
    expect(markup.indexOf(`<h3 id="date-group-${matchDateKey}">`))
      .toBeLessThan(markup.indexOf("<h4>LPL</h4>"));
  });
});
