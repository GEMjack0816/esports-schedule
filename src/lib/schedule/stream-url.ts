import type { Stream, Team } from "./types";

const credentialParameterNames = new Set([
  "accesskey", "accesstoken", "apikey", "auth", "authorization", "clientsecret",
  "credential", "idtoken", "jwt", "oauth", "oauthtoken", "password", "passwd",
  "privatekey", "refreshtoken", "secret", "session", "signature", "sig", "token",
  "authorizationcode", "authenticode", "authtoken", "awsaccesskeyid", "bearer",
  "bearertoken", "code", "key", "keyid", "nonce", "sessionid", "jsessionid", "state", "ticket",
  "assertion", "clientassertion", "codeverifier", "idtokenhint", "samlresponse",
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
    // Signed cloud-storage URLs use vendor-prefixed names such as
    // X-Amz-Credential / X-Amz-Signature and X-Goog-Signature. Match the
    // credential-bearing suffix independently of its vendor prefix.
    || /(?:token|secret|password|passwd|credential|authorization|auth|session|signature|jwt|sig|assertion|codeverifier|idtokenhint|samlresponse)$/.test(normalized)
    // OAuth and login providers also use prefixed authorization-code names
    // such as oauth_code / auth_code. A raw `code` is covered by the exact set;
    // these suffixes close the common prefixed variants without rejecting
    // unrelated public fields such as `match_code`.
    || /(?:oauth|access|auth|authorization)code$/.test(normalized)
    // Providers commonly prefix API-Key with X- or another vendor name.
    // Keep this specific so harmless keys such as `monkey` remain allowed.
    || /(?:api|auth|access)key(?:id)?$/.test(normalized)
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
  for (const [name, value] of new URLSearchParams(search)) {
    if (isCredentialParameter(name)) return true;
    if (hasNestedCredentialParameters(value, nestedDepth)) return true;
  }
  return false;
}

function hasNestedCredentialParameters(value: string, nestedDepth: number): boolean {
  if (nestedDepth > MAX_NESTED_URL_DEPTH) return true;
  let candidate = value;
  for (let encodingDepth = 0; encodingDepth < MAX_PARAMETER_ENCODING_DEPTH; encodingDepth += 1) {
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
      || /^[^/?#=&]+(?:=[^&]*)?(?:&[^=&]+=[^&]*)*$/.test(candidate);
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
      if (/^[^/?#=&]+(?:=[^&]*)?(?:&[^=&]+=[^&]*)*$/.test(candidate)
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

export function sanitizePublicStreams(streams: Stream[] | undefined): Stream[] {
  return (streams ?? []).flatMap((stream) => {
    const url = sanitizePublicExternalUrl(stream?.url);
    if (!url) return [];
    return [{
      label: typeof stream.label === "string" ? stream.label : "直播",
      url,
      ...(typeof stream.official === "boolean" ? { official: stream.official } : {}),
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
