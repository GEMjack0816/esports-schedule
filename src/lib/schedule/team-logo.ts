const PANDASCORE_CDN_HOST = "cdn.pandascore.co";
export const TEAM_LOGO_PLACEHOLDER = "/team-placeholder.svg";

/**
 * Only PandaScore's documented image CDN is sent through Next's image optimizer.
 * Other URLs remain direct HTTPS images and never gain a broader server-side fetch path.
 */
export function isPandaScoreCdnLogo(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === PANDASCORE_CDN_HOST
      && url.port === ""
      && !url.username
      && !url.password
      && url.pathname.startsWith("/images/");
  } catch {
    return false;
  }
}

/**
 * Switch failed sources to a local asset so Next Image drops any remote srcSet.
 * Track the failed URL rather than a boolean so a refreshed URL can retry.
 */
export function resolveTeamLogoSource(source: string, failedSource: string | null): string {
  const requestedSource = source || TEAM_LOGO_PLACEHOLDER;
  return requestedSource === failedSource ? TEAM_LOGO_PLACEHOLDER : requestedSource;
}
