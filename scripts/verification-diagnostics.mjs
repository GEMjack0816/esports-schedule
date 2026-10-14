const SAFE_REQUEST_PATHS = new Set([
  "/",
  "/submit-match",
  "/api/matches",
  "/api/version",
  "/api/health/data-coverage",
  "/admin",
]);

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
