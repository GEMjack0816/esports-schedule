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
    "https://stream.example/live?cookie=session-value",
    "https://stream.example/live?X-Session-Cookie=session-value",
    "https://stream.example/live#set-cookie=session-value",
    "https://stream.example/live;cookie=session-value",
    "https://stream.example/live;jsessionid=private",
    "https://stream.example/watch/token/opaque-secret",
    "https://stream.example/watch/access_token/opaque-secret",
    "https://stream.example/watch/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.signature",
    "https://stream.example/live%3Bsession_id%3Dprivate",
    "https://stream.example/live%253BX%252DAPI%252DKey%253Dprivate",
    "https://stream.example/live;X-Access-Key=private",
    "https://stream.example/live?API-Key=private",
    "https://stream.example/live?X-API-Key=private",
    "https://stream.example/live?X-API-Key-Id=private",
    "https://stream.example/live?X-Auth=private",
    "https://stream.example/live?auth_key=private",
    "https://stream.example/live?X-Auth-Key=private",
    "https://stream.example/live?X-Session=private",
    "https://stream.example/live?X-Access-Key=private",
    "https://stream.example/live?subscription-key=private",
    "https://stream.example/live?Ocp-Apim-Subscription-Key=private",
    "https://stream.example/live?x%2Dsubscription%2Dkey=private",
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
    "https://stream.example/live?client_assertion=eyJhbGciOiJSUzI1NiJ9",
    "https://stream.example/live?assertion=eyJhbGciOiJSUzI1NiJ9",
    "https://stream.example/live?code_verifier=high-entropy-value",
    "https://stream.example/live?id_token_hint=eyJhbGciOiJSUzI1NiJ9",
    "https://stream.example/live?SAMLResponse=base64-assertion",
    "https://preview.example/?x-vercel-protection-bypass=opaque-value",
    "https://stream.example/watch?cf_clearance=opaque-value",
    "https://stream.example/callback?oauth_code=one-time-credential",
    "https://stream.example/callback?auth_code=one-time-credential",
    "https://stream.example/callback?access_code=one-time-credential",
    "https://stream.example/callback?X-OAuth-Code=one-time-credential",
    "https://stream.example/live?X-Client-Assertion=eyJhbGciOiJSUzI1NiJ9",
    "https://stream.example/live?X-Code-Verifier=high-entropy-value",
    "https://stream.example/live?X-ID-Token-Hint=eyJhbGciOiJSUzI1NiJ9",
    "https://stream.example/live?X-SAML-Response=base64-assertion",
    "https://stream.example/live?foo=1#client_secret=private",
    "https://viewer:password@stream.example/live",
    "http://stream.example/live",
    "not a URL",
  ])("rejects credentialed or non-public URL %s", (value) => {
    expect(sanitizePublicExternalUrl(value)).toBeNull();
  });

  it("fails closed when credential path encoding reaches the inspection limit", () => {
    function encodeLayers(value: string, layers: number): string {
      let candidate = value;
      for (let layer = 0; layer < layers; layer += 1) {
        candidate = candidate.replace(/%/g, "%25");
      }
      return candidate;
    }

    for (const layers of [31, 32, 33]) {
      const encodedSlashPath = encodeLayers("%2Ftoken%2Fopaque-test-marker", layers);
      const encodedNamePath = encodeLayers("%74%6f%6b%65%6e%2Fopaque-test-marker", layers);
      expect(sanitizePublicExternalUrl(`https://stream.example/watch/${encodedSlashPath}`)).toBeNull();
      expect(sanitizePublicExternalUrl(`https://stream.example/watch/${encodedNamePath}`)).toBeNull();
    }
  });

  it("keeps ordinary public stream links and harmless query parameters", () => {
    expect(sanitizePublicExternalUrl("https://www.youtube.com/watch?v=abc&t=30s"))
      .toBe("https://www.youtube.com/watch?v=abc&t=30s");
    expect(sanitizePublicExternalUrl("https://stream.example/live?monkey=business"))
      .toBe("https://stream.example/live?monkey=business");
    expect(sanitizePublicExternalUrl("https://stream.example/watch?redirect=https%3A%2F%2Fexample.com%2Fcallback%3Fmatch%3D42"))
      .toBe("https://stream.example/watch?redirect=https%3A%2F%2Fexample.com%2Fcallback%3Fmatch%3D42");
    expect(sanitizePublicExternalUrl("https://example.com/?x-vercel-region=iad1"))
      .toBe("https://example.com/?x-vercel-region=iad1");
    expect(sanitizePublicExternalUrl("https://example.com/?x-vercel-set-bypass-cookie=true"))
      .toBe("https://example.com/?x-vercel-set-bypass-cookie=true");
    expect(sanitizePublicExternalUrl("https://stream.example/match?match_code=42"))
      .toBe("https://stream.example/match?match_code=42");
    expect(sanitizePublicExternalUrl("https://stream.example/match;view=full"))
      .toBe("https://stream.example/match;view=full");
    expect(sanitizePublicExternalUrl("https://stream.example/matches/season-2026/game-3"))
      .toBe("https://stream.example/matches/season-2026/game-3");
    expect(sanitizePublicExternalUrl("https://stream.example/watch?cookie_consent=accepted"))
      .toBe("https://stream.example/watch?cookie_consent=accepted");
  });

  it("keeps public OAuth metadata that does not contain authentication credentials", () => {
    expect(sanitizePublicExternalUrl(
      "https://login.example/authorize?client_id=public-client&code_challenge=abc&code_challenge_method=S256&client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer",
    )).not.toBeNull();
  });

  it("rejects credential parameters across encoded and nested URL forms", () => {
    const credentialNames = [
      "token",
      "access_token",
      "api_key",
      "x-access-key",
      "subscription-key",
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

  it.each([
    `https://stream.example/watch?redirect=${encodeURIComponent("https://viewer:password@inner.example/live")}`,
    `https://stream.example/watch#return=${encodeURIComponent("https://viewer:password@inner.example/live")}`,
    `https://stream.example/watch?next=${encodeURIComponent("//viewer:password@inner.example/live")}`,
    `https://stream.example/watch?next=${encodeURIComponent("https://inner.example/live;jsessionid=private")}`,
    `https://stream.example/watch?next=${encodeURIComponent("https://inner.example/watch/token/opaque-secret")}`,
  ])("rejects userinfo hidden in a nested URL", (value) => {
    expect(sanitizePublicExternalUrl(value)).toBeNull();
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
    expect(sanitizePublicTeam({ name: "Team", logo: "/logo.svg;jsessionid=secret" }).logo)
      .toBe("/team-placeholder.svg");
  });

  it("scans long ordinary paths without changing their public URL", () => {
    const path = Array.from({ length: 900 }, () => "r").join("/");
    const url = `https://stream.example/matches/${path}`;

    expect(sanitizePublicExternalUrl(url)).toBe(url);
  });

  it("bounds local logo paths to the same public URL limit", () => {
    const atLimit = `/${"a".repeat(2_047)}`;
    const overLimit = `/${"a".repeat(2_048)}`;

    expect(sanitizePublicTeam({ name: "Team", logo: atLimit }).logo).toBe(atLimit);
    expect(sanitizePublicTeam({ name: "Team", logo: overLimit }).logo)
      .toBe("/team-placeholder.svg");
  });
});
