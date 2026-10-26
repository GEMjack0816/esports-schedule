import type { Stream, Team } from "./types";

const credentialParameterNames = new Set([
  "accesskey", "accesstoken", "apikey", "auth", "authorization", "clientsecret",
  "credential", "idtoken", "jwt", "oauth", "oauthtoken", "password", "passwd", "pwd", "passphrase",
  "privatekey", "refreshtoken", "secret", "session", "signature", "sig", "token",
  "hmac",
  "authorizationcode", "authenticode", "authtoken", "awsaccesskeyid", "bearer",
  "bearertoken", "code", "key", "keyid", "nonce", "sessionid", "sessionkey", "jsessionid", "phpsessid",
  "sid", "cfbm", "state", "ticket",
  "assertion", "clientassertion", "codeverifier", "idtokenhint", "samlresponse",
  "csrf", "xsrf",
  // Vercel Deployment Protection also accepts its bypass secret in a query parameter.
  "xvercelprotectionbypass",
  // Cloudflare's clearance cookie proves a visitor passed a challenge.
  "cfclearance",
]);
const MAX_PUBLIC_URL_LENGTH = 2_048;
const MAX_PARAMETER_ENCODING_DEPTH = 32;
const MAX_NESTED_URL_DEPTH = 4;

function matchesCredentialParameter(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  // This Vercel query flag controls whether a cookie is set; it is not itself
  // a cookie value or authentication credential.
  if (normalized === "xvercelsetbypasscookie") return false;
  return credentialParameterNames.has(normalized)
    || /(?:csrf|xsrf)$/.test(normalized)
    // Signed cloud-storage URLs use vendor-prefixed names such as
    // X-Amz-Credential / X-Amz-Signature and X-Goog-Signature. Match the
    // credential-bearing suffix independently of its vendor prefix.
    || /(?:token|secret|password|passwd|pwd|passphrase|credential|authorization|auth|session|signature|hmac|jwt|sig|assertion|codeverifier|idtokenhint|samlresponse)$/.test(normalized)
    // Common session identifiers/keys are often named PHPSESSID,
    // ASP.NET_SessionId, X-Session-Key, or simply sid.
    || /(?:sessid|sessionid|sessionkey(?:id)?|sid)$/.test(normalized)
    // OAuth and login providers also use prefixed authorization-code names
    // such as oauth_code / auth_code. A raw `code` is covered by the exact set;
    // these suffixes close the common prefixed variants without rejecting
    // unrelated public fields such as `match_code`.
    || /(?:oauth|access|auth|authorization)code$/.test(normalized)
    // Pluralized parameter names can still carry opaque credential material.
    || /(?:credentials|secrets|passwords|tokens|cookies|sessions)$/.test(normalized)
    // Providers commonly prefix API-Key with X- or another vendor name.
    // Client/consumer keys are also credential-bearing; keep this specific so
    // harmless names such as `monkey` and public `client_id` remain allowed.
    || /(?:api|auth|access|client|consumer)key(?:id)?$/.test(normalized)
    // Prefixes such as X-Private-Key or vendor-secret-key still carry the
    // key itself; checking only the unprefixed exact names misses these.
    || /(?:private|secret|signing)key(?:id)?$/.test(normalized)
    // Cookie values can carry an authenticated session just like bearer tokens.
    || /cookie$/.test(normalized)
    // Azure API Management and other gateways use prefixed subscription keys.
    || /subscriptionkey$/.test(normalized);
}

function decodeAsciiPercentEscapes(value: string): string {
  return value.replace(/%([0-7][0-9a-f])/gi, (_escape, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)));
}

function isCredentialParameter(name: string): boolean {
  let candidate = name;
  // URLSearchParams decodes one layer. Continue decoding ASCII percent escapes
  // so nested encodings such as X%252DAPI%252DKey cannot hide a credential key.
  // URLs are capped at 2 KB, and suspiciously deep encodings fail closed.
  for (let depth = 0; depth < MAX_PARAMETER_ENCODING_DEPTH; depth += 1) {
    if (matchesCredentialParameter(candidate)) return true;
    const decoded = decodeAsciiPercentEscapes(candidate);
    if (decoded === candidate) return false;
    candidate = decoded;
  }
  return true;
}

const MAX_STRUCTURED_VALUE_NODES = 128;
const MAX_STRUCTURED_VALUE_DEPTH = 16;

function hasCredentialInJson(value: unknown, nestedDepth: number): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    visited += 1;
    if (visited > MAX_STRUCTURED_VALUE_NODES || current.depth > MAX_STRUCTURED_VALUE_DEPTH) {
      return true;
    }

    if (typeof current.value === "string") {
      if (hasNestedCredentialParameters(current.value, nestedDepth + 1)) return true;
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;

    for (const [name, nested] of Object.entries(current.value)) {
      if (isCredentialParameter(name)) return true;
      pending.push({ value: nested, depth: current.depth + 1 });
    }
  }

  return false;
}
function hasCredentialPathParameters(pathname: string): boolean {
  let candidate = pathname;
  // Some servers put session IDs and other credentials in matrix-style path
  // parameters or key/value path components. Inspect encoded forms too, using
  // the same bounded ASCII decoding policy as query parameter names.
  for (let depth = 0; depth < MAX_PARAMETER_ENCODING_DEPTH; depth += 1) {
    const segments = candidate.split("/");
    const hasFollowingValue = new Array<boolean>(segments.length);
    let hasNonEmptySegmentAfter = false;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      hasFollowingValue[index] = hasNonEmptySegmentAfter;
      if (segments[index]) hasNonEmptySegmentAfter = true;
    }

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index] ?? "";
      if (/^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(segment)) return true;

      const pathName = segment.split(/[;?&=]/, 1)[0] ?? "";
      if (hasFollowingValue[index] && matchesCredentialParameter(pathName)) return true;

      const [, ...parameters] = segment.split(";");
      for (const parameter of parameters) {
        const name = parameter.split("=", 1)[0] ?? "";
        if (isCredentialParameter(name)) return true;
      }

      for (const component of segment.split(/[?&]/)) {
        const separator = component.indexOf("=");
        if (separator > 0 && isCredentialParameter(component.slice(0, separator))) return true;
      }
    }

    const decoded = decodeAsciiPercentEscapes(candidate);
    if (decoded === candidate) return false;
    candidate = decoded;
  }

  // Reaching the cap means some path structure may still be encoded, or a
  // credential marker may have been revealed only by the final decode pass.
  // Reject the path rather than return a URL we could not fully inspect.
  return true;
}

function hasCredentialParameters(search: string, nestedDepth = 0): boolean {
  // Bare credentials can occupy an entire query/fragment (or appear as a
  // parameter name without `=`), so they are invisible to key-based checks.
  // Inspect bounded ASCII-decoded forms before parsing the parameter pairs.
  let candidate = search;
  for (let depth = 0; depth < MAX_PARAMETER_ENCODING_DEPTH; depth += 1) {
    if (hasInlineCredentialMaterial(candidate)) return true;
    const decoded = decodeAsciiPercentEscapes(candidate);
    if (decoded === candidate) break;
    candidate = decoded;
  }

  for (const [name, value] of new URLSearchParams(search)) {
    if (isCredentialParameter(name) || hasInlineCredentialMaterial(name)) return true;
    if (hasNestedCredentialParameters(value, nestedDepth)) return true;
  }
  return false;
}

function hasInlineCredentialMaterial(value: string): boolean {
  return /(?:^|[^a-z0-9_])authorization\s*:\s*[a-z][a-z0-9+.-]*\s+\S+/i.test(value)
    || /\beyJ[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{3,}\b/.test(value);
}

function hasNestedCredentialParameters(value: string, nestedDepth: number): boolean {
  if (nestedDepth > MAX_NESTED_URL_DEPTH) return true;
  // A credential may be embedded as text in an otherwise harmless parameter
  // value (for example, `?message=Authorization%3A%20Bearer%20...`) instead
  // of being represented as a nested URL/query key. Redact recognizable
  // authorization header values and JWTs wherever they appear.
  let candidate = value;
  for (let encodingDepth = 0; encodingDepth < MAX_PARAMETER_ENCODING_DEPTH; encodingDepth += 1) {
    if (hasInlineCredentialMaterial(candidate)) return true;
    const trimmed = candidate.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      // Some providers wrap credentials in a JSON-valued query parameter (for
      // example, `payload={\"access_token\":...}`). Parse only bounded URL
      // values and fail closed when structured inspection reaches its limit.
      if (nestedDepth >= MAX_NESTED_URL_DEPTH) return true;
      try {
        if (hasCredentialInJson(JSON.parse(candidate), nestedDepth)) return true;
      } catch {
        // A query-string value need not be valid JSON.
      }
    }
    const looksNested = candidate.includes("?") || candidate.includes("#")
      || /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(candidate)
      || /^[^/?#=&]+=[^&]*(?:&[^=&]+(?:=[^&]*)?)*$/.test(candidate);
    if (looksNested) {
      // Do not recurse indefinitely through attacker-controlled URL parameters.
      // A further nested URL beyond the inspection bound fails closed.
      if (nestedDepth >= MAX_NESTED_URL_DEPTH) return true;
      try {
        const nested = new URL(candidate, "https://nested-url.invalid");
        if (nested.username || nested.password
          || hasCredentialPathParameters(nested.pathname)
          || hasCredentialParameters(nested.search, nestedDepth + 1)
          || hasCredentialParameters(nested.hash.slice(1), nestedDepth + 1)) return true;
      } catch {
        // A query-string value need not itself be a valid absolute URL.
      }
      if (/^[^/?#=&]+=[^&]*(?:&[^=&]+(?:=[^&]*)?)*$/.test(candidate)
        && hasCredentialParameters(`?${candidate}`, nestedDepth + 1)) return true;
    }

    const decoded = decodeAsciiPercentEscapes(candidate);
    if (decoded === candidate) return false;
    candidate = decoded;
  }
  return candidate.includes("?") || candidate.includes("#") || candidate.includes("%");
}

function sanitizePublicUrl(value: unknown, httpsOnly: boolean): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PUBLIC_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if ((httpsOnly ? url.protocol !== "https:" : !["http:", "https:"].includes(url.protocol))
    || url.username || url.password) return null;
  if (hasCredentialPathParameters(url.pathname)
    || hasCredentialParameters(url.search)
    || hasCredentialParameters(url.hash.slice(1))) return null;
  return url.toString();
}

/** Returns a public-safe HTTPS external URL, or null when it contains credentials. */
export function sanitizePublicExternalUrl(value: unknown): string | null {
  return sanitizePublicUrl(value, true);
}

/** Preserves legacy HTTP source links while redacting credential-bearing URLs. */
export function sanitizePublicHttpUrl(value: unknown): string | null {
  return sanitizePublicUrl(value, false);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sanitizePublicStreams(streams: unknown): Stream[] {
  if (!Array.isArray(streams)) return [];

  return streams.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const url = sanitizePublicExternalUrl(entry.url);
    if (!url) return [];
    return [{
      label: typeof entry.label === "string" ? entry.label : "直播",
      url,
      ...(typeof entry.official === "boolean" ? { official: entry.official } : {}),
    }];
  });
}

export function sanitizePublicTeam(team: Team): Team {
  let localLogo: string | null = null;
  if (typeof team.logo === "string" && team.logo.length <= MAX_PUBLIC_URL_LENGTH
    && team.logo.startsWith("/")
    && !team.logo.startsWith("//") && !team.logo.includes("\\")) {
    try {
      const parsed = new URL(team.logo, "https://schedule.invalid");
      if (parsed.origin === "https://schedule.invalid"
        && !hasCredentialPathParameters(parsed.pathname)
        && !hasCredentialParameters(parsed.search)
        && !hasCredentialParameters(parsed.hash.slice(1))) {
        localLogo = team.logo;
      }
    } catch {
      localLogo = null;
    }
  }
  return {
    name: typeof team.name === "string" ? team.name : "待定",
    ...(typeof team.acronym === "string" || team.acronym === null
      ? { acronym: team.acronym }
      : {}),
    logo: localLogo ?? sanitizePublicExternalUrl(team.logo) ?? "/team-placeholder.svg",
  };
}

