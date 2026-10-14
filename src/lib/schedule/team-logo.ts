const PANDASCORE_TEAM_LOGO_PATH = /^\/images\/team\/image\/\d+\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:avif|jpe?g|png|webp)$/i;

/**
 * Only route canonical PandaScore team images through Next's server-side
 * optimizer. Other existing logo sources keep the direct-image fallback path.
 */
export function isPandaScoreTeamLogoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "cdn.pandascore.co"
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
