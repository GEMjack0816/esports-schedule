import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import {
  assertAdminVerificationDeployment,
  parseAdminVerificationTarget,
} from "./verify-admin-safety.mjs";

const target = parseAdminVerificationTarget(process.argv.slice(2));
const storageState = process.env.ADMIN_STORAGE_STATE;
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
let page;
let testDataMayExist = false;
let primaryError;
let cleanupError;
let cleanupSummary;
let passedChecks = [];
const runId = randomUUID();
const league = `Codex isolated review ${runId}`;
const notes = `Isolated Preview verification record ${runId}`;
const approvedTeams = [`Approval A ${runId}`, `Approval B ${runId}`];
const rejectedTeams = [`Reject A ${runId}`, `Reject B ${runId}`];
const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

async function submit(teams) {
  const response = await context.request.post(`${target.baseUrl}/api/submissions`, {
    data: {
      game: "honor-of-kings",
      league,
      teamA: teams[0],
      teamB: teams[1],
      scheduledAt: startTime,
      bestOf: 5,
      sourceUrl: `https://example.com/isolated-admin-verification/${runId}`,
      notes,
      website: "",
    },
  });
  if (response.status() !== 201) throw new Error(`submission returned HTTP ${response.status()}`);
  return response.json();
}

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
  page = await context.newPage();
  const versionResponse = await context.request.get(`${target.baseUrl}/api/version`, {
    headers: { "Cache-Control": "no-cache" },
    maxRedirects: 0,
  });
  if (!versionResponse.ok()) throw new Error(`/api/version returned HTTP ${versionResponse.status()}`);
  let deploymentMetadata;
  try {
    deploymentMetadata = await versionResponse.json();
  } catch {
    throw new Error("/api/version did not return valid deployment metadata.");
  }
  assertAdminVerificationDeployment(deploymentMetadata, target);

  // The API request can commit even if its response is interrupted, so cleanup
  // must run after the first attempted public submission, not after its success.
  testDataMayExist = true;
  await submit(approvedTeams);
  await page.goto(`${target.baseUrl}/admin/submissions?q=${encodeURIComponent(approvedTeams[0])}`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("link", { name: "查看" }).click();
  await page.getByRole("button", { name: "批准并发布" }).click();
  await page.waitForURL(/status=approved/);

  let publicMatch;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await context.request.get(`${target.baseUrl}/api/matches`, {
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

  await page.goto(`${target.baseUrl}/admin/matches`, { waitUntil: "networkidle" });
  const approvedRow = page.getByRole("row").filter({ hasText: approvedTeams[0] });
  await approvedRow.getByRole("link", { name: "编辑" }).click();
  await page.getByLabel("赛事").fill(`${league} edited`);
  await page.getByRole("button", { name: "保存并刷新公开赛程" }).click();
  await page.getByRole("button", { name: "隐藏比赛" }).click();
  await page.getByRole("button", { name: "恢复公开" }).click();

  const rejectedSubmission = await submit(rejectedTeams);
  await page.goto(`${target.baseUrl}/admin/submissions/${rejectedSubmission.id}`, { waitUntil: "networkidle" });
  await page.getByLabel("驳回原因").fill("Automated isolated Preview rejection test");
  await page.getByRole("button", { name: "驳回" }).click();
  await page.waitForURL(/status=rejected/);

  const rejectedPayload = await (await context.request.get(`${target.baseUrl}/api/matches`)).json();
  if (rejectedPayload.matches?.some(
    (match) => match.homeTeam?.name === rejectedTeams[0] || match.awayTeam?.name === rejectedTeams[1],
  )) {
    throw new Error("rejected match appeared in the public schedule");
  }

  await page.goto(`${target.baseUrl}/admin`, { waitUntil: "networkidle" });
  const dashboardText = await page.locator("body").innerText();
  if (!dashboardText.includes("最近操作")) throw new Error("admin audit summary is missing");

  passedChecks = [
    "deployment metadata preflight",
    "public submission",
    "approve transaction",
    "public merge",
    "edit",
    "hide",
    "restore",
    "reject without publish",
    "audit summary",
  ];
} catch (error) {
  primaryError = error;
} finally {
  if (context && testDataMayExist) {
    try {
      const response = await context.request.post(`${target.baseUrl}/api/admin/verification-fixtures/cleanup`, {
        headers: { Origin: target.origin },
        data: {
          runId,
          expectedRef: target.expectedRef,
          expectedSha: target.expectedSha,
        },
      });
      if (!response.ok()) {
        cleanupError = new Error(`cleanup returned HTTP ${response.status()}`);
      } else {
        cleanupSummary = await response.json();
      }
    } catch {
      cleanupError = new Error("cleanup request failed");
    }
  }
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}

if (primaryError) {
  const detail = primaryError instanceof Error ? primaryError.message : "unknown verification error";
  throw new Error(cleanupError
    ? `verify:admin failed (${detail}); test-data cleanup also failed.`
    : `verify:admin failed (${detail}); cleanup ${testDataMayExist ? "completed" : "not needed"}.`);
}
if (cleanupError) throw new Error("verify:admin passed, but test-data cleanup failed; inspect only the isolated Preview database.");
if (!cleanupSummary && testDataMayExist) throw new Error("verify:admin passed, but cleanup confirmation was missing.");

console.log(JSON.stringify({
  passed: true,
  cleanup: cleanupSummary ?? { deletedSubmissions: 0, deletedPublishedMatches: 0 },
  checks: passedChecks,
}, null, 2));
