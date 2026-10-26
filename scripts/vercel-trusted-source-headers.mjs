export const VERCEL_TRUSTED_SOURCE_HEADER = "x-vercel-trusted-oidc-idp-token";
export const MAX_TRUSTED_SOURCE_REDIRECTS = 10;

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
  const safeHeaders = { ...headers };
  for (const name of Object.keys(safeHeaders)) {
    if (name.toLowerCase() === VERCEL_TRUSTED_SOURCE_HEADER) delete safeHeaders[name];
  }

  if (!token || new URL(requestUrl).origin !== targetOrigin) return safeHeaders;

  return {
    ...safeHeaders,
    [VERCEL_TRUSTED_SOURCE_HEADER]: token,
  };
}

/**
 * Playwright's route.continue({ headers }) applies those headers to every
 * redirect hop. Fetch one hop at a time so the short-lived identity is only
 * sent to this exact Preview origin. External redirects are returned to the
 * browser as ordinary 3xx responses, without the identity header.
 */
export async function fetchTrustedSourceResponse(route, targetOrigin, token) {
  const request = route.request();
  const requestUrl = request.url();
  const trustedOrigin = token && new URL(requestUrl).origin === targetOrigin
    ? targetOrigin
    : null;
  let currentUrl = requestUrl;
  let response = await route.fetch({
    headers: addTrustedSourceHeader(request.headers(), currentUrl, trustedOrigin, token),
    maxRedirects: 0,
  });

  if (!trustedOrigin || !["GET", "HEAD"].includes(request.method().toUpperCase())) return response;

  for (let redirects = 0; redirects < MAX_TRUSTED_SOURCE_REDIRECTS; redirects += 1) {
    if (![301, 302, 303, 307, 308].includes(response.status())) return response;

    const location = response.headers().location;
    if (!location) return response;

    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.origin !== trustedOrigin) return response;

    currentUrl = nextUrl.toString();
    response = await route.fetch({
      url: currentUrl,
      headers: addTrustedSourceHeader(request.headers(), currentUrl, trustedOrigin, token),
      maxRedirects: 0,
    });
  }

  return response;
}
