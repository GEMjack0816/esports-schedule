const PRODUCTION_HOST = "esports-schedule-two.vercel.app";

export function parseAllowedPreviewHosts(value) {
  const hosts = new Set(
    (value ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  if (hosts.size === 0) {
    throw new Error("ADMIN_VERIFY_ALLOWED_PREVIEW_HOSTS must contain an exact Preview hostname.");
  }
  for (const host of hosts) {
    if (host.includes("*") || host.includes(":") || host.includes("/") || host.includes("@")) {
      throw new Error("Preview host allowlist entries must be exact hostnames without wildcards.");
    }
    if (host === PRODUCTION_HOST) {
      throw new Error("Production hostname cannot be included in the Preview allowlist.");
    }
  }
  return hosts;
}

export function parsePreviewBaseUrl(baseUrl, allowedHosts) {
  let target;
  try {
    target = new URL(baseUrl);
  } catch {
    throw new Error("Target must be a valid HTTPS Preview origin.");
  }
  const host = target.hostname.toLowerCase();

  if (
    target.protocol !== "https:"
    || target.username
    || target.password
    || target.port
    || target.pathname !== "/"
    || target.search
    || target.hash
  ) {
    throw new Error("Target must be an HTTPS origin without credentials, path, query, or hash.");
  }
  if (host === PRODUCTION_HOST) {
    throw new Error("verify:admin refuses to contact the Production hostname.");
  }
  if (!allowedHosts.has(host)) {
    throw new Error("Target host is not in ADMIN_VERIFY_ALLOWED_PREVIEW_HOSTS.");
  }
  return target;
}

export function assertIsolatedPreviewTarget({
  baseUrl,
  expectedSha,
  expectedRef,
  expectedDeploymentId,
  allowedHosts,
  version,
}) {
  parsePreviewBaseUrl(baseUrl, allowedHosts);
  if (version?.service !== "esports-schedule" || version?.environment !== "preview") {
    throw new Error("Target did not identify itself as an esports-schedule Preview deployment.");
  }
  if (!/^[a-f0-9]{40}$/i.test(expectedSha ?? "") || version.gitCommitSha !== expectedSha) {
    throw new Error("Target Git SHA does not match EXPECTED_GIT_SHA.");
  }
  if (!expectedRef || /^(refs\/heads\/)?main$/i.test(expectedRef) || version.gitCommitRef !== expectedRef) {
    throw new Error("Target Git ref does not match EXPECTED_GIT_REF.");
  }
  if (
    !/^dpl_[A-Za-z0-9]+$/.test(expectedDeploymentId ?? "")
    || version.deploymentId !== expectedDeploymentId
    || !version.deploymentUrl
  ) {
    throw new Error("Target deployment metadata is incomplete.");
  }
}
