import { describe, expect, it } from "vitest";
import {
  sanitizePublicExternalUrl,
  sanitizePublicHttpUrl,
  sanitizePublicStreams,
  sanitizePublicTeam,
} from "./stream-url";

describe("public external URL sanitization", () => {
  it.each([
    "https://stream.example/live?access_token=private",
    "https://stream.example/live?API-Key=private",
    "https://stream.example/live?X-API-Key=private",
    "https://stream.example/live?X-API-Key-Id=private",
    "https://stream.example/live?X-Auth=private",
    "https://stream.example/live?auth_key=private",
    "https://stream.example/live?X-Auth-Key=private",
    "https://stream.example/live?X-Session=private",
    "https://stream.example/live?X-Access-Key=private",
    "https://stream.example/live?X-Access-Key-Id=private",
    "https://cdn.example/image?X-Amz-Credential=key%2Fscope&X-Amz-Signature=private",
    "https://cdn.example/image?X-Goog-Signature=private",
    "https://stream.example/live?auth_token=private",
    "https://cdn.example/image?AWSAccessKeyId=private",
    "https://stream.example/live?session_id=private",
    "https://stream.example/live?foo=1#client_secret=private",
    "https://viewer:password@stream.example/live",
    "http://stream.example/live",
    "not a URL",
  ])("rejects credentialed or non-public URL %s", (value) => {
    expect(sanitizePublicExternalUrl(value)).toBeNull();
  });

  it("keeps ordinary public stream links and harmless query parameters", () => {
    expect(sanitizePublicExternalUrl("https://www.youtube.com/watch?v=abc&t=30s"))
      .toBe("https://www.youtube.com/watch?v=abc&t=30s");
    expect(sanitizePublicExternalUrl("https://stream.example/live?monkey=business"))
      .toBe("https://stream.example/live?monkey=business");
  });

  it("keeps public HTTP source links but rejects credentials in either protocol", () => {
    expect(sanitizePublicHttpUrl("http://league.example/match?id=42"))
      .toBe("http://league.example/match?id=42");
    expect(sanitizePublicHttpUrl("http://user:password@league.example/match")).toBeNull();
    expect(sanitizePublicHttpUrl("https://league.example/match?api_key=private")).toBeNull();
  });

  it("removes unsafe URLs without dropping safe stream entries", () => {
    expect(sanitizePublicStreams([
      { label: "unsafe", url: "https://stream.example/live?token=secret" },
      { label: "safe", url: "https://stream.example/live", official: true },
    ])).toEqual([{ label: "safe", url: "https://stream.example/live", official: true }]);
  });

  it("replaces credentialed public team logos with the local placeholder", () => {
    expect(sanitizePublicTeam({ name: "Team", logo: "https://cdn.example/logo.svg?token=secret" }))
      .toEqual({ name: "Team", logo: "/team-placeholder.svg" });
    expect(sanitizePublicTeam({ name: "Team", logo: "/team-placeholder.svg" }).logo)
      .toBe("/team-placeholder.svg");
    expect(sanitizePublicTeam({ name: "Team", logo: "/\\attacker.example/logo.svg" }).logo)
      .toBe("/team-placeholder.svg");
    expect(sanitizePublicTeam({ name: "Team", logo: "/logo.svg?access_token=secret" }).logo)
      .toBe("/team-placeholder.svg");
  });
});
