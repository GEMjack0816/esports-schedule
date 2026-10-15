const PANDASCORE_CDN_HOST = "cdn.pandascore.co";

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
