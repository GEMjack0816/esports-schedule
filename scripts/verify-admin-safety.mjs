const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const REF_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;

function hostList(value) {
  return new Set((Array.isArray(value) ? value : String(value ?? "").split(","))
    .map((host) => String(host).trim().toLowerCase())
    .filter(Boolean));
}

export function parseVerificationTarget({ baseUrl, expectedSha, expectedRef, allowedHosts }) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new Error("Preview verification target is required.");
  }
  if (typeof expectedSha !== "string" || !SHA_PATTERN.test(expectedSha)) {
    throw new Error("Expected Preview commit SHA must be a full 40-character SHA.");
  }
  if (
    typeof expectedRef !== "string"
    || !REF_PATTERN.test(expectedRef)
    || expectedRef.includes("..")
    || expectedRef === "main"
  ) {
    throw new Error("Expected Preview branch/ref is invalid.");
  }

  let target;
  try {
    target = new URL(baseUrl);
  } catch {
    throw new Error("Preview URL is invalid.");
  }
  const allowlist = hostList(allowedHosts);
  if (
    target.protocol !== "https:"
    || target.username
    || target.password
    || target.port
    || target.pathname !== "/"
    || target.search
    || target.hash
    || !allowlist.has(target.hostname.toLowerCase())
  ) {
    throw new Error("Preview URL is not an allowlisted HTTPS host.");
  }
  if (allowlist.size === 0) throw new Error("Preview host allowlist is required.");

  return {
    baseUrl: target.origin,
    expectedSha: expectedSha.toLowerCase(),
    expectedRef,
    allowedHosts: allowlist,
  };
}

export function assertPreviewDeployment(target, version) {
  if (
    !version
    || version.service !== "esports-schedule"
    || version.environment !== "preview"
    || typeof version.gitCommitSha !== "string"
    || version.gitCommitSha.toLowerCase() !== target.expectedSha
    || version.gitCommitRef !== target.expectedRef
    || typeof version.deploymentId !== "string"
    || !version.deploymentId.trim()
  ) {
    throw new Error("Deployment metadata does not match the expected Preview environment, branch, and commit.");
  }

  let deploymentUrl;
  try {
    deploymentUrl = new URL(version.deploymentUrl);
  } catch {
    throw new Error("Preview deployment URL metadata is unavailable.");
  }
  if (
    deploymentUrl.protocol !== "https:"
    || deploymentUrl.username
    || deploymentUrl.password
    || deploymentUrl.port
    || !target.allowedHosts.has(deploymentUrl.hostname.toLowerCase())
  ) {
    throw new Error("Deployment URL is not in the Preview host allowlist.");
  }

  return {
    deploymentId: version.deploymentId,
    deploymentUrl: deploymentUrl.origin,
    gitCommitSha: target.expectedSha,
    gitCommitRef: target.expectedRef,
  };
}
