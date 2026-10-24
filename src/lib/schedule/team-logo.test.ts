import { describe, expect, it } from "vitest";
import {
  isCompletedImageFailure,
  isPandaScoreTeamLogoUrl,
  retryPandaScoreTeamLogoUrl,
} from "./team-logo";

describe("completed image state", () => {
  it("recognizes a failed image whose error event may have preceded hydration", () => {
    expect(isCompletedImageFailure(true, 0)).toBe(true);
    expect(isCompletedImageFailure(true, 28)).toBe(false);
    expect(isCompletedImageFailure(false, 0)).toBe(false);
  });
});

describe("isPandaScoreTeamLogoUrl", () => {
  it("allows canonical official team logo paths", () => {
    expect(isPandaScoreTeamLogoUrl(
      "https://cdn.pandascore.co/images/team/image/125063/sengoku-gaming.png",
    )).toBe(true);
    expect(isPandaScoreTeamLogoUrl(
      "https://cdn.pandascore.co/images/team/image/125063/thumb_sengoku-gaming.png",
    )).toBe(true);
    expect(isPandaScoreTeamLogoUrl(
      "https://cdn.pandascore.co/images/team/image/125063/logo.webp",
    )).toBe(true);
  });

  it("allows the API CDN hostname currently returned for production team logos", () => {
    expect(isPandaScoreTeamLogoUrl(
      "https://cdn-api.pandascore.co/images/team/image/136955/fut_esportslogo_square.png",
    )).toBe(true);
  });

  it.each([
    "http://cdn.pandascore.co/images/team/image/125063/logo.png",
    "https://cdn.pandascore.co.evil.example/images/team/image/125063/logo.png",
    "https://cdn-api.pandascore.co.evil.example/images/team/image/125063/logo.png",
    "https://images.pandascore.co/images/team/image/125063/logo.png",
    "https://cdn.pandascore.co/images/league/image/125063/logo.png",
    "https://cdn.pandascore.co/images/team/image/not-a-number/logo.png",
    "https://cdn.pandascore.co/images/team/image/125063/logo.png?token=example",
    "https://user:pass@cdn.pandascore.co/images/team/image/125063/logo.png",
    "https://cdn.pandascore.co/images/team/image/125063/logo.svg",
    "https://cdn.pandascore.co/images/team/image/125063/logo%2f..%2fother.png",
    "https://cdn.pandascore.co:8443/images/team/image/125063/logo.png",
    "/team-placeholder.svg",
    "not a URL",
  ])("rejects non-canonical or non-PandaScore source %s", (value) => {
    expect(isPandaScoreTeamLogoUrl(value)).toBe(false);
  });
});

describe("retryPandaScoreTeamLogoUrl", () => {
  it("adds a distinct retry cache key only to a canonical CDN URL", () => {
    expect(retryPandaScoreTeamLogoUrl(
      "https://cdn-api.pandascore.co/images/team/image/136955/logo.png",
    )).toBe("https://cdn-api.pandascore.co/images/team/image/136955/logo.png?esports_logo_retry=1");
    expect(retryPandaScoreTeamLogoUrl("https://images.example.test/logo.png")).toBeNull();
  });
});
