const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;

function required(value, label) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function parseAllowedHosts(value) {
  const hosts = new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  if (hosts.size === 0) {
    throw new Error("ADMIN_VERIFY_ALLOWED_PREVIEW_HOSTS must contain an exact Preview hostname.");
  }
  for (const host of hosts) {
    if (host.includes("*") || host.includes(":") || host.includes("/") || host.includes("@")) {
      throw new Error("Preview host allowlist entries must be exact hostnames without wildcards.");
    }
  }
  return hosts;
}

export function adminVerificationConfig(args, env = process.env) {
  const [baseUrlInput, refInput, shaInput, deploymentIdInput] = args;
  const expectedGitRef = required(
    refInput ?? env.ADMIN_VERIFY_EXPECTED_GIT_REF,
    "Expected Preview Git ref",
  );
  const expectedGitSha = required(
    shaInput ?? env.ADMIN_VERIFY_EXPECTED_GIT_SHA,
    "Expected Preview Git SHA",
  ).toLowerCase();
  const expectedDeploymentId = required(
    deploymentIdInput ?? env.ADMIN_VERIFY_EXPECTED_DEPLOYMENT_ID,
    "Expected Preview deployment ID",
  );
  if (/^(refs\/heads\/)?main$/i.test(expectedGitRef)) {
    throw new Error("verify:admin refuses the Production branch.");
  }
  if (!SHA_PATTERN.test(expectedGitSha)) {
    throw new Error("Expected Preview Git SHA must be a full 40-character hexadecimal SHA.");
  }
  if (!DEPLOYMENT_ID_PATTERN.test(expectedDeploymentId)) {
    throw new Error("Expected Preview deployment ID is invalid.");
  }
  if (env.ALLOW_ISOLATED_ADMIN_VERIFY !== "1") {
    throw new Error("Set ALLOW_ISOLATED_ADMIN_VERIFY=1 only for an isolated Preview database.");
  }

  let baseUrl;
  try {
    baseUrl = new URL(required(baseUrlInput, "Preview base URL"));
  } catch {
    throw new Error("Preview base URL must be an absolute HTTPS URL.");
  }
  if (
    baseUrl.protocol !== "https:"
    || baseUrl.username
    || baseUrl.password
    || baseUrl.pathname !== "/"
    || baseUrl.search
    || baseUrl.hash
  ) {
    throw new Error("Preview base URL must be an HTTPS origin without credentials, path, query, or hash.");
  }
  const allowedHosts = parseAllowedHosts(env.ADMIN_VERIFY_ALLOWED_PREVIEW_HOSTS);
  if (!allowedHosts.has(baseUrl.hostname.toLowerCase())) {
    throw new Error("Preview hostname is not in ADMIN_VERIFY_ALLOWED_PREVIEW_HOSTS.");
  }

  return {
    baseUrl: baseUrl.origin,
    expectedGitRef,
    expectedGitSha,
    expectedDeploymentId,
  };
}

export function assertPreviewVersion(version, config) {
  if (!version || typeof version !== "object") {
    throw new Error("Preview version response is invalid.");
  }
  if (version.service !== "esports-schedule") {
    throw new Error("Preview version service identity does not match.");
  }
  if (version.environment !== "preview") {
    throw new Error("verify:admin requires a deployment whose environment is preview.");
  }
  if (version.gitCommitRef !== config.expectedGitRef) {
    throw new Error("Preview Git ref does not match the expected ref.");
  }
  if (version.gitCommitSha !== config.expectedGitSha) {
    throw new Error("Preview Git SHA does not match the expected SHA.");
  }
  if (version.deploymentId !== config.expectedDeploymentId) {
    throw new Error("Preview deployment ID does not match the expected deployment.");
  }
}
