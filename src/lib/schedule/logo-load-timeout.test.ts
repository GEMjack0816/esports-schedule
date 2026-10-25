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

  it("retries an unsigned PandaScore CDN image once with a cache-busting query", () => {
    const recovery = recoverTeamLogo("https://cdn-api.pandascore.co/team/image.png", false);
    expect(recovery.kind).toBe("retry");
    if (recovery.kind === "retry") {
      const url = new URL(recovery.src);
      expect(url.origin).toBe("https://cdn-api.pandascore.co");
      expect(url.searchParams.get("esports_logo_retry")).toBe("1");
    }
  });

  it("falls back after a retry or for non-PandaScore, signed, and non-HTTPS URLs", () => {
    expect(recoverTeamLogo("https://cdn-api.pandascore.co/team/image.png", true)).toEqual({
      kind: "fallback",
      src: TEAM_LOGO_PLACEHOLDER,
    });
    for (const source of [
      "https://images.example.test/team.png",
      "http://cdn-api.pandascore.co/team/image.png",
      "https://cdn-api.pandascore.co/team/image.png?signature=opaque",
    ]) {
      expect(recoverTeamLogo(source, false)).toEqual({
        kind: "fallback",
        src: TEAM_LOGO_PLACEHOLDER,
      });
    }
  });

  it("does not retry lookalike hosts, credentials, non-default ports, fragments, or existing queries", () => {
    for (const source of [
      "https://cdn-api.pandascore.co.attacker.test/team.png",
      "https://user:pass@cdn-api.pandascore.co/team.png",
      "https://cdn-api.pandascore.co:8443/team.png",
      "https://cdn-api.pandascore.co/team.png#fragment",
      "https://cdn-api.pandascore.co/team.png?version=2",
    ]) {
      expect(recoverTeamLogo(source, false), source).toEqual({
        kind: "fallback",
        src: TEAM_LOGO_PLACEHOLDER,
      });
    }
  });
});

