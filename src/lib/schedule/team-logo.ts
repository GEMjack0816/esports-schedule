export const TEAM_LOGO_PLACEHOLDER = "/team-placeholder.svg";

const RETRYABLE_LOGO_HOSTS = new Set(["cdn-api.pandascore.co"]);

export type TeamLogoRecovery =
  | { kind: "retry"; src: string }
  | { kind: "fallback"; src: typeof TEAM_LOGO_PLACEHOLDER };

/**
 * Retry only unsigned, HTTPS PandaScore CDN URLs. This keeps retries bounded and
 * avoids changing arbitrary user-provided URLs or invalidating signed URLs.
 */
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
      // Invalid or relative URLs fall through to the local placeholder.
    }
  }

  return { kind: "fallback", src: TEAM_LOGO_PLACEHOLDER };
}
