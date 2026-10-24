const PANDASCORE_TEAM_LOGO_PATH = /^\/images\/team\/image\/\d+\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:avif|jpe?g|png|webp)$/i;
const PANDASCORE_TEAM_LOGO_HOSTS = new Set(["cdn.pandascore.co", "cdn-api.pandascore.co"]);

/** A cached image may have failed before hydration attached its error handler. */
export function isCompletedImageFailure(complete: boolean, naturalWidth: number): boolean {
  return complete && naturalWidth === 0;
}

/**
 * Only route canonical PandaScore team images through Next's server-side
 * optimizer. Other existing logo sources keep the direct-image fallback path.
 */
export function isPandaScoreTeamLogoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && PANDASCORE_TEAM_LOGO_HOSTS.has(url.hostname)
      && !url.port
      && !url.username
      && !url.password
      && url.search === ""
      && url.hash === ""
      && PANDASCORE_TEAM_LOGO_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Give a failed canonical logo one distinct browser/CDN cache key. The retry
 * URL is intentionally not optimizer-eligible, so it bypasses a cached Next
 * image-optimization failure while remaining pinned to an allowlisted host.
 */
export function retryPandaScoreTeamLogoUrl(value: string): string | null {
  if (!isPandaScoreTeamLogoUrl(value)) return null;
  const url = new URL(value);
  url.searchParams.set("esports_logo_retry", "1");
  return url.toString();
}
