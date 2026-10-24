import { describe, expect, it } from "vitest";
import { matchesExpectedCommitSha, resolveExpectedCommitSha } from "./verify-browser-fingerprint.mjs";

const expected = "a".repeat(40);

describe("browser verification commit fingerprint", () => {
  it("accepts an optional SHA from the CLI or environment", () => {
    expect(resolveExpectedCommitSha(expected, undefined)).toBe(expected);
    expect(resolveExpectedCommitSha(undefined, expected.toUpperCase())).toBe(expected);
    expect(resolveExpectedCommitSha(undefined, undefined)).toBeNull();
  });

  it("rejects malformed or conflicting expected SHAs", () => {
    expect(() => resolveExpectedCommitSha("abc", undefined)).toThrow("full 40-character hexadecimal SHA");
    expect(() => resolveExpectedCommitSha(expected, "b".repeat(40))).toThrow("conflicts with EXPECTED_GIT_COMMIT_SHA");
  });

  it("accepts matching homepage, version, and health fingerprints", () => {
    expect(matchesExpectedCommitSha(expected, {
      homepage: expected,
      version: expected,
      health: expected,
    })).toBe(true);
  });

  it("rejects a self-consistent stale build when an expected SHA was supplied", () => {
    const stale = "b".repeat(40);
    expect(matchesExpectedCommitSha(expected, {
      homepage: stale,
      version: stale,
      health: stale,
    })).toBe(false);
  });

  it("rejects a mixed deployment even when the homepage and version agree", () => {
    expect(matchesExpectedCommitSha(expected, {
      homepage: expected,
      version: expected,
      health: "b".repeat(40),
    })).toBe(false);
  });
});
