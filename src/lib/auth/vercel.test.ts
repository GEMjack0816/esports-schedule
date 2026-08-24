import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { describe, expect, it } from "vitest";
import {
  authCookieNames,
  isAuthorizedAdminSubject,
  isPreviewOauthSubDiagnostic,
  PREVIEW_OAUTH_SUB_DIAGNOSTIC_PATH,
  trustedMutationOrigin,
  trustedRequestOrigin,
  usesSecureAuthCookies,
  verifyVercelIdentityToken,
} from "./vercel";
import { safeAdminReturnPath } from "./paths";

async function identityToken(overrides: {
  nonce?: string;
  issuer?: string;
  audience?: string;
  expiresAt?: number;
} = {}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const kid = "test-key";
  const token = await new SignJWT({ nonce: overrides.nonce ?? "nonce-1" })
    .setProtectedHeader({ alg: "RS256", kid })
    .setSubject("user_stable_123")
    .setIssuer(overrides.issuer ?? "https://vercel.com")
    .setAudience(overrides.audience ?? "client-123")
    .setIssuedAt()
    .setExpirationTime(overrides.expiresAt ?? Math.floor(Date.now() / 1000) + 60)
    .sign(privateKey);
  return {
    token,
    key: createLocalJWKSet({ keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }] }),
  };
}

describe("Vercel administrator identity validation", () => {
  it("validates signature, issuer, audience, expiry and nonce", async () => {
    const { token, key } = await identityToken();
    await expect(verifyVercelIdentityToken(token, "nonce-1", "client-123", key))
      .resolves.toBe("user_stable_123");
  });

  it.each([
    { nonce: "wrong" },
    { issuer: "https://attacker.example" },
    { audience: "other-client" },
    { expiresAt: Math.floor(Date.now() / 1000) - 10 },
  ])("rejects invalid ID token claims: %o", async (overrides) => {
    const { token, key } = await identityToken(overrides);
    await expect(verifyVercelIdentityToken(token, "nonce-1", "client-123", key)).rejects.toThrow();
  });

  it("uses a stable subject whitelist with exact matching", () => {
    expect(isAuthorizedAdminSubject("user_2", "user_1, user_2")).toBe(true);
    expect(isAuthorizedAdminSubject("user", "user_1, user_2")).toBe(false);
  });

  it("enables the temporary OIDC sub diagnostic only for the exact Preview path", () => {
    expect(isPreviewOauthSubDiagnostic(PREVIEW_OAUTH_SUB_DIAGNOSTIC_PATH, "preview")).toBe(true);
    expect(isPreviewOauthSubDiagnostic(PREVIEW_OAUTH_SUB_DIAGNOSTIC_PATH, "production")).toBe(false);
    expect(isPreviewOauthSubDiagnostic("/admin", "preview")).toBe(false);
    expect(isPreviewOauthSubDiagnostic(
      PREVIEW_OAUTH_SUB_DIAGNOSTIC_PATH,
      undefined,
      "https://preview.example",
      "preview.example",
      "agent/add-submission-review-workflow",
    )).toBe(true);
    expect(isPreviewOauthSubDiagnostic(
      PREVIEW_OAUTH_SUB_DIAGNOSTIC_PATH,
      undefined,
      "https://production.example",
      "preview.example",
      "agent/add-submission-review-workflow",
    )).toBe(false);
  });

  it("accepts only explicitly configured production and local origins", () => {
    expect(trustedRequestOrigin(new Request("https://esports-schedule-two.vercel.app/admin")))
      .toBe("https://esports-schedule-two.vercel.app");
    expect(() => trustedRequestOrigin(new Request("https://evil.example/admin"))).toThrow();
  });

  it("requires browser mutations to come from the same trusted origin", () => {
    const accepted = new Request("https://esports-schedule-two.vercel.app/api/auth/signout", {
      method: "POST",
      headers: { Origin: "https://esports-schedule-two.vercel.app" },
    });
    expect(trustedMutationOrigin(accepted)).toBe("https://esports-schedule-two.vercel.app");

    const missing = new Request("https://esports-schedule-two.vercel.app/api/auth/signout", {
      method: "POST",
    });
    expect(() => trustedMutationOrigin(missing)).toThrow();

    const crossSite = new Request("https://esports-schedule-two.vercel.app/api/auth/signout", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(() => trustedMutationOrigin(crossSite)).toThrow();
  });

  it("uses __Host cookies only on secure production origins", () => {
    expect(usesSecureAuthCookies("production")).toBe(true);
    expect(usesSecureAuthCookies("preview")).toBe(true);
    expect(usesSecureAuthCookies("development")).toBe(false);
    expect(usesSecureAuthCookies(undefined)).toBe(false);
    expect(Object.values(authCookieNames(true)).every((name) => name.startsWith("__Host-")))
      .toBe(true);
    expect(Object.values(authCookieNames(false)).every((name) => !name.startsWith("__Host-")))
      .toBe(true);
  });

  it.each([
    ["/admin", "/admin"],
    ["/admin/submissions?status=pending", "/admin/submissions?status=pending"],
    ["/administrator", "/admin"],
    ["//evil.example/admin", "/admin"],
    ["https://evil.example/admin", "/admin"],
  ])("keeps administrator return paths internal: %s", (input, expected) => {
    expect(safeAdminReturnPath(input)).toBe(expected);
  });
});
