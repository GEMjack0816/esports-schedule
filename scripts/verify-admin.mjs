import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { assertIsolatedPreviewTarget, parseAllowedPreviewHosts } from "./lib/verify-admin-target.mjs";

const baseUrl = process.argv[2];
const expectedSha = process.argv[3] ?? process.env.EXPECTED_GIT_SHA;
const expectedRef = process.argv[4] ?? process.env.EXPECTED_GIT_REF;
const storageState = process.env.ADMIN_STORAGE_STATE;
const allowedHosts = parseAllowedPreviewHosts(process.env.ADMIN_VERIFY_ALLOWED_PREVIEW_HOSTS);
if (!baseUrl || !expectedSha || !expectedRef) {
  throw new Error("Usage: npm run verify:admin -- <isolated-preview-url> <expected-sha> <expected-ref>");
}
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
for (const executablePath of executableCandidates) {
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    break;
  } catch {
    // Try the next installed browser.
  }
}
if (!browser) throw new Error("No supported browser executable found.");

const context = await browser.newContext({ storageState, locale: "zh-CN" });
const page = await context.newPage();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const league = `Codex isolated review ${suffix}`;
const approvedTeams = [`Approval A ${suffix}`, `Approval B ${suffix}`];
const rejectedTeams = [`Reject A ${suffix}`, `Reject B ${suffix}`];
const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
let version;

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
  if (response.status() !== 201) throw new Error(`submission returned HTTP ${response.status()}`);
  return response.json();
}

const createdSubmissionIds = [];
let publicMatch;
let passed = false;
try {
const versionResponse = await context.request.get(`${baseUrl}/api/version`, {
  headers: { "Cache-Control": "no-cache" },
});
if (!versionResponse.ok()) {
  throw new Error(`Preview identity endpoint returned HTTP ${versionResponse.status()}.`);
}
version = await versionResponse.json();
assertIsolatedPreviewTarget({ baseUrl, expectedSha, expectedRef, allowedHosts, version });

const approvedSubmission = await submit(approvedTeams);
createdSubmissionIds.push(approvedSubmission.id);
await page.goto(`${baseUrl}/admin/submissions?q=${encodeURIComponent(approvedTeams[0])}`, {
  waitUntil: "networkidle",
});
await page.getByRole("link", { name: "查看" }).click();
await page.getByRole("button", { name: "批准并发布" }).click();
await page.waitForURL(/status=approved/);

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
if (!publicMatch) throw new Error("approved match did not appear in the public schedule");

await page.goto(`${baseUrl}/admin/matches`, { waitUntil: "networkidle" });
const approvedRow = page.getByRole("row").filter({ hasText: approvedTeams[0] });
await approvedRow.getByRole("link", { name: "编辑" }).click();
await page.getByLabel("赛事").fill(`${league} edited`);
await page.getByRole("button", { name: "保存并刷新公开赛程" }).click();
await page.getByRole("button", { name: "隐藏比赛" }).click();
await page.getByRole("button", { name: "恢复公开" }).click();

const rejectedSubmission = await submit(rejectedTeams);
createdSubmissionIds.push(rejectedSubmission.id);
await page.goto(`${baseUrl}/admin/submissions/${rejectedSubmission.id}`, { waitUntil: "networkidle" });
await page.getByLabel("驳回原因").fill("Automated isolated Preview rejection test");
await page.getByRole("button", { name: "驳回" }).click();
await page.waitForURL(/status=rejected/);

const rejectedPayload = await (await context.request.get(`${baseUrl}/api/matches`)).json();
if (rejectedPayload.matches?.some(
  (match) => match.homeTeam?.name === rejectedTeams[0] || match.awayTeam?.name === rejectedTeams[1],
)) {
  throw new Error("rejected match appeared in the public schedule");
}

await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
const dashboardText = await page.locator("body").innerText();
if (!dashboardText.includes("最近操作")) throw new Error("admin audit summary is missing");
passed = true;
} finally {
  let cleanupError;
  if (createdSubmissionIds.length > 0) {
    const cleanupResponse = await context.request.post(`${baseUrl}/api/admin/verification-cleanup`, {
      headers: { Origin: new URL(baseUrl).origin },
      data: {
        submissionIds: createdSubmissionIds,
        league,
        gitCommitSha: expectedSha,
        gitCommitRef: expectedRef,
      },
    });
    if (!cleanupResponse.ok()) {
      cleanupError = new Error(`Preview verification cleanup returned HTTP ${cleanupResponse.status()}.`);
    }
  }
  await context.close();
  await browser.close();
  if (cleanupError) throw cleanupError;
}

console.log(JSON.stringify({
  passed,
  target: {
    deploymentId: version.deploymentId,
    gitCommitSha: version.gitCommitSha,
    gitCommitRef: version.gitCommitRef,
  },
  cleanup: "completed",
  checks: [
    "public submission",
    "approve transaction",
    "public merge",
    "edit",
    "hide",
    "restore",
    "reject without publish",
    "audit summary",
    "finally cleanup",
  ],
}, null, 2));
