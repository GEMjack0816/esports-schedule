import { describe, expect, it } from "vitest";
import {
  createSubmissionFingerprint,
  isHoneypotHit,
  SubmissionValidationError,
  validateOptionalHttpUrl,
  validateOptionalHttpsUrl,
  validateOptionalText,
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
    [{ ...valid, sourceUrl: "https://user:password@example.com/match" }],
    [{ ...valid, notes: "x".repeat(1001) }],
  ])("rejects malformed or unsafe values", (candidate) => {
    expect(() => validateSubmission(candidate)).toThrow(SubmissionValidationError);
  });

  it.each([
    ["league", "LPL\u0000spoof"],
    ["teamA", "Alpha\u001B[31m"],
    ["teamB", "Beta\u202Etxt.exe"],
    ["notes", "trusted\u2066untrusted\u2069"],
  ])("rejects non-printing or bidirectional controls in %s", (field, value) => {
    expect(() => validateSubmission({ ...valid, [field]: value })).toThrow(
      new SubmissionValidationError("字段包含不允许的控制字符。"),
    );
  });

  it("keeps ordinary multilingual text and whitespace normalization valid", () => {
    expect(validateSubmission({
      ...valid,
      league: "  بطولة   العالم  ",
      teamA: "فريق ألفا",
      teamB: "战队 β",
      notes: "第一行\n第二行",
    })).toMatchObject({
      league: "بطولة العالم",
      teamA: "فريق ألفا",
      teamB: "战队 β",
      notes: "第一行 第二行",
    });
  });

  it("applies the same controls to optional administrator fields", () => {
    expect(() => validateOptionalText("stage\u0000hidden", 120)).toThrow(SubmissionValidationError);
    expect(() => validateOptionalHttpUrl("https://user:password@example.com/source")).toThrow(
      SubmissionValidationError,
    );
    expect(() => validateOptionalHttpsUrl("https://user:password@example.com/logo.png")).toThrow(
      SubmissionValidationError,
    );
    expect(validateOptionalText(null, 120)).toBeNull();
    expect(validateOptionalHttpsUrl("")).toBeNull();
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
