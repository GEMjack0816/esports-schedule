import { afterEach, describe, expect, it, vi } from "vitest";
import {
  displayedTeamLogoSource,
  startTeamLogoLoadTimeout,
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
});
