import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import {
  isPandaScoreCdnLogo,
  resolveTeamLogoSource,
  TEAM_LOGO_PLACEHOLDER,
} from "./team-logo";

describe("Next Image optimizer restrictions", () => {
  it("limits remote optimization to small, redirect-free team logos", () => {
    expect(nextConfig.images).toMatchObject({
      maximumRedirects: 0,
      maximumResponseBody: 5_000_000,
      dangerouslyAllowLocalIP: false,
      remotePatterns: [{
        protocol: "https",
        hostname: "cdn.pandascore.co",
        port: "",
        pathname: "/images/team/image/**",
        search: "",
      }],
    });
  });
});

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
    "https://cdn.pandascore.co/images/league/image/123/logo.png",
    "https://cdn.pandascore.co/images/team/image/125063/team.png?size=large",
    "https://cdn.pandascore.co/images/team/image/125063/team.png#fragment",
    "/team-placeholder.svg",
    "not a URL",
  ])("does not optimize untrusted or non-CDN source %s", (source) => {
    expect(isPandaScoreCdnLogo(source)).toBe(false);
  });
});

describe("resolveTeamLogoSource", () => {
  it("switches an errored optimized source to the local unoptimized placeholder", () => {
    const source = "https://cdn.pandascore.co/images/team/image/125063/team.png";
    const resolved = resolveTeamLogoSource(source, source);

    expect(resolved).toBe(TEAM_LOGO_PLACEHOLDER);
    expect(isPandaScoreCdnLogo(resolved)).toBe(false);
  });

  it("allows a refreshed source to retry after an earlier URL failed", () => {
    const failedSource = "https://cdn.pandascore.co/images/team/image/123/old.png";
    const refreshedSource = "https://cdn.pandascore.co/images/team/image/123/new.png";

    expect(resolveTeamLogoSource(refreshedSource, failedSource)).toBe(refreshedSource);
  });

  it("uses the local placeholder when no logo is available", () => {
    expect(resolveTeamLogoSource("", null)).toBe(TEAM_LOGO_PLACEHOLDER);
  });
});
