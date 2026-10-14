const SAFE_REQUEST_PATHS = new Set([
  "/",
  "/submit-match",
  "/api/matches",
  "/api/version",
  "/api/health/data-coverage",
  "/admin",
]);

const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Accept only an origin so verifier credentials/query parameters can never be
 * copied into browser/API requests. Plain HTTP is limited to local development.
 */
export function normalizeVerifierBaseUrl(value, { allowLocalHttp = false } = {}) {
  if (typeof value !== "string") return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const secure = url.protocol === "https:";
  const localHttp = allowLocalHttp
    && url.protocol === "http:"
    && LOCAL_HTTP_HOSTS.has(url.hostname.toLowerCase());
  if (
    (!secure && !localHttp)
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    return null;
  }

  return url.origin;
}

export function safeRequestPath(requestUrl) {
  try {
    const pathname = new URL(requestUrl).pathname;
    return SAFE_REQUEST_PATHS.has(pathname) ? pathname : "[other path]";
  } catch {
    return "[invalid URL]";
  }
}

export function summarizeRequestFailure(method, requestUrl, errorText) {
  const safeMethod = typeof method === "string" && /^[A-Z]{3,10}$/.test(method)
    ? method
    : "REQUEST";
  const errorCode = typeof errorText === "string"
    ? /^(?:net::)?ERR_[A-Z0-9_]+$/.exec(errorText.trim())?.[0] ?? null
    : null;
  return `${safeMethod} ${safeRequestPath(requestUrl)} failed${errorCode ? ` (${errorCode})` : ""}`;
}

export function summarizeBrowserDiagnostic(kind) {
  switch (kind) {
    case "console":
      return "browser console error";
    case "page":
      return "uncaught page error";
    case "version-health":
      return "version/health request failed";
    case "resource":
      return "browser resource failed";
    default:
      return "browser verification diagnostic";
  }
}
