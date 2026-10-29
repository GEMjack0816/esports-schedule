import { describe, expect, it } from "vitest";
import { recoverTeamLogo, TEAM_LOGO_PLACEHOLDER } from "./team-logo";

describe("team logo recovery", () => {
  it("retries an unsigned PandaScore CDN logo once with a cache-busting query", () => {
    const recovery = recoverTeamLogo(
      "https://cdn.pandascore.co/images/team/image/125063/sengoku-gaming-gnat0l9c.png",
      false,
    );
    expect(recovery.kind).toBe("retry");
    if (recovery.kind === "retry") {
      const url = new URL(recovery.src);
      expect(url.origin).toBe("https://cdn.pandascore.co");
      expect(url.searchParams.get("esports_logo_retry")).toBe("1");
    }
  });

  it("falls back after the bounded retry has failed", () => {
    expect(recoverTeamLogo("https://cdn.pandascore.co/images/team/image/125063/logo.png", true)).toEqual({
      kind: "fallback",
      src: TEAM_LOGO_PLACEHOLDER,
    });
  });

  it("does not retry arbitrary hosts, the API host, or non-HTTPS sources", () => {
    expect(recoverTeamLogo("https://images.example.test/team.png", false)).toEqual({
      kind: "fallback",
      src: TEAM_LOGO_PLACEHOLDER,
    });
    expect(recoverTeamLogo("https://cdn-api.pandascore.co/team/image.png", false)).toEqual({
      kind: "fallback",
      src: TEAM_LOGO_PLACEHOLDER,
    });
    expect(recoverTeamLogo("http://cdn.pandascore.co/team/image.png", false)).toEqual({
      kind: "fallback",
      src: TEAM_LOGO_PLACEHOLDER,
    });
  });

  it("preserves URLs with query parameters instead of risking signed URL invalidation", () => {
    expect(recoverTeamLogo("https://cdn.pandascore.co/team/image.png?signature=opaque", false)).toEqual({
      kind: "fallback",
      src: TEAM_LOGO_PLACEHOLDER,
    });
  });
});
