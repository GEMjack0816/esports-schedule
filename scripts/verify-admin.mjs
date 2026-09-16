import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import {
  adminVerificationConfig,
  assertPreviewVersion,
} from "./verify-admin-guard.mjs";

const storageState = process.env.ADMIN_STORAGE_STATE;
if (!storageState || !existsSync(storageState)) {
  throw new Error("ADMIN_STORAGE_STATE must point to an authenticated Vercel admin browser state.");
}
const config = adminVerificationConfig(process.argv.slice(2));

const executableCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

async function launchBrowser() {
  for (const executablePath of executableCandidates) {
    try {
      return await chromium.launch({ executablePath, headless: true });
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error("No supported browser executable found.");
}

function endpoint(pathname) {
  return new URL(pathname, config.baseUrl).toString();
}

async function readJsonResponse(response, label) {
  if (response.status() !== 200) {
    throw new Error(`${label} returned HTTP ${response.status()}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

const browser = await launchBrowser();
const context = await browser.newContext({ storageState, locale: "zh-CN" });
const page = await context.newPage();
const runMarker = randomUUID();
const league = `Codex isolated review ${runMarker}`;
const notes = `Isolated Preview verification record ${runMarker}`;
const approvedTeams = [`Approval A ${runMarker}`, `Approval B ${runMarker}`];
const rejectedTeams = [`Reject A ${runMarker}`, `Reject B ${runMarker}`];
const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
let verificationResult;
let verificationError;
let cleanupError;
let previewIdentityVerified = false;

async function submit(teams) {
  const response = await context.request.post(endpoint("/api/submissions"), {
    data: {
      game: "honor-of-kings",
      league,
      teamA: teams[0],
      teamB: teams[1],
      scheduledAt: startTime,
      bestOf: 5,
      sourceUrl: "https://example.com/isolated-admin-verification",
      notes,
      website: "",
    },
  });
  if (response.status() !== 201) throw new Error(`submission returned HTTP ${response.status()}`);
  const payload = await response.json();
  if (typeof payload.id !== "string") throw new Error("submission response did not contain an id");
  return payload;
}

try {
  const versionResponse = await context.request.get(endpoint("/api/version"), {
    failOnStatusCode: false,
    headers: { "Cache-Control": "no-cache" },
    timeout: 60_000,
  });
  const version = await readJsonResponse(versionResponse, "/api/version");
  assertPreviewVersion(version, config);
  previewIdentityVerified = true;

  const adminResponse = await page.goto(endpoint("/admin"), {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  const adminUrl = new URL(page.url());
  const adminText = await page.locator("body").innerText();
  if (
    adminResponse?.status() !== 200
    || adminUrl.origin !== config.baseUrl
    || adminUrl.pathname !== "/admin"
    || !adminText.includes("审核概览")
  ) {
    throw new Error("Authenticated Preview administrator preflight failed.");
  }

  await submit(approvedTeams);
  await page.goto(
    endpoint(`/admin/submissions?q=${encodeURIComponent(approvedTeams[0])}`),
    { waitUntil: "networkidle" },
  );
  await page.getByRole("link", { name: "查看" }).click();
  await page.getByRole("button", { name: "批准并发布" }).click();
  await page.waitForURL(/status=approved/);

  let publicMatch;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await context.request.get(endpoint("/api/matches"), {
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

  await page.goto(endpoint("/admin/matches"), { waitUntil: "networkidle" });
  const approvedRow = page.getByRole("row").filter({ hasText: approvedTeams[0] });
  await approvedRow.getByRole("link", { name: "编辑" }).click();
  await page.getByLabel("赛事").fill(`${league} edited`);
  await page.getByRole("button", { name: "保存并刷新公开赛程" }).click();
  await page.getByRole("button", { name: "隐藏比赛" }).click();
  await page.getByRole("button", { name: "恢复公开" }).click();

  const rejectedSubmission = await submit(rejectedTeams);
  await page.goto(endpoint(`/admin/submissions/${rejectedSubmission.id}`), { waitUntil: "networkidle" });
  await page.getByLabel("驳回原因").fill("Automated isolated Preview rejection test");
  await page.getByRole("button", { name: "驳回" }).click();
  await page.waitForURL(/status=rejected/);

  const rejectedPayload = await (await context.request.get(endpoint("/api/matches"))).json();
  if (rejectedPayload.matches?.some(
    (match) => match.homeTeam?.name === rejectedTeams[0] || match.awayTeam?.name === rejectedTeams[1],
  )) {
    throw new Error("rejected match appeared in the public schedule");
  }

  await page.goto(endpoint("/admin"), { waitUntil: "networkidle" });
  const dashboardText = await page.locator("body").innerText();
  if (!dashboardText.includes("最近操作")) throw new Error("admin audit summary is missing");

  verificationResult = {
    passed: true,
    environment: version.environment,
    gitCommitRef: version.gitCommitRef,
    gitCommitSha: version.gitCommitSha,
    deploymentId: version.deploymentId,
    checks: [
      "Preview deployment identity",
      "authenticated administrator preflight",
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
} catch (error) {
  verificationError = error;
} finally {
  if (previewIdentityVerified) {
    try {
      const cleanupResponse = await context.request.post(endpoint("/api/admin/verification-cleanup"), {
        data: { runMarker },
        failOnStatusCode: false,
        headers: { Origin: config.baseUrl },
        timeout: 60_000,
      });
      const cleanupPayload = await readJsonResponse(
        cleanupResponse,
        "/api/admin/verification-cleanup",
      );
      if (cleanupPayload.ok !== true) throw new Error("Preview verification cleanup was not acknowledged.");
      if (verificationResult) {
        const result = cleanupPayload.result;
        if (
          result?.submissionsDeleted !== 2
          || result?.manualMatchesDeleted !== 1
          || !Number.isInteger(result?.auditEventsDeleted)
          || result.auditEventsDeleted < 1
        ) {
          throw new Error("Preview verification cleanup counts did not match the completed run.");
        }
        verificationResult.cleanup = result;
      }
    } catch (error) {
      cleanupError = error;
    }
  }
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}

if (verificationError || cleanupError) {
  const messages = [
    verificationError instanceof Error ? verificationError.message : null,
    cleanupError instanceof Error ? `cleanup: ${cleanupError.message}` : null,
  ].filter(Boolean);
  throw new Error(messages.join("; "));
}

console.log(JSON.stringify(verificationResult, null, 2));
