import "server-only";

import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import {
  createRemoteJWKSet,
  EncryptJWT,
  jwtDecrypt,
  jwtVerify,
  SignJWT,
} from "jose";
import type { JWTVerifyGetKey } from "jose";
import { safeAdminReturnPath } from "./paths";

const AUTHORIZATION_ENDPOINT = "https://vercel.com/oauth/authorize";
const TOKEN_ENDPOINT = "https://api.vercel.com/login/oauth/token";
const REVOKE_ENDPOINT = "https://api.vercel.com/login/oauth/token/revoke";
const ISSUER = "https://vercel.com";
const JWKS = createRemoteJWKSet(new URL("https://vercel.com/.well-known/jwks"));

const COOKIE_SUFFIXES = {
  state: "esports_oauth_state",
  nonce: "esports_oauth_nonce",
  verifier: "esports_oauth_verifier",
  returnTo: "esports_oauth_return",
  session: "esports_admin_session",
  access: "esports_admin_access",
} as const;
const TEMP_MAX_AGE_SECONDS = 10 * 60;
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

type AuthConfig = {
  clientId: string;
  clientSecret: string;
  adminIds: Set<string>;
};

export type AdminSession = {
  sub: string;
};

export class AuthConfigurationError extends Error {
  readonly code = "AUTH_NOT_CONFIGURED";
}

export class AuthForbiddenError extends Error {
  readonly code = "AUTH_FORBIDDEN";
}

function requiredConfig(): AuthConfig {
  const clientId = process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.VERCEL_APP_CLIENT_SECRET?.trim();
  const adminIds = new Set(
    (process.env.ADMIN_VERCEL_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!clientId || !clientSecret || adminIds.size === 0) {
    throw new AuthConfigurationError("管理员登录尚未配置。");
  }
  return { clientId, clientSecret, adminIds };
}

export function isAdminAuthConfigured(): boolean {
  try {
    requiredConfig();
    return true;
  } catch {
    return false;
  }
}

export function isAuthorizedAdminSubject(subject: string, configuredIds: string): boolean {
  return configuredIds
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(subject);
}

function digestSecret(secret: string, purpose: string): Uint8Array {
  return createHash("sha256").update(`${purpose}\0${secret}`).digest();
}

function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function usesSecureAuthCookies(
  vercelEnvironment = process.env.VERCEL_ENV,
): boolean {
  return vercelEnvironment === "production" || vercelEnvironment === "preview";
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: usesSecureAuthCookies(),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function authCookieNames(secure = usesSecureAuthCookies()) {
  const prefix = secure ? "__Host-" : "";
  return {
    state: `${prefix}${COOKIE_SUFFIXES.state}`,
    nonce: `${prefix}${COOKIE_SUFFIXES.nonce}`,
    verifier: `${prefix}${COOKIE_SUFFIXES.verifier}`,
    returnTo: `${prefix}${COOKIE_SUFFIXES.returnTo}`,
    session: `${prefix}${COOKIE_SUFFIXES.session}`,
    access: `${prefix}${COOKIE_SUFFIXES.access}`,
  };
}

function allowedOrigins(): Set<string> {
  const values = new Set<string>(["https://esports-schedule-two.vercel.app"]);
  for (const value of [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
  ]) {
    if (!value?.trim()) continue;
    const host = value.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    values.add(`https://${host}`);
  }
  if (process.env.NODE_ENV !== "production") {
    values.add("http://localhost:3000");
    values.add("http://127.0.0.1:3000");
  }
  return values;
}

export function trustedRequestOrigin(request: Request): string {
  const origin = new URL(request.url).origin;
  if (!allowedOrigins().has(origin)) {
    throw new AuthForbiddenError("请求来源不受信任。");
  }
  return origin;
}

export function trustedMutationOrigin(request: Request): string {
  const requestOrigin = trustedRequestOrigin(request);
  const header = request.headers.get("origin");
  if (!header) throw new AuthForbiddenError("缺少请求来源。");
  let headerOrigin: string;
  try {
    headerOrigin = new URL(header).origin;
  } catch {
    throw new AuthForbiddenError("请求来源无效。");
  }
  if (headerOrigin !== requestOrigin) {
    throw new AuthForbiddenError("跨站写入请求被拒绝。");
  }
  return requestOrigin;
}

export async function verifyVercelIdentityToken(
  idToken: string,
  expectedNonce: string,
  clientId: string,
  key: JWTVerifyGetKey = JWKS,
): Promise<string> {
  const verified = await jwtVerify(idToken, key, {
    issuer: ISSUER,
    audience: clientId,
  });
  const subject = verified.payload.sub;
  const tokenNonce = verified.payload.nonce;
  if (!subject || typeof tokenNonce !== "string" || !sameText(tokenNonce, expectedNonce)) {
    throw new AuthForbiddenError("ID Token 校验失败。");
  }
  return subject;
}

export async function beginVercelAuthorization(request: Request): Promise<URL> {
  const config = requiredConfig();
  const origin = trustedRequestOrigin(request);
  const state = randomBase64Url();
  const nonce = randomBase64Url();
  const verifier = randomBase64Url(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const returnTo = safeAdminReturnPath(new URL(request.url).searchParams.get("returnTo"));
  const store = await cookies();
  const names = authCookieNames();
  store.set(names.state, state, cookieOptions(TEMP_MAX_AGE_SECONDS));
  store.set(names.nonce, nonce, cookieOptions(TEMP_MAX_AGE_SECONDS));
  store.set(names.verifier, verifier, cookieOptions(TEMP_MAX_AGE_SECONDS));
  store.set(names.returnTo, returnTo, cookieOptions(TEMP_MAX_AGE_SECONDS));

  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", `${origin}/api/auth/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

type TokenResponse = {
  access_token?: string;
  id_token?: string;
};

export async function completeVercelAuthorization(request: Request): Promise<string> {
  const config = requiredConfig();
  const origin = trustedRequestOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const store = await cookies();
  const names = authCookieNames();
  const expectedState = store.get(names.state)?.value;
  const nonce = store.get(names.nonce)?.value;
  const verifier = store.get(names.verifier)?.value;
  const returnTo = safeAdminReturnPath(store.get(names.returnTo)?.value ?? null);

  for (const name of [names.state, names.nonce, names.verifier, names.returnTo]) {
    store.set(name, "", {
      ...cookieOptions(0),
      expires: new Date(0),
    });
  }
  if (!code || !state || !expectedState || !nonce || !verifier || !sameText(state, expectedState)) {
    throw new AuthForbiddenError("OAuth 状态校验失败。");
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: `${origin}/api/auth/callback`,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new AuthForbiddenError("Vercel 登录令牌交换失败。");
  const token = await response.json() as TokenResponse;
  if (!token.id_token || !token.access_token) throw new AuthForbiddenError("Vercel 登录响应不完整。");

  const subject = await verifyVercelIdentityToken(token.id_token, nonce, config.clientId);
  if (!config.adminIds.has(subject)) throw new AuthForbiddenError("此 Vercel 账户不在管理员白名单中。");

  const issuedAt = Math.floor(Date.now() / 1_000);
  const session = await new SignJWT({ sub: subject, purpose: "admin-session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("esports-schedule")
    .setAudience("esports-schedule-admin")
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_MAX_AGE_SECONDS)
    .sign(digestSecret(config.clientSecret, "session"));
  const encryptedAccess = await new EncryptJWT({ token: token.access_token })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer("esports-schedule")
    .setAudience("vercel-token-revoke")
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_MAX_AGE_SECONDS)
    .encrypt(digestSecret(config.clientSecret, "access-token"));
  store.set(names.session, session, cookieOptions(SESSION_MAX_AGE_SECONDS));
  store.set(names.access, encryptedAccess, cookieOptions(SESSION_MAX_AGE_SECONDS));
  return returnTo;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    const config = requiredConfig();
    const value = (await cookies()).get(authCookieNames().session)?.value;
    if (!value) return null;
    const verified = await jwtVerify(value, digestSecret(config.clientSecret, "session"), {
      issuer: "esports-schedule",
      audience: "esports-schedule-admin",
    });
    const subject = verified.payload.sub;
    if (!subject || !config.adminIds.has(subject)) return null;
    return { sub: subject };
  } catch {
    return null;
  }
}

export async function revokeAndClearSession(): Promise<void> {
  let config: AuthConfig | null = null;
  try {
    config = requiredConfig();
    const store = await cookies();
    const encrypted = store.get(authCookieNames().access)?.value;
    if (encrypted) {
      const decrypted = await jwtDecrypt(encrypted, digestSecret(config.clientSecret, "access-token"), {
        issuer: "esports-schedule",
        audience: "vercel-token-revoke",
      });
      const token = decrypted.payload.token;
      if (typeof token === "string") {
        await fetch(REVOKE_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ token }),
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        }).catch(() => undefined);
      }
    }
  } catch {
    // Logout remains local even when upstream revocation is temporarily unavailable.
  } finally {
    const store = await cookies();
    for (const name of Object.values(authCookieNames())) {
      store.set(name, "", {
        ...cookieOptions(0),
        expires: new Date(0),
      });
    }
  }
}
