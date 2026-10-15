import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import {
  assertAdminVerifyDeployment,
  assertAdminVerifySessionPreflight,
  buildVerificationRunMarkers,
  parseAdminVerifyConfiguration,
  summarizeAdminVerifyFailure,
} from "./verify-admin-safety.mjs";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function launchBrowser() {
  const executableCandidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const executablePath of executableCandidates) {
    try {
      return await chromium.launch({ executablePath, headless: true });
    } catch {
      // Try the next installed browser without printing local paths.
    }
  }
  throw new Error("No supported browser executable found.");
}

async function readVerifiedDeployment(context, target) {
  const response = await context.request.get(`${target.origin}/api/version`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    maxRedirects: 0,
    timeout: 15_000,
  });
  if (response.status() !== 200) {
    throw new Error(`Preview /api/version returned HTTP ${response.status()}; no test data was written.`);
  }
  let version;
  try {
    version = await response.json();
  } catch {
    throw new Error("Preview /api/version returned invalid JSON; no test data was written.");
  }
  return assertAdminVerifyDeployment(version, target);
}

async function submit(context, origin, input) {
  const response = await context.request.post(`${origin}/api/submissions`, { data: input });
  if (response.status() !== 201) {
    throw new Error(`public submission returned HTTP ${response.status()}`);
  }
  return response.json();
}

async function cleanupRun(context, origin, runId) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await context.request.post(`${origin}/api/admin/verify-cleanup`, {
        data: { runId },
        headers: { Origin: origin },
        timeout: 15_000,
      });
      if (response.status() !== 200) {
        throw new Error(`Preview verification-data cleanup returned HTTP ${response.status()}`);
      }
      const result = await response.json();
      if (result.ok !== true || result.runId !== runId) {
        throw new Error("Preview verification-data cleanup did not confirm the requested run.");
      }
      return result.counts;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Preview verification-data cleanup failed.");
}

async function runVerification() {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    throw new Error(
      "Usage: set VERIFY_ADMIN_ALLOWED_PREVIEW_ORIGINS, VERIFY_ADMIN_EXPECTED_GIT_REF, and VERIFY_ADMIN_EXPECTED_GIT_SHA; then pass an allowlisted Preview origin.",
    );
  }
  if (process.env.ALLOW_ISOLATED_ADMIN_VERIFY !== "1") {
    throw new Error("Set ALLOW_ISOLATED_ADMIN_VERIFY=1 only for an isolated Preview database.");
  }

  const target = parseAdminVerifyConfiguration({
    baseUrl,
    allowlistedOrigins: process.env.VERIFY_ADMIN_ALLOWED_PREVIEW_ORIGINS ?? "",
    expectedGitRef: process.env.VERIFY_ADMIN_EXPECTED_GIT_REF,
    expectedGitSha: process.env.VERIFY_ADMIN_EXPECTED_GIT_SHA,
  });
  const storageState = requiredEnvironment("ADMIN_STORAGE_STATE");
  if (!existsSync(storageState)) {
    throw new Error("ADMIN_STORAGE_STATE must point to an authenticated Preview browser state.");
  }

  const runId = randomUUID();
  // Keep the cleanup capability out of fields shown in the public schedule.
  const fixtureLabel = randomUUID();
  const { league, notes, approvedTeams, rejectedTeams } = buildVerificationRunMarkers(runId, fixtureLabel);
  const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  let browser;
  let context;
  let verifiedDeployment;
  let testDataMayExist = false;
  let testError;
  let cleanupCounts;
  let cleanupError;

  try {
    browser = await launchBrowser();
    context = await browser.newContext({ storageState, locale: "zh-CN" });
    verifiedDeployment = await readVerifiedDeployment(context, target);
    const verifiedOrigin = verifiedDeployment.origin;

    const page = await context.newPage();
    const adminResponse = await page.goto(`${verifiedOrigin}/admin`, { waitUntil: "networkidle" });
    assertAdminVerifySessionPreflight({
      status: adminResponse?.status(),
      pageUrl: page.url(),
      expectedOrigin: verifiedOrigin,
    });

    testDataMayExist = true;
    await submit(context, verifiedOrigin, {
      game: "honor-of-kings",
      league,
      teamA: approvedTeams[0],
      teamB: approvedTeams[1],
      scheduledAt: startTime,
      bestOf: 5,
      sourceUrl: "https://example.com/isolated-admin-verification",
      notes,
      website: "",
    });
    await page.goto(`${verifiedOrigin}/admin/submissions?q=${encodeURIComponent(approvedTeams[0])}`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("link", { name: "查看" }).click();
    await page.getByRole("button", { name: "批准并发布" }).click();
    await page.waitForURL(/status=approved/);

    let publicMatch;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await context.request.get(`${verifiedOrigin}/api/matches`, {
        headers: { "Cache-Control": "no-cache" },
      });
      const payload = await response.json();
      publicMatch = payload.matches?.find(
        (match) => match.homeTeam?.name === approvedTeams[0] && match.awayTeam?.name === approvedTeams[1],
      );
      if (publicMatch) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!publicMatch) throw new Error("approved match did not appear in the public schedule");

    await page.goto(`${verifiedOrigin}/admin/matches`, { waitUntil: "networkidle" });
    const approvedRow = page.getByRole("row").filter({ hasText: approvedTeams[0] });
    await approvedRow.getByRole("link", { name: "编辑" }).click();
    await page.getByLabel("赛事").fill(`${league} edited`);
    await page.getByRole("button", { name: "保存并刷新公开赛程" }).click();
    await page.getByRole("button", { name: "隐藏比赛" }).click();
    await page.getByRole("button", { name: "恢复公开" }).click();

    const rejectedSubmission = await submit(context, verifiedOrigin, {
      game: "honor-of-kings",
      league,
      teamA: rejectedTeams[0],
      teamB: rejectedTeams[1],
      scheduledAt: startTime,
      bestOf: 5,
      sourceUrl: "https://example.com/isolated-admin-verification",
      notes,
      website: "",
    });
    await page.goto(`${verifiedOrigin}/admin/submissions/${rejectedSubmission.id}`, { waitUntil: "networkidle" });
    await page.getByLabel("驳回原因").fill("Automated isolated Preview rejection test");
    await page.getByRole("button", { name: "驳回" }).click();
    await page.waitForURL(/status=rejected/);

    const rejectedPayload = await (await context.request.get(`${verifiedOrigin}/api/matches`)).json();
    if (rejectedPayload.matches?.some(
      (match) => match.homeTeam?.name === rejectedTeams[0] || match.awayTeam?.name === rejectedTeams[1],
    )) {
      throw new Error("rejected match appeared in the public schedule");
    }

    await page.goto(`${verifiedOrigin}/admin`, { waitUntil: "networkidle" });
    const dashboardText = await page.locator("body").innerText();
    if (!dashboardText.includes("最近操作")) throw new Error("admin audit summary is missing");
  } catch (error) {
    testError = summarizeAdminVerifyFailure(error, "verification");
  } finally {
    if (testDataMayExist && verifiedDeployment && context) {
      try {
        cleanupCounts = await cleanupRun(context, verifiedDeployment.origin, runId);
      } catch (error) {
        cleanupError = summarizeAdminVerifyFailure(error, "cleanup");
      }
    }
    try {
      await context?.close();
    } catch {
      cleanupError ??= "Browser context could not be closed cleanly.";
    }
    try {
      await browser?.close();
    } catch {
      cleanupError ??= "Browser could not be closed cleanly.";
    }
  }

  if (testError || cleanupError) {
    throw new Error(JSON.stringify({
      passed: false,
      deploymentId: verifiedDeployment?.deploymentId ?? null,
      gitCommitSha: verifiedDeployment?.gitCommitSha ?? null,
      testError,
      cleanupError,
    }));
  }

  console.log(JSON.stringify({
    passed: true,
    deploymentId: verifiedDeployment.deploymentId,
    gitCommitSha: verifiedDeployment.gitCommitSha,
    checks: [
      "Preview environment, allowlisted URL, expected branch and SHA",
      "public submission",
      "approve transaction",
      "public merge",
      "edit",
      "hide",
      "restore",
      "reject without publish",
      "audit summary",
      "finally cleanup of isolated verification data",
    ],
    cleanupCounts,
  }, null, 2));
}

await runVerification().catch((error) => {
  const message = error instanceof Error ? error.message : "verify:admin failed.";
  console.error(message);
  process.exitCode = 1;
});
