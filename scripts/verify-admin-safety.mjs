const PRODUCTION_ALIAS = "esports-schedule-two.vercel.app";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactHostname(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const candidate = value.trim().toLowerCase();
  if (candidate.includes("*") || candidate.includes("://") || candidate.includes("/") || candidate.includes("@")) {
    return null;
  }

  try {
    const parsed = new URL(`https://${candidate}`);
    return parsed.hostname === candidate && !parsed.port && !parsed.username && !parsed.password
      ? parsed.hostname
      : null;
  } catch {
    return null;
  }
}

export function parseHostnameAllowlist(value, variableName) {
  const entries = typeof value === "string" ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
  const hosts = entries.map(exactHostname);
  if (entries.length === 0 || hosts.some((host) => !host)) {
    fail(`ADMIN_VERIFY_INVALID_${variableName}`);
  }
  return new Set(hosts);
}

export function parseDeploymentAllowlist(value) {
  const entries = typeof value === "string" ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
  if (entries.length === 0 || entries.some((id) => !/^dpl_[A-Za-z0-9]+$/.test(id))) {
    fail("ADMIN_VERIFY_INVALID_DEPLOYMENT_ALLOWLIST");
  }
  return new Set(entries);
}

export function assertPreviewBaseUrl(value, allowedHosts) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("ADMIN_VERIFY_INVALID_PREVIEW_URL");
  }
  if (
    url.protocol !== "https:"
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== "/"
    || url.hostname.toLowerCase() === PRODUCTION_ALIAS
    || !allowedHosts.has(url.hostname.toLowerCase())
  ) {
    fail("ADMIN_VERIFY_PREVIEW_HOST_NOT_ALLOWED");
  }
  return url.origin;
}

export function assertPreviewDatabaseUrl(value, allowedHosts) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("ADMIN_VERIFY_INVALID_DATABASE_URL");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !url.hostname
    || !allowedHosts.has(url.hostname.toLowerCase())
  ) {
    fail("ADMIN_VERIFY_DATABASE_HOST_NOT_ALLOWED");
  }
}

export function assertPreviewDeployment({ baseUrl, version, expectedRef, expectedSha, allowedHosts, allowedDeploymentIds }) {
  if (!expectedRef || expectedRef === "main" || !/^[a-f0-9]{40}$/i.test(expectedSha ?? "")) {
    fail("ADMIN_VERIFY_EXPECTED_REF_AND_SHA_REQUIRED");
  }
  if (
    version?.service !== "esports-schedule"
    || String(version.environment ?? "").toLowerCase() !== "preview"
    || version.gitCommitRef !== expectedRef
    || String(version.gitCommitSha ?? "").toLowerCase() !== expectedSha.toLowerCase()
    || !allowedDeploymentIds.has(version.deploymentId)
  ) {
    fail("ADMIN_VERIFY_DEPLOYMENT_IDENTITY_MISMATCH");
  }
  const deploymentUrl = assertPreviewBaseUrl(version.deploymentUrl, allowedHosts);
  if (new URL(baseUrl).origin !== assertPreviewBaseUrl(baseUrl, allowedHosts)) {
    fail("ADMIN_VERIFY_PREVIEW_ORIGIN_MISMATCH");
  }
  return { deploymentUrl, deploymentId: version.deploymentId };
}

export async function cleanupVerifyAdminData(database, league, hideVisibleMatch) {
  const candidateSubmissions = await database`
    select id from match_submissions where league = ${league}
  `;
  const candidateSubmissionIds = candidateSubmissions.map((row) => row.id);
  const candidates = await database`
    select id, hidden from published_manual_matches
    where league = ${league}
      or league = ${`${league} edited`}
      or source_submission_id = any(${candidateSubmissionIds}::uuid[])
  `;

  for (const match of candidates) {
    if (!match.hidden) {
      if (typeof hideVisibleMatch !== "function") fail("ADMIN_VERIFY_CACHE_SAFE_HIDE_REQUIRED");
      await hideVisibleMatch(match.id);
    }
  }

  await database.begin(async (transaction) => {
    const submissions = await transaction`
      select id from match_submissions where league = ${league} for update
    `;
    const submissionIds = submissions.map((row) => row.id);
    const manualMatches = await transaction`
      select id, hidden from published_manual_matches
      where league = ${league}
        or league = ${`${league} edited`}
        or source_submission_id = any(${submissionIds}::uuid[])
      for update
    `;
    if (manualMatches.some((row) => !row.hidden)) fail("ADMIN_VERIFY_CACHE_SAFE_HIDE_FAILED");
    const manualMatchIds = manualMatches.map((row) => row.id);
    const entityIds = [...new Set([...submissionIds, ...manualMatchIds])];

    if (entityIds.length > 0) {
      await transaction`delete from admin_audit_events where entity_id = any(${entityIds}::uuid[])`;
    }
    if (manualMatchIds.length > 0) {
      await transaction`delete from published_manual_matches where id = any(${manualMatchIds}::uuid[])`;
    }
    if (submissionIds.length > 0) {
      await transaction`delete from match_submissions where id = any(${submissionIds}::uuid[])`;
    }
  });
}

export async function runWithAdminVerifyCleanup(run, cleanup) {
  let result;
  let runFailed = false;
  let cleanupFailed = false;
  try {
    result = await run();
  } catch {
    runFailed = true;
  }
  try {
    await cleanup();
  } catch {
    cleanupFailed = true;
  }

  if (cleanupFailed) fail(runFailed ? "ADMIN_VERIFY_RUN_AND_CLEANUP_FAILED" : "ADMIN_VERIFY_CLEANUP_FAILED");
  if (runFailed) fail("ADMIN_VERIFY_RUN_FAILED_CLEANUP_SUCCEEDED");
  return result;
}

