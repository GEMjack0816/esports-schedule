import { describe, expect, it } from "vitest";
import { isPandaScoreTeamLogoUrl } from "./team-logo";

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

  it.each([
    "http://cdn.pandascore.co/images/team/image/125063/logo.png",
    "https://cdn.pandascore.co.evil.example/images/team/image/125063/logo.png",
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
