import type { Stream, Team } from "./types";

const credentialParameterNames = new Set([
  "accesskey", "accesstoken", "apikey", "auth", "authorization", "clientsecret",
  "credential", "idtoken", "jwt", "oauth", "oauthtoken", "password", "passwd",
  "privatekey", "refreshtoken", "secret", "session", "signature", "sig", "token",
  "authorizationcode", "code", "nonce", "state", "ticket",
]);

function isCredentialParameter(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return credentialParameterNames.has(normalized)
    || /(?:access|api|client|id|oauth|refresh|private)?(?:key|token|secret|password|passwd|credential|authorization|signature|jwt|sig)$/.test(normalized);
}

function hasCredentialParameters(search: string): boolean {
  for (const [name] of new URLSearchParams(search)) {
    if (isCredentialParameter(name)) return true;
  }
  return false;
}

function sanitizePublicUrl(value: unknown, httpsOnly: boolean): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return null;
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
    return url ? [{ ...stream, url }] : [];
  });
}

export function sanitizePublicTeam(team: Team): Team {
  let localLogo: string | null = null;
  if (typeof team.logo === "string" && team.logo.startsWith("/")
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
    ...team,
    logo: localLogo ?? sanitizePublicExternalUrl(team.logo) ?? "/team-placeholder.svg",
  };
}
