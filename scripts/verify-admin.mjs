import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import postgres from "postgres";
import {
  assertPreviewBaseUrl,
  assertPreviewDatabaseUrl,
  assertPreviewDeployment,
  cleanupVerifyAdminData,
  parseDeploymentAllowlist,
  parseHostnameAllowlist,
  runWithAdminVerifyCleanup,
} from "./verify-admin-safety.mjs";

const [requestedBaseUrl, expectedRef, expectedSha] = process.argv.slice(2);
const storageState = process.env.ADMIN_STORAGE_STATE;
const databaseUrl = process.env.DATABASE_URL;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

if (!requestedBaseUrl || !expectedRef || !expectedSha) {
  fail("ADMIN_VERIFY_USAGE_REQUIRES_PREVIEW_URL_BRANCH_AND_SHA");
}
if (process.env.ALLOW_ISOLATED_ADMIN_VERIFY !== "1") {
  fail("ADMIN_VERIFY_EXPLICIT_ISOLATED_PREVIEW_CONFIRMATION_REQUIRED");
}
if (!storageState || !existsSync(storageState)) {
  fail("ADMIN_VERIFY_AUTHENTICATED_STORAGE_STATE_REQUIRED");
}

const allowedHosts = parseHostnameAllowlist(process.env.ADMIN_VERIFY_PREVIEW_HOSTS, "PREVIEW_HOSTS");
const allowedDeploymentIds = parseDeploymentAllowlist(process.env.ADMIN_VERIFY_PREVIEW_DEPLOYMENT_IDS);
const allowedDatabaseHosts = parseHostnameAllowlist(
  process.env.ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS,
  "PREVIEW_DATABASE_HOSTS",
);
const baseUrl = assertPreviewBaseUrl(requestedBaseUrl, allowedHosts);
assertPreviewDatabaseUrl(databaseUrl, allowedDatabaseHosts);

const executableCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const runId = randomUUID();
const league = `Codex isolated review ${runId}`;
const approvedTeams = [`Approval A ${runId}`, `Approval B ${runId}`];
const rejectedTeams = [`Reject A ${runId}`, `Reject B ${runId}`];
const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
let browser;
let context;
let page;
let database;

async function submit(teams) {
  const response = await context.request.post(`${baseUrl}/api/submissions`, {
    data: {
      game: "honor-of-kings",
      league,
      teamA: teams[0],
      teamB: teams[1],
      scheduledAt: startTime,
      bestOf: 5,
      sourceUrl: "https://example.com/isolated-admin-verification",
      notes: "Isolated Preview verification record",
      website: "",
    },
  });
  if (response.status() !== 201) fail("ADMIN_VERIFY_SUBMISSION_FAILED");
  return response.json();
}

async function runChecks() {
  let launchFailure = true;
  for (const executablePath of executableCandidates) {
    try {
      browser = await chromium.launch({ executablePath, headless: true });
      launchFailure = false;
      break;
    } catch {
      // Try the next installed browser without logging executable paths.
    }
  }
  if (launchFailure || !browser) fail("ADMIN_VERIFY_BROWSER_NOT_AVAILABLE");

  context = await browser.newContext({ storageState, locale: "zh-CN" });
  page = await context.newPage();
  const versionResponse = await context.request.get(`${baseUrl}/api/version`, { timeout: 15_000 });
  if (!versionResponse.ok()) fail("ADMIN_VERIFY_VERSION_ENDPOINT_UNAVAILABLE");
  let version;
  try {
    version = await versionResponse.json();
  } catch {
    fail("ADMIN_VERIFY_VERSION_RESPONSE_INVALID");
  }
  const deployment = assertPreviewDeployment({
    baseUrl,
    version,
    expectedRef,
    expectedSha,
    allowedHosts,
    allowedDeploymentIds,
  });

  database = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    prepare: false,
  });
  await database`select 1`;

  const checks = await runWithAdminVerifyCleanup(async () => {
    await submit(approvedTeams);
    await page.goto(`${baseUrl}/admin/submissions?q=${encodeURIComponent(approvedTeams[0])}`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("link", { name: "查看" }).click();
    await page.getByRole("button", { name: "批准并发布" }).click();
    await page.waitForURL(/status=approved/);

    let publicMatch;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await context.request.get(`${baseUrl}/api/matches`, {
        headers: { "Cache-Control": "no-cache" },
      });
      const payload = await response.json();
      publicMatch = payload.matches?.find(
        (match) => match.homeTeam?.name === approvedTeams[0] && match.awayTeam?.name === approvedTeams[1],
      );
      if (publicMatch) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!publicMatch) fail("ADMIN_VERIFY_APPROVED_MATCH_NOT_VISIBLE");

    await page.goto(`${baseUrl}/admin/matches`, { waitUntil: "networkidle" });
    const approvedRow = page.getByRole("row").filter({ hasText: approvedTeams[0] });
    await approvedRow.getByRole("link", { name: "编辑" }).click();
    await page.getByLabel("赛事").fill(`${league} edited`);
    await page.getByRole("button", { name: "保存并刷新公开赛程" }).click();
    await page.getByRole("button", { name: "隐藏比赛" }).click();
    await page.getByRole("button", { name: "恢复公开" }).click();

    const rejectedSubmission = await submit(rejectedTeams);
    await page.goto(`${baseUrl}/admin/submissions/${rejectedSubmission.id}`, { waitUntil: "networkidle" });
    await page.getByLabel("驳回原因").fill("Automated isolated Preview rejection test");
    await page.getByRole("button", { name: "驳回" }).click();
    await page.waitForURL(/status=rejected/);

    const rejectedPayload = await (await context.request.get(`${baseUrl}/api/matches`)).json();
    if (rejectedPayload.matches?.some(
      (match) => match.homeTeam?.name === rejectedTeams[0] || match.awayTeam?.name === rejectedTeams[1],
    )) {
      fail("ADMIN_VERIFY_REJECTED_MATCH_BECAME_PUBLIC");
    }

    await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
    const dashboardText = await page.locator("body").innerText();
    if (!dashboardText.includes("最近操作")) fail("ADMIN_VERIFY_AUDIT_SUMMARY_MISSING");

    return {
      deploymentId: deployment.deploymentId,
      checks: [
        "Preview deployment identity",
        "public submission",
        "approve transaction",
        "public merge",
        "edit",
        "hide",
        "restore",
        "reject without publish",
        "audit summary",
      ],
    };
  }, () => cleanupVerifyAdminData(database, league));

  console.log(JSON.stringify({ passed: true, ...checks }, null, 2));
}

try {
  await runChecks();
} catch (error) {
  const code = typeof error?.code === "string" && /^ADMIN_VERIFY_[A-Z0-9_]+$/.test(error.code)
    ? error.code
    : "ADMIN_VERIFY_FAILED";
  console.error(`FAIL ${code}. Sensitive details were omitted.`);
  process.exitCode = 1;
} finally {
  try { await context?.close(); } catch {}
  try { await browser?.close(); } catch {}
  try { await database?.end({ timeout: 2 }); } catch {}
}
