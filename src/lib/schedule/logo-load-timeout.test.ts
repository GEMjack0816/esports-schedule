import { afterEach, describe, expect, it, vi } from "vitest";
import {
  displayedTeamLogoSource,
  recoverTeamLogo,
  startTeamLogoLoadTimeout,
  TEAM_LOGO_PLACEHOLDER,
  TEAM_LOGO_LOAD_TIMEOUT_MS,
} from "./logo-load-timeout";

describe("team logo load timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a bounded wait before falling back", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    startTeamLogoLoadTimeout(onTimeout);

    vi.advanceTimersByTime(TEAM_LOGO_LOAD_TIMEOUT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("clears the pending fallback once the image loads or component unmounts", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const cancel = startTeamLogoLoadTimeout(onTimeout);
    cancel();

    vi.advanceTimersByTime(TEAM_LOGO_LOAD_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("keeps offscreen and failed images on the local placeholder", () => {
    expect(displayedTeamLogoSource("https://cdn.example/team.png", "/team-placeholder.svg", false, "loading"))
      .toBe("/team-placeholder.svg");
    expect(displayedTeamLogoSource("https://cdn.example/team.png", "/team-placeholder.svg", true, "failed"))
      .toBe("/team-placeholder.svg");
    expect(displayedTeamLogoSource("https://cdn.example/team.png", "/team-placeholder.svg", true, "loaded"))
      .toBe("https://cdn.example/team.png");
  });

  it.each(["cdn.pandascore.co", "cdn-api.pandascore.co"])(
    "retries a canonical unsigned team image from %s once with a cache-busting query",
    (host) => {
      const recovery = recoverTeamLogo(`https://${host}/images/team/image/123/logo.webp`, false);
      expect(recovery.kind).toBe("retry");
      if (recovery.kind === "retry") {
        const url = new URL(recovery.src);
        expect(url.origin).toBe(`https://${host}`);
        expect(url.searchParams.get("esports_logo_retry")).toBe("1");
      }
    },
  );

  it("does not retry a PandaScore URL outside the canonical team-logo path", () => {
    expect(recoverTeamLogo("https://cdn.pandascore.co/images/player/image/123/logo.png", false)).toEqual({
      kind: "fallback",
      src: TEAM_LOGO_PLACEHOLDER,
    });
  });

  it("falls back after a retry or for non-PandaScore, signed, and non-HTTPS URLs", () => {
    expect(recoverTeamLogo("https://cdn-api.pandascore.co/images/team/image/123/logo.png", true)).toEqual({
      kind: "fallback",
      src: TEAM_LOGO_PLACEHOLDER,
    });
    for (const source of [
      "https://images.example.test/team.png",
      "http://cdn-api.pandascore.co/images/team/image/123/logo.png",
      "https://cdn-api.pandascore.co/images/team/image/123/logo.png?signature=opaque",
    ]) {
      expect(recoverTeamLogo(source, false)).toEqual({
        kind: "fallback",
        src: TEAM_LOGO_PLACEHOLDER,
      });
    }
  });

  it("does not retry lookalike hosts, credentials, non-default ports, fragments, or existing queries", () => {
    for (const source of [
      "https://cdn-api.pandascore.co.attacker.test/images/team/image/123/logo.png",
      "https://user:pass@cdn-api.pandascore.co/images/team/image/123/logo.png",
      "https://cdn-api.pandascore.co:8443/images/team/image/123/logo.png",
      "https://cdn-api.pandascore.co/images/team/image/123/logo.png#fragment",
      "https://cdn-api.pandascore.co/images/team/image/123/logo.png?version=2",
    ]) {
      expect(recoverTeamLogo(source, false), source).toEqual({
        kind: "fallback",
        src: TEAM_LOGO_PLACEHOLDER,
      });
    }
  });
});

