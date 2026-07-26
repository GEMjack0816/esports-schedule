import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { describe, expect, it } from "vitest";
import {
  isAuthorizedAdminSubject,
  trustedRequestOrigin,
  verifyVercelIdentityToken,
} from "./vercel";

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

  it("accepts only explicitly configured production and local origins", () => {
    expect(trustedRequestOrigin(new Request("https://esports-schedule-two.vercel.app/admin")))
      .toBe("https://esports-schedule-two.vercel.app");
    expect(() => trustedRequestOrigin(new Request("https://evil.example/admin"))).toThrow();
  });
});
