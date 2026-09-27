import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

const authCookieStore = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => authCookieStore }));

import {
  AuthForbiddenError,
  authCookieNames,
  completeVercelAuthorization,
  isAuthorizedAdminSubject,
  revokeAccessTokenWithRetry,
  revokeRejectedAccessToken,
  trustedMutationOrigin,
  trustedRequestOrigin,
  usesSecureAuthCookies,
  verifyVercelIdentityToken,
} from "./vercel";
import { safeAdminReturnPath } from "./paths";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  authCookieStore.get.mockReset();
  authCookieStore.set.mockReset();
});

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

  it("revokes an exchanged access token when authorization is rejected", async () => {
    const revoke = vi.fn(async () => undefined);
    const failure = new AuthForbiddenError("rejected");

    await expect(revokeRejectedAccessToken(
      "access-token",
      revoke,
      async () => { throw failure; },
    )).rejects.toBe(failure);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("access-token");
  });

  it("does not let a revocation failure mask the authorization failure", async () => {
    const failure = new AuthForbiddenError("rejected");

    await expect(revokeRejectedAccessToken(
      "access-token",
      async () => { throw new Error("revocation unavailable"); },
      async () => { throw failure; },
    )).rejects.toBe(failure);
  });

  it("retains an access token only after authorization succeeds", async () => {
    const revoke = vi.fn(async () => undefined);

    await expect(revokeRejectedAccessToken(
      "access-token",
      revoke,
      async () => "/admin",
    )).resolves.toBe("/admin");
    expect(revoke).not.toHaveBeenCalled();
  });

  it("accepts a successful token revocation without retrying", async () => {
    const request = vi.fn(async () => ({ ok: true, status: 204 }));
    const wait = vi.fn(async () => undefined);

    await expect(revokeAccessTokenWithRetry(request, wait)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it.each([429, 503])("retries a transient token revocation failure: HTTP %s", async (status) => {
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: false, status })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    const wait = vi.fn(async () => undefined);

    await expect(revokeAccessTokenWithRetry(request, wait)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledExactlyOnceWith(100);
  });

  it("retries a network failure once", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ ok: true, status: 204 });
    const wait = vi.fn(async () => undefined);

    await expect(revokeAccessTokenWithRetry(request, wait)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledExactlyOnceWith(100);
  });

  it("fails closed without retrying a permanent revocation rejection", async () => {
    const request = vi.fn(async () => ({ ok: false, status: 400 }));
    const wait = vi.fn(async () => undefined);

    await expect(revokeAccessTokenWithRetry(request, wait))
      .rejects.toThrow("Vercel token revocation failed with HTTP 400.");
    expect(request).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("rejects redirects on token exchange and revocation requests", async () => {
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_APP_CLIENT_ID", "client-test");
    vi.stubEnv("VERCEL_APP_CLIENT_SECRET", "secret-test");
    vi.stubEnv("ADMIN_VERCEL_USER_IDS", "admin-test");

    const names = authCookieNames(false);
    const cookieValues = new Map([
      [names.state, "state-test"],
      [names.nonce, "nonce-test"],
      [names.verifier, "verifier-test"],
    ]);
    authCookieStore.get.mockImplementation((name: string) => {
      const value = cookieValues.get(name);
      return value === undefined ? undefined : { value };
    });

    const mockedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "opaque-test-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", mockedFetch);

    const callback = new Request(
      "http://localhost:3000/api/auth/callback?code=authorization-code&state=state-test",
    );
    await expect(completeVercelAuthorization(callback)).rejects.toBeInstanceOf(AuthForbiddenError);

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch.mock.calls.map(([, init]) => (init as RequestInit).redirect))
      .toEqual(["error", "error"]);
  });
});

