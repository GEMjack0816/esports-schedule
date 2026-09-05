export function parseAllowedPreviewHosts(value) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function assertIsolatedPreviewTarget({ baseUrl, expectedSha, expectedRef, allowedHosts, version }) {
  const target = new URL(baseUrl);
  const host = target.hostname.toLowerCase();

  if (!allowedHosts.has(host)) {
    throw new Error("Target host is not in ADMIN_VERIFY_ALLOWED_PREVIEW_HOSTS.");
  }
  if (version?.service !== "esports-schedule" || version?.environment !== "preview") {
    throw new Error("Target did not identify itself as an esports-schedule Preview deployment.");
  }
  if (!expectedSha || version.gitCommitSha !== expectedSha) {
    throw new Error("Target Git SHA does not match EXPECTED_GIT_SHA.");
  }
  if (!expectedRef || version.gitCommitRef !== expectedRef) {
    throw new Error("Target Git ref does not match EXPECTED_GIT_REF.");
  }
  if (!version.deploymentId || !version.deploymentUrl) {
    throw new Error("Target deployment metadata is incomplete.");
  }
  if (host === "esports-schedule-two.vercel.app") {
    throw new Error("verify:admin refuses to mutate Production.");
  }
}
