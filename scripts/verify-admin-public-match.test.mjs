import { describe, expect, it } from "vitest";
import { assertVerificationScheduleMatch } from "./verify-admin-public-match.mjs";

function payload(overrides = {}) {
  return {
    mode: "live",
    demoMode: false,
    matches: [{
      id: "manual:run-fixture",
      league: "Preview Cup",
      homeTeam: { name: "Team A" },
      awayTeam: { name: "Team B" },
    }],
    ...overrides,
  };
}

describe("verify:admin public schedule state assertions", () => {
  it("confirms approved match visibility by its exact teams", () => {
    expect(assertVerificationScheduleMatch(payload(), {
      teamA: "Team A",
      teamB: "Team B",
      shouldExist: true,
    })).toMatchObject({ id: "manual:run-fixture", league: "Preview Cup" });
  });

  it("confirms edits are visible on the public schedule by stable match ID", () => {
    const editedMatch = { ...payload().matches[0], league: "Preview Cup edited" };
    expect(assertVerificationScheduleMatch(payload({ matches: [editedMatch] }), {
      matchId: "manual:run-fixture",
      shouldExist: true,
      league: "Preview Cup edited",
    })).toMatchObject({ id: "manual:run-fixture", league: "Preview Cup edited" });
  });

  it("fails if a match expected to be hidden is still public", () => {
    expect(() => assertVerificationScheduleMatch(payload(), {
      matchId: "manual:run-fixture",
      shouldExist: false,
    })).toThrow(/should be hidden/);
  });

  it("confirms a hidden match is absent and a restored match is visible again", () => {
    expect(assertVerificationScheduleMatch(payload({ matches: [] }), {
      matchId: "manual:run-fixture",
      shouldExist: false,
    })).toBeNull();
    expect(assertVerificationScheduleMatch(payload(), {
      matchId: "manual:run-fixture",
      shouldExist: true,
      league: "Preview Cup",
    })).toMatchObject({ id: "manual:run-fixture" });
  });

  it("fails closed for unavailable/demo responses instead of treating them as hidden", () => {
    expect(() => assertVerificationScheduleMatch(payload({ mode: "unavailable", matches: [] }), {
      matchId: "manual:run-fixture",
      shouldExist: false,
    })).toThrow(/not live non-demo/);
    expect(() => assertVerificationScheduleMatch(payload({ demoMode: true, matches: [] }), {
      matchId: "manual:run-fixture",
      shouldExist: false,
    })).toThrow(/not live non-demo/);
  });

  it("rejects duplicate matches and edit mismatches", () => {
    expect(() => assertVerificationScheduleMatch(payload({ matches: [...payload().matches, ...payload().matches] }), {
      matchId: "manual:run-fixture",
      shouldExist: true,
    })).toThrow(/missing or duplicated/);
    expect(() => assertVerificationScheduleMatch(payload(), {
      matchId: "manual:run-fixture",
      shouldExist: true,
      league: "Wrong title",
    })).toThrow(/edit is not visible/);
  });
});
