const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function parseAdminVerificationTarget(args) {
  const [rawUrl, expectedRef, expectedSha, rawAllowedHosts] = args;
  if (!rawUrl || !expectedRef || !expectedSha || !rawAllowedHosts) {
    throw new Error("Usage: verify:admin <preview-url> <expected-ref> <expected-sha> <allowed-preview-hosts-csv>");
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("verify:admin requires a valid Preview URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("verify:admin requires an HTTPS Preview origin without credentials, path, query, or fragment.");
  }

  const allowedHosts = new Set(rawAllowedHosts.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
  if (allowedHosts.size === 0 || [...allowedHosts].some((host) => !HOST_PATTERN.test(host))) {
    throw new Error("verify:admin requires an explicit comma-separated Preview hostname allowlist.");
  }
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("verify:admin target hostname is not in the Preview allowlist.");
  }
  if (!expectedRef.trim() || expectedRef.trim() === "main" || expectedRef.trim().length > 255) {
    throw new Error("verify:admin requires the exact non-Production Preview branch/ref.");
  }
  if (!SHA_PATTERN.test(expectedSha)) {
    throw new Error("verify:admin requires an exact 40-character commit SHA.");
  }

  return {
    baseUrl: url.origin,
    origin: url.origin,
    expectedRef: expectedRef.trim(),
    expectedSha: expectedSha.toLowerCase(),
    allowedHosts,
  };
}

export function assertAdminVerificationDeployment(metadata, target) {
  if (!metadata || typeof metadata !== "object"
    || metadata.service !== "esports-schedule"
    || metadata.environment !== "preview"
    || metadata.gitCommitRef !== target.expectedRef
    || typeof metadata.gitCommitSha !== "string"
    || metadata.gitCommitSha.toLowerCase() !== target.expectedSha
    || typeof metadata.deploymentId !== "string"
    || !metadata.deploymentId.startsWith("dpl_")) {
    throw new Error("verify:admin deployment metadata did not match the expected Preview environment, ref, and SHA.");
  }

  let deploymentUrl;
  try {
    deploymentUrl = new URL(metadata.deploymentUrl);
  } catch {
    throw new Error("verify:admin could not verify the deployment hostname.");
  }
  if (deploymentUrl.protocol !== "https:" || !target.allowedHosts.has(deploymentUrl.hostname.toLowerCase())) {
    throw new Error("verify:admin deployment hostname is not in the Preview allowlist.");
  }
}
