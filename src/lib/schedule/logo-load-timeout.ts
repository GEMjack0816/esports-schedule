export const TEAM_LOGO_LOAD_TIMEOUT_MS = 8_000;

export type TeamLogoLoadStatus = "loading" | "loaded" | "failed";

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
