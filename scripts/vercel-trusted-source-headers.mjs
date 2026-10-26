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
 * A short-lived Vercel identity must never be sent to an arbitrary URL passed
 * on the command line. Protected verification is limited to this project's
 * HTTPS Vercel deployment hostnames; callers still scope the header to this
 * exact origin below.
 */
export function getTrustedVercelDeploymentOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || !/^esports-schedule-[a-z0-9-]+-jack-zhu-s-projects\.vercel\.app$/.test(url.hostname)
  ) {
    return null;
  }

  return url.origin;
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
