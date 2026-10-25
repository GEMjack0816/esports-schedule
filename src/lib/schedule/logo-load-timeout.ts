export const TEAM_LOGO_LOAD_TIMEOUT_MS = 8_000;
export const TEAM_LOGO_PLACEHOLDER = "/team-placeholder.svg";

export type TeamLogoLoadStatus = "loading" | "loaded" | "failed";
export type TeamLogoRecovery =
  | { kind: "retry"; src: string }
  | { kind: "fallback"; src: typeof TEAM_LOGO_PLACEHOLDER };

const RETRYABLE_LOGO_HOSTS = new Set(["cdn-api.pandascore.co"]);

/** Retry only unsigned HTTPS PandaScore images; preserve arbitrary and signed URLs. */
export function recoverTeamLogo(source: string, alreadyRetried: boolean): TeamLogoRecovery {
  if (!alreadyRetried) {
    try {
      const url = new URL(source);
      if (
        url.protocol === "https:"
        && RETRYABLE_LOGO_HOSTS.has(url.hostname.toLowerCase())
        && (!url.port || url.port === "443")
        && !url.username
        && !url.password
        && !url.search
        && !url.hash
      ) {
        url.searchParams.set("esports_logo_retry", "1");
        return { kind: "retry", src: url.toString() };
      }
    } catch {
      // Invalid or relative URLs are not retryable.
    }
  }

  return { kind: "fallback", src: TEAM_LOGO_PLACEHOLDER };
}

export function displayedTeamLogoSource(
  source: string,
  placeholder: string,
  nearViewport: boolean,
  status: TeamLogoLoadStatus,
): string {
  return nearViewport && status !== "failed" ? source : placeholder;
}

export function startTeamLogoLoadTimeout(
  onTimeout: () => void,
  timeoutMs = TEAM_LOGO_LOAD_TIMEOUT_MS,
): () => void {
  const timeout = setTimeout(onTimeout, timeoutMs);
  return () => clearTimeout(timeout);
}

