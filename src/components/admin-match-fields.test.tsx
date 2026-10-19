import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubmissionFields, PublishedMatchFields } from "./admin-match-fields";
import type { MatchSubmissionRow } from "@/db/schema";
import type { PublishedMatchWrite } from "@/lib/review/types";

describe("admin datetime fields", () => {
  it("labels UTC values and renders the stored UTC wall-clock value", () => {
    const submission = {
      game: "lol",
      league: "LPL",
      teamA: "Alpha",
      teamB: "Bravo",
      scheduledAt: new Date("2026-08-20T03:45:00.000Z"),
      bestOf: 3,
      sourceUrl: "https://example.com/match",
      notes: null,
    } as unknown as MatchSubmissionRow;
    const published: PublishedMatchWrite = {
      game: "lol",
      league: "LPL",
      tournament: null,
      stage: null,
      homeTeamName: "Alpha",
      homeTeamAcronym: null,
      homeTeamLogo: null,
      awayTeamName: "Bravo",
      awayTeamAcronym: null,
      awayTeamLogo: null,
      startTimeUtc: "2026-08-20T03:45:00.000Z",
      bestOf: 3,
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      streamUrl: null,
      sourceUrl: null,
    };

    const html = renderToStaticMarkup(
      <>
        <SubmissionFields row={submission} />
        <PublishedMatchFields value={published} />
      </>,
    );

    expect(html.match(/开始时间（UTC）/g)).toHaveLength(2);
    expect(html.match(/value="2026-08-20T03:45"/g)).toHaveLength(2);
  });
});
