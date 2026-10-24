import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import {
  assertAdminSessionLanding,
  createPreviewCleanupRequest,
  assertIsolatedDatabasePreflight,
  assertPreviewDeployment,
  parseVerificationTarget,
} from "./verify-admin-safety.mjs";

const [inputUrl, expectedRef, expectedSha] = process.argv.slice(2);
const storageState = process.env.ADMIN_STORAGE_STATE;
const target = parseVerificationTarget({
  baseUrl: inputUrl,
  expectedSha,
  expectedRef,
  allowedHosts: process.env.ADMIN_VERIFY_PREVIEW_HOSTS,
});

if (process.env.ALLOW_ISOLATED_ADMIN_VERIFY !== "1") {
  throw new Error("Set ALLOW_ISOLATED_ADMIN_VERIFY=1 only for an isolated Preview database.");
}
if (!storageState || !existsSync(storageState)) {
  throw new Error("ADMIN_STORAGE_STATE must point to an authenticated Vercel admin browser state.");
}

const executableCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
let browser;
let context;
let cleanupError;
let verifiedDeployment;
const runId = randomUUID();
let cleanupEnabled = false;
let verificationError;

try {
  for (const executablePath of executableCandidates) {
    try {
      browser = await chromium.launch({ executablePath, headless: true });
      break;
    } catch {
      // Try the next installed browser.
    }
  }
  if (!browser) throw new Error("No supported browser executable found.");

  context = await browser.newContext({ storageState, locale: "zh-CN" });
  const versionResponse = await context.request.get(`${target.baseUrl}/api/version`, {
    maxRedirects: 0,
    timeout: 15_000,
  });
  if (versionResponse.status() !== 200) {
    throw new Error("Preview deployment metadata could not be authenticated; no test data was written.");
  }
  let version;
  try {
    version = await versionResponse.json();
  } catch {
    throw new Error("Preview deployment metadata is invalid; no test data was written.");
  }
  verifiedDeployment = assertPreviewDeployment(target, version);
  // A branch alias is mutable. Once its metadata is validated, pin every
  // subsequent browser/API request to the immutable deployment URL returned
  // by that deployment, so an alias reassignment cannot redirect test writes.
  const deploymentBaseUrl = verifiedDeployment.deploymentUrl;

  const page = await context.newPage();
  const dashboardResponse = await page.goto(`${deploymentBaseUrl}/admin`, { waitUntil: "networkidle" });
  assertAdminSessionLanding({
    status: dashboardResponse?.status(),
    url: page.url(),
    baseUrl: deploymentBaseUrl,
    bodyText: await page.locator("body").innerText(),
  });

  const preflightResponse = await context.request.post(`${deploymentBaseUrl}/api/admin/e2e-preflight`, {
    headers: { Origin: new URL(deploymentBaseUrl).origin },
    timeout: 15_000,
  });
  const preflightPayload = await preflightResponse.json().catch(() => null);
  assertIsolatedDatabasePreflight({ status: preflightResponse.status(), payload: preflightPayload });

  cleanupEnabled = true;

  const league = `Codex isolated review ${runId}`;
  const approvedTeams = [`Approval A ${runId}`, `Approval B ${runId}`];
  const rejectedTeams = [`Reject A ${runId}`, `Reject B ${runId}`];
  const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  async function submit(teams) {
    const response = await context.request.post(`${deploymentBaseUrl}/api/submissions`, {
      data: {
        game: "honor-of-kings",
        league,
        teamA: teams[0],
        teamB: teams[1],
        scheduledAt: startTime,
        bestOf: 5,
        sourceUrl: `https://example.com/isolated-admin-verification/${runId}`,
        notes: `E2E verification run: ${runId}`,
        website: "",
      },
    });
    if (response.status() !== 201) throw new Error(`submission returned HTTP ${response.status()}`);
    const result = await response.json();
    if (typeof result?.id !== "string") throw new Error("submission response did not contain an id");
    return result;
  }

  await submit(approvedTeams);
  await page.goto(`${deploymentBaseUrl}/admin/submissions?q=${encodeURIComponent(approvedTeams[0])}`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("link", { name: "查看" }).click();
  await page.getByRole("button", { name: "批准并发布" }).click();
  await page.waitForURL(/status=approved/);

  let publicMatch;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await context.request.get(`${deploymentBaseUrl}/api/matches`, {
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

  await page.goto(`${deploymentBaseUrl}/admin/matches`, { waitUntil: "networkidle" });
  const approvedRow = page.getByRole("row").filter({ hasText: approvedTeams[0] });
  await approvedRow.getByRole("link", { name: "编辑" }).click();
  await page.getByLabel("赛事").fill(`${league} edited`);
  await page.getByRole("button", { name: "保存并刷新公开赛程" }).click();
  await page.getByRole("button", { name: "隐藏比赛" }).click();
  await page.getByRole("button", { name: "恢复公开" }).click();

  const rejectedSubmission = await submit(rejectedTeams);
  await page.goto(`${deploymentBaseUrl}/admin/submissions/${rejectedSubmission.id}`, { waitUntil: "networkidle" });
  await page.getByLabel("驳回原因").fill("Automated isolated Preview rejection test");
  await page.getByRole("button", { name: "驳回" }).click();
  await page.waitForURL(/status=rejected/);

  const rejectedPayload = await (await context.request.get(`${deploymentBaseUrl}/api/matches`)).json();
  if (rejectedPayload.matches?.some(
    (match) => match.homeTeam?.name === rejectedTeams[0] || match.awayTeam?.name === rejectedTeams[1],
  )) {
    throw new Error("rejected match appeared in the public schedule");
  }

  await page.goto(`${deploymentBaseUrl}/admin`, { waitUntil: "networkidle" });
  const dashboardText = await page.locator("body").innerText();
  if (!dashboardText.includes("最近操作")) throw new Error("admin audit summary is missing");

} catch (error) {
  verificationError = error;
} finally {
  if (cleanupEnabled && context) {
    try {
      const cleanupRequest = createPreviewCleanupRequest(verifiedDeployment, runId);
      const cleanupResponse = await context.request.post(cleanupRequest.url, cleanupRequest.options);
      const cleanupPayload = await cleanupResponse.json().catch(() => null);
      if (cleanupResponse.status() !== 200 || cleanupPayload?.ok !== true) {
        const status = cleanupPayload?.cleaned === true
          ? "rows deleted, public cache refresh failed"
          : `HTTP ${cleanupResponse.status()}`;
        cleanupError = new Error(`Preview E2E cleanup incomplete (${status}, run ${runId}).`);
      }
    } catch {
      cleanupError = new Error(`Preview E2E data cleanup failed (run ${runId}).`);
    }
  }
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}

if (verificationError && cleanupError) {
  throw new Error(`${verificationError.message}; ${cleanupError.message}`);
}
if (verificationError) throw verificationError;
if (cleanupError) throw cleanupError;
console.log(JSON.stringify({
  previewVerified: true,
  deploymentId: verifiedDeployment.deploymentId,
  gitCommitSha: verifiedDeployment.gitCommitSha,
  gitCommitRef: verifiedDeployment.gitCommitRef,
  testDataCleanup: "passed",
}));

