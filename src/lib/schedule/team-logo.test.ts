import { describe, expect, it } from "vitest";
import { isPandaScoreCdnLogo } from "./team-logo";

describe("isPandaScoreCdnLogo", () => {
  it("allows HTTPS images on PandaScore's documented image CDN", () => {
    expect(isPandaScoreCdnLogo(
      "https://cdn.pandascore.co/images/team/image/125063/team.png",
    )).toBe(true);
  });

  it.each([
    "http://cdn.pandascore.co/images/team.png",
    "https://cdn.pandascore.co.attacker.example/images/team.png",
    "https://attacker.example/images/team.png",
    "https://cdn.pandascore.co:8443/images/team.png",
    "https://user@cdn.pandascore.co/images/team.png",
    "https://cdn.pandascore.co/avatar/team.png",
    "/team-placeholder.svg",
    "not a URL",
  ])("does not optimize untrusted or non-CDN source %s", (source) => {
    expect(isPandaScoreCdnLogo(source)).toBe(false);
  });
});
