const SHA_PATTERN = /^[a-f0-9]{40}$/i;

function parseHttpsOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS origin.`);
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error(`${label} must be an HTTPS origin without credentials, path, or query.`);
  }
  return url.origin;
}

export function parseAdminVerifyConfiguration({
  baseUrl,
  allowlistedOrigins,
  expectedGitRef,
  expectedGitSha,
}) {
  if (typeof allowlistedOrigins !== "string") {
    throw new Error("VERIFY_ADMIN_ALLOWED_PREVIEW_ORIGINS is required.");
  }
  const origin = parseHttpsOrigin(baseUrl, "Preview URL");
  const allowedOrigins = allowlistedOrigins
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => parseHttpsOrigin(item, "Preview origin allowlist entry"));

  if (allowedOrigins.length === 0 || new Set(allowedOrigins).size !== allowedOrigins.length) {
    throw new Error("VERIFY_ADMIN_ALLOWED_PREVIEW_ORIGINS must contain unique HTTPS origins.");
  }
  if (!allowedOrigins.includes(origin)) {
    throw new Error("Target origin is not in VERIFY_ADMIN_ALLOWED_PREVIEW_ORIGINS.");
  }
  if (typeof expectedGitRef !== "string" || !expectedGitRef.trim()) {
    throw new Error("VERIFY_ADMIN_EXPECTED_GIT_REF is required.");
  }
  if (typeof expectedGitSha !== "string" || !SHA_PATTERN.test(expectedGitSha)) {
    throw new Error("VERIFY_ADMIN_EXPECTED_GIT_SHA must be a full 40-character commit SHA.");
  }

  return {
    origin,
    allowedOrigins,
    expectedGitRef: expectedGitRef.trim(),
    expectedGitSha: expectedGitSha.toLowerCase(),
  };
}

export function assertAdminVerifyDeployment(version, expected) {
  if (!version || typeof version !== "object") {
    throw new Error("Preview /api/version returned an invalid response.");
  }
  if (version.service !== "esports-schedule") {
    throw new Error("Target deployment is not esports-schedule.");
  }
  if (typeof version.environment !== "string" || version.environment.toLowerCase() !== "preview") {
    throw new Error("verify:admin only runs against a deployment reporting environment=preview.");
  }
  if (version.gitCommitRef !== expected.expectedGitRef) {
    throw new Error("Preview Git ref does not match VERIFY_ADMIN_EXPECTED_GIT_REF.");
  }
  if (typeof version.gitCommitSha !== "string" || version.gitCommitSha.toLowerCase() !== expected.expectedGitSha) {
    throw new Error("Preview Git SHA does not match VERIFY_ADMIN_EXPECTED_GIT_SHA.");
  }
  if (typeof version.deploymentId !== "string" || !version.deploymentId.startsWith("dpl_")) {
    throw new Error("Preview deployment metadata is missing a valid deployment ID.");
  }

  let deploymentOrigin;
  try {
    deploymentOrigin = parseHttpsOrigin(version.deploymentUrl, "Deployment URL");
  } catch {
    throw new Error("Preview deployment metadata is missing a valid HTTPS deployment URL.");
  }
  if (!expected.allowedOrigins.includes(deploymentOrigin)) {
    throw new Error("Preview /api/version deployment URL is not in VERIFY_ADMIN_ALLOWED_PREVIEW_ORIGINS.");
  }

  return {
    deploymentId: version.deploymentId,
    gitCommitRef: version.gitCommitRef,
    gitCommitSha: version.gitCommitSha,
  };
}
