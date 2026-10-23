import type { Stream, Team } from "./types";

const credentialParameterNames = new Set([
  "accesskey", "accesstoken", "apikey", "auth", "authorization", "clientsecret",
  "credential", "idtoken", "jwt", "oauth", "oauthtoken", "password", "passwd",
  "privatekey", "refreshtoken", "secret", "session", "signature", "sig", "token",
  "authorizationcode", "authenticode", "authtoken", "awsaccesskeyid", "bearer",
  "bearertoken", "code", "key", "keyid", "nonce", "sessionid", "state", "ticket",
  "assertion", "clientassertion", "codeverifier", "idtokenhint", "samlresponse",
]);
const MAX_PUBLIC_URL_LENGTH = 2_048;
const MAX_PARAMETER_ENCODING_DEPTH = 32;
const MAX_NESTED_URL_DEPTH = 4;

function matchesCredentialParameter(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return credentialParameterNames.has(normalized)
    // Signed cloud-storage URLs use vendor-prefixed names such as
    // X-Amz-Credential / X-Amz-Signature and X-Goog-Signature. Match the
    // credential-bearing suffix independently of its vendor prefix.
    || /(?:token|secret|password|passwd|credential|authorization|auth|session|signature|jwt|sig|assertion|codeverifier|idtokenhint|samlresponse)$/.test(normalized)
    // Providers commonly prefix API-Key with X- or another vendor name.
    // Keep this specific so harmless keys such as `monkey` remain allowed.
    || /(?:api|auth|access)key(?:id)?$/.test(normalized);
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

function hasCredentialParameters(search: string, nestedDepth = 0): boolean {
  for (const [name, value] of new URLSearchParams(search)) {
    if (isCredentialParameter(name)) return true;
    if (hasNestedCredentialParameters(value, nestedDepth)) return true;
  }
  return false;
}

function hasNestedCredentialParameters(value: string, nestedDepth: number): boolean {
  let candidate = value;
  for (let encodingDepth = 0; encodingDepth < MAX_PARAMETER_ENCODING_DEPTH; encodingDepth += 1) {
    const looksNested = candidate.includes("?") || candidate.includes("#")
      || /^[^/?#=&]+(?:=[^&]*)?(?:&[^=&]+=[^&]*)*$/.test(candidate);
    if (looksNested) {
      // Do not recurse indefinitely through attacker-controlled URL parameters.
      // A further nested URL beyond the inspection bound fails closed.
      if (nestedDepth >= MAX_NESTED_URL_DEPTH) return true;
      try {
        const nested = new URL(candidate, "https://nested-url.invalid");
        if (hasCredentialParameters(nested.search, nestedDepth + 1)
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
  if (hasCredentialParameters(url.search) || hasCredentialParameters(url.hash.slice(1))) return null;
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
