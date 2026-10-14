const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildVerificationRunMarkers(runId, fixtureLabel) {
  if (!UUID_PATTERN.test(runId) || !UUID_PATTERN.test(fixtureLabel) || runId === fixtureLabel) {
    throw new Error("Verification run and public fixture markers must be distinct UUIDs.");
  }
  return {
    league: `Codex isolated review ${fixtureLabel}`,
    notes: `verify-admin:${runId}`,
    approvedTeams: [`Approval A ${fixtureLabel}`, `Approval B ${fixtureLabel}`],
    rejectedTeams: [`Reject A ${fixtureLabel}`, `Reject B ${fixtureLabel}`],
  };
}

export function summarizeAdminVerifyFailure(error, phase) {
  const message = error instanceof Error ? error.message : "";
  const status = /\bHTTP\s+(\d{3})\b/.exec(message)?.[1] ?? null;
  const label = phase === "cleanup" ? "Preview verification-data cleanup" : "Admin verification";
  return `${label} failed${status ? ` (HTTP ${status})` : ""}; details redacted.`;
}

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
