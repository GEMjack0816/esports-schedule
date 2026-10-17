export const EXPECTED_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
});

export function getSecurityHeaderFailures(headers) {
  return Object.entries(EXPECTED_SECURITY_HEADERS)
    .filter(([name, expected]) => headers.get(name)?.trim() !== expected)
    .map(([name]) => name);
}
