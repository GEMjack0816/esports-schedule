const PANDASCORE_CDN_HOST = "cdn.pandascore.co";
const PANDASCORE_TEAM_IMAGE_PATH = "/images/team/image/";
export const TEAM_LOGO_PLACEHOLDER = "/team-placeholder.svg";
export const TEAM_LOGO_RETRY_DELAY_MS = 800;

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
      && url.pathname.startsWith(PANDASCORE_TEAM_IMAGE_PATH)
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

/**
 * Switch failed sources to a local asset so Next Image drops any remote srcSet.
 * Track the failed URL rather than a boolean so a refreshed URL can retry.
 */
export function resolveTeamLogoSource(
  source: string,
  failedSource: string | null,
  retryPendingSource: string | null = null,
): string {
  const requestedSource = source || TEAM_LOGO_PLACEHOLDER;
  return requestedSource === failedSource || requestedSource === retryPendingSource
    ? TEAM_LOGO_PLACEHOLDER
    : requestedSource;
}

/**
 * Only a trusted PandaScore image gets one direct-browser retry after the
 * optimized request fails. Other URLs fall back immediately and a retried URL
 * never loops.
 */
export function shouldRetryTeamLogoDirectly(source: string, retriedSource: string | null): boolean {
  return source !== retriedSource && isPandaScoreCdnLogo(source);
}

