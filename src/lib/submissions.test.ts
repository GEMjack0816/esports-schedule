import { describe, expect, it } from "vitest";
import {
  createSubmissionFingerprint,
  isHoneypotHit,
  SubmissionValidationError,
  validateSubmission,
} from "./submissions";

const valid = {
  game: "lol",
  league: " LPL   夏季赛 ",
  teamA: " Team A ",
  teamB: "Team B",
  scheduledAt: "2026-08-01T12:00:00+08:00",
  bestOf: 3,
  sourceUrl: "https://example.com/match",
  notes: " 官方公告 ",
};

describe("public match submission validation", () => {
  it("normalizes fields and persists time as UTC", () => {
    expect(validateSubmission(valid)).toEqual({
      game: "lol",
      league: "LPL 夏季赛",
      teamA: "Team A",
      teamB: "Team B",
      scheduledAt: "2026-08-01T04:00:00.000Z",
      bestOf: 3,
      sourceUrl: "https://example.com/match",
      notes: "官方公告",
    });
  });

  it.each([
    [{ ...valid, game: "unknown" }],
    [{ ...valid, teamB: "team a" }],
    [{ ...valid, bestOf: 11 }],
    [{ ...valid, sourceUrl: "javascript:alert(1)" }],
    [{ ...valid, notes: "x".repeat(1001) }],
  ])("rejects malformed or unsafe values", (candidate) => {
    expect(() => validateSubmission(candidate)).toThrow(SubmissionValidationError);
  });

  it.each([
    "https://reviewer:password@example.com/match",
    "http://example.com/match?access_token=private",
  ])("rejects credential-bearing source URLs before persistence: %s", (sourceUrl) => {
    expect(() => validateSubmission({ ...valid, sourceUrl }))
      .toThrow("来源链接不能包含账号凭据或访问令牌。");
  });

  it("deduplicates reversed teams through the same canonical fingerprint", () => {
    const first = validateSubmission(valid);
    const second = validateSubmission({ ...valid, teamA: "team b", teamB: "TEAM A" });
    expect(createSubmissionFingerprint(first)).toBe(createSubmissionFingerprint(second));
  });

  it("detects the hidden bot field without treating missing values as a hit", () => {
    expect(isHoneypotHit({ website: "bot.example" })).toBe(true);
    expect(isHoneypotHit({ website: "" })).toBe(false);
    expect(isHoneypotHit({})).toBe(false);
  });
});
