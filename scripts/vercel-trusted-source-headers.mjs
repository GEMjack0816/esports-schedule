export const VERCEL_TRUSTED_SOURCE_HEADER = "x-vercel-trusted-oidc-idp-token";

export function redactTrustedSourceToken(value, token) {
  const text = String(value ?? "");
  return token ? text.split(token).join("[redacted]") : text;
}

const BROWSER_ENV_ALLOWLIST = new Set([
  "APPDATA",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NO_COLOR",
  "OS",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
]);

export function isolateBrowserEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => BROWSER_ENV_ALLOWLIST.has(name.toUpperCase())),
  );
}

/**
 * Add the short-lived Vercel development identity only to requests for the
 * exact deployment origin under test. Never forward it to third-party assets.
 */
export function addTrustedSourceHeader(headers, requestUrl, targetOrigin, token) {
  if (!token || new URL(requestUrl).origin !== targetOrigin) return headers;

  return {
    ...headers,
    [VERCEL_TRUSTED_SOURCE_HEADER]: token,
  };
}
