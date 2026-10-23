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
    "https://stream.example/live?X%2DAccess%2DKey=private",
    "https://stream.example/live?X%252DAPI%252DKey=private",
    "https://stream.example/live?x%2525252daccess%2525252dkey=private",
    "https://stream.example/live?x-aPi-KeY=private",
    "https://stream.example/live?token=",
    "https://stream.example/live#X%2DAuth%2DKey=private",
    "https://stream.example/live#X%252DAuth%252DKey=private",
    "https://stream.example/watch?redirect=https%3A%2F%2Faccounts.example%2Fcallback%3Faccess_token%3Dprivate",
    "https://stream.example/watch?next=%252Fadmin%253Ftoken%253Dprivate",
    "https://stream.example/watch#return=%252Fredirect%253Fclient_secret%253Dprivate",
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
    expect(sanitizePublicExternalUrl("https://stream.example/watch?redirect=https%3A%2F%2Fexample.com%2Fcallback%3Fmatch%3D42"))
      .toBe("https://stream.example/watch?redirect=https%3A%2F%2Fexample.com%2Fcallback%3Fmatch%3D42");
  });

  it("rejects credential parameters across encoded and nested URL forms", () => {
    const credentialNames = [
      "token",
      "access_token",
      "api_key",
      "x-access-key",
      "client_secret",
      "authorization",
      "session_id",
    ];
    let checked = 0;

    for (const name of credentialNames) {
      for (let encodingDepth = 0; encodingDepth < 5; encodingDepth += 1) {
        let encodedName = name.replace(/-/g, "%2D");
        for (let layer = 0; layer < encodingDepth; layer += 1) {
          encodedName = encodedName.replace(/%/g, "%25");
        }

        for (let nestedDepth = 0; nestedDepth < 4; nestedDepth += 1) {
          let candidate = `https://inner.example/callback?${encodedName}=sentinel`;
          for (let layer = 0; layer < nestedDepth; layer += 1) {
            candidate = `https://wrapper.example/?redirect=${encodeURIComponent(candidate)}`;
          }

          if (candidate.length <= 2_048) {
            expect(sanitizePublicExternalUrl(candidate)).toBeNull();
            checked += 1;
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(100);
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
