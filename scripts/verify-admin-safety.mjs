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

export function assertAdminSessionLanding({ status, url, baseUrl, bodyText }) {
  let pageUrl;
  let expectedOrigin;
  try {
    pageUrl = new URL(url);
    expectedOrigin = new URL(baseUrl).origin;
  } catch {
    throw new Error("Authenticated Preview admin dashboard could not be verified; no test data was written.");
  }
  if (
    status !== 200
    || pageUrl.origin !== expectedOrigin
    || pageUrl.pathname !== "/admin"
    || typeof bodyText !== "string"
    || !bodyText.includes("审核概览")
  ) {
    throw new Error("Authenticated Preview admin dashboard could not be verified; no test data was written.");
  }
}

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createPreviewCleanupRequest(verifiedDeployment, runId) {
  if (
    !verifiedDeployment
    || typeof verifiedDeployment.deploymentUrl !== "string"
    || !RUN_ID_PATTERN.test(runId)
  ) {
    throw new Error("Preview cleanup target is invalid.");
  }

  let deploymentUrl;
  try {
    deploymentUrl = new URL(verifiedDeployment.deploymentUrl);
  } catch {
    throw new Error("Preview cleanup target is invalid.");
  }
  if (
    deploymentUrl.protocol !== "https:"
    || deploymentUrl.username
    || deploymentUrl.password
    || deploymentUrl.port
    || deploymentUrl.pathname !== "/"
    || deploymentUrl.search
    || deploymentUrl.hash
  ) {
    throw new Error("Preview cleanup target is invalid.");
  }

  return {
    url: new URL("/api/admin/e2e-cleanup", deploymentUrl).toString(),
    options: {
      headers: { Origin: deploymentUrl.origin },
      data: { runId },
      timeout: 15_000,
    },
  };
}

export function assertIsolatedDatabasePreflight({ status, payload }) {
  if (status !== 200 || !payload || payload.ok !== true) {
    throw new Error("Preview database isolation could not be verified; no test data was written.");
  }
}
