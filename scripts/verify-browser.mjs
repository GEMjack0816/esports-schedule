import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] || "http://localhost:3000";
const executableCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

let browser;
let launchError;
for (const executablePath of executableCandidates) {
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    break;
  } catch (error) {
    launchError = error;
  }
}
if (!browser) throw launchError || new Error("No supported browser executable found");

const results = [];
for (const profile of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
]) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  const page = await context.newPage();
  const errors = [];
  const criticalRequestFailures = [];
  const optionalResourceFailures = [];
  const browserResourceWarnings = [];
  const criticalPaths = ["/api/matches", "/api/version", "/api/health/data-coverage"];
  const auditUrl = new URL(baseUrl);
  auditUrl.searchParams.set("audit", `${profile.name}-${Date.now()}`);
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/^Failed to load resource: net::ERR_/.test(text)) {
      browserResourceWarnings.push(text);
      return;
    }
    errors.push(`console:${text}`);
  });
  page.on("pageerror", (error) => errors.push(`page:${error.message}`));
  page.on("requestfailed", (request) => {
    const failedUrl = new URL(request.url());
    if (request.failure()?.errorText === "net::ERR_ABORTED") {
      optionalResourceFailures.push(`${request.method()} ${failedUrl.pathname} aborted`);
      return;
    }
    if (failedUrl.origin !== auditUrl.origin && request.resourceType() === "image") {
      optionalResourceFailures.push(`${request.method()} ${failedUrl.origin}${failedUrl.pathname}`);
      return;
    }
    errors.push(`request:${request.method()} ${request.url()}`);
  });
  page.on("response", (candidate) => {
    const candidateUrl = new URL(candidate.url());
    if (
      candidateUrl.origin === auditUrl.origin
      && criticalPaths.includes(candidateUrl.pathname)
      && candidate.status() >= 400
    ) {
      criticalRequestFailures.push(`${candidate.request().method()} ${candidateUrl.pathname} HTTP ${candidate.status()}`);
    }
  });

  const response = await page.goto(auditUrl.toString(), { waitUntil: "networkidle", timeout: 120_000 });
  const bodyText = await page.locator("body").innerText();
  const html = await page.content();
  const homepageCommit = await page.locator("#esports-schedule-version").getAttribute("data-git-commit");
  const gameOptions = await page.locator('.filter-panel select').first().locator('option').count();
  const syncStatusCards = await page.locator('.sync-status-card').count();
  const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByRole('button', { name: /切换到.+主题/ }).click();
  const toggledTheme = await page.evaluate(() => document.documentElement.dataset.theme);

  const gameFilterCounts = {};
  const statusFilterCounts = {};
  const initialScheduleCounts = await page.locator(".schedule-section").evaluate((section) => ({
    loaded: Number(section.getAttribute("data-schedule-loaded-count")),
    total: Number(section.getAttribute("data-schedule-total-count")),
  }));
  const fullScheduleResponsePromise = initialScheduleCounts.loaded < initialScheduleCounts.total
    ? page.waitForResponse(
      (candidate) => new URL(candidate.url()).pathname === "/api/matches" && candidate.request().method() === "GET",
      { timeout: 120_000 },
    )
    : null;
  await page.getByRole("tab", { name: /全部收录/ }).click();
  let fullScheduleResponseStatus = null;
  if (fullScheduleResponsePromise) {
    const fullScheduleResponse = await fullScheduleResponsePromise;
    fullScheduleResponseStatus = fullScheduleResponse.status();
    if (!fullScheduleResponse.ok()) throw new Error(`Full schedule request returned HTTP ${fullScheduleResponse.status()}`);
    await page.waitForFunction(() => {
      const section = document.querySelector(".schedule-section");
      return !!section
        && Number(section.getAttribute("data-schedule-loaded-count"))
          >= Number(section.getAttribute("data-schedule-total-count"));
    }, { timeout: 120_000 });
  }
  const gameSelect = page.locator(".filter-panel select").nth(0);
  for (const game of ["lol", "valorant", "honor-of-kings", "cs2", "dota2"]) {
    await gameSelect.selectOption(game);
    gameFilterCounts[game] = await page.locator(".match-card").count();
  }
  await gameSelect.selectOption("all");
  const statusSelect = page.locator(".filter-panel select").nth(2);
  for (const status of ["running", "finished", "scheduled"]) {
    await statusSelect.selectOption(status);
    statusFilterCounts[status] = await page.locator(".match-card").count();
  }
  await statusSelect.selectOption("all");
  await page.getByRole("tab", { name: /^今日/ }).click();

  const apiResponsePromise = page.waitForResponse(
    (candidate) => candidate.url().includes("/api/matches") && candidate.request().method() === "GET",
    { timeout: 120_000 },
  );
  await page.locator(".refresh-button").click();
  const apiResponse = await apiResponsePromise;
  let apiBody;
  let apiBodyReadFallback = false;
  try {
    apiBody = await apiResponse.json();
  } catch {
    apiBodyReadFallback = true;
    apiBody = await page.evaluate(async () => {
      const response = await fetch("/api/matches", { cache: "no-store" });
      if (!response.ok) throw new Error(`/api/matches fallback returned HTTP ${response.status}`);
      return response.json();
    });
  }
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className : "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((element) => element.left < -1 || element.right > document.documentElement.clientWidth + 1)
      .slice(0, 12),
  }));
  const screenshot = path.join(os.tmpdir(), `esports-schedule-${profile.name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });

  let versionResult = { status: 0, body: {} };
  let healthResult = { status: 0, body: {} };
  try {
    [versionResult, healthResult] = await page.evaluate(async () => {
      const [versionResponse, healthResponse] = await Promise.all([
        fetch("/api/version", { cache: "no-store" }),
        fetch("/api/health/data-coverage", { cache: "no-store" }),
      ]);
      return [
        { status: versionResponse.status, body: await versionResponse.json() },
        { status: healthResponse.status, body: await healthResponse.json() },
      ];
    });
  } catch (error) {
    errors.push(`version-health:${error instanceof Error ? error.message : "request failed"}`);
  }
  await page.goto(`${baseUrl}/submit-match`, { waitUntil: "networkidle", timeout: 120_000 });
  const submitFields = await page.locator("form input, form select").count();
  const adminResponse = await page.goto(`${baseUrl}/admin`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  const adminBody = await page.locator("body").innerText();
  const adminLegacyResponse = await context.request.post(
    `${baseUrl}/api/admin/legacy-import`,
    { failOnStatusCode: false },
  );

  results.push({
    profile: profile.name,
    status: response?.status() ?? null,
    horizontalOverflow: layout.scrollWidth > layout.clientWidth,
    scrollWidth: layout.scrollWidth,
    clientWidth: layout.clientWidth,
    overflowElements: layout.offenders,
    hasCoverageSummary: bodyText.includes("当前收录范围"),
    hasSubmitLink: bodyText.includes("提交遗漏比赛"),
    hasProfessionalCoverageCopy: bodyText.includes("聚合五大电竞项目的主要职业及半职业比赛"),
    newPageMarkers: ["源快照时间", "提交遗漏比赛", "PandaScore 聚合数据"]
      .filter((phrase) => bodyText.includes(phrase)),
    forbiddenVisiblePhrases: ["演示数据模式", "PandaScore Token 尚未配置", "当前展示演示赛程与王者荣耀人工数据"]
      .filter((phrase) => bodyText.includes(phrase)),
    forbiddenHtmlPhrases: ["演示数据模式", "PandaScore Token 尚未配置", "当前展示演示赛程与王者荣耀人工数据"]
      .filter((phrase) => html.includes(phrase)),
    syncStatusCards,
    gameOptions,
    initialScheduleLoadedCount: initialScheduleCounts.loaded,
    totalScheduleMatchCount: initialScheduleCounts.total,
    fullScheduleResponseStatus,
    gameFilterCounts,
    statusFilterCounts,
    themeToggleWorks: initialTheme !== toggledTheme,
    refreshedApiUrl: apiResponse.url(),
    refreshedApiMode: apiBody.mode,
    refreshedApiDemoMode: apiBody.demoMode,
    refreshedApiStale: apiBody.stale,
    refreshedApiDeployment: apiBody.deployment,
    apiBodyReadFallback,
    healthStatus: healthResult.status,
    healthMode: healthResult.body.mode,
    healthDemoMode: healthResult.body.demoMode,
    healthGames: Object.keys(healthResult.body.games || {}),
    versionStatus: versionResult.status,
    versionGitCommitSha: versionResult.body.gitCommitSha ?? null,
    homepageGitCommitSha: homepageCommit || null,
    healthVersionGitCommitSha: healthResult.body.version?.gitCommitSha ?? null,
    versionMatchesHomepage:
      !!homepageCommit && homepageCommit === versionResult.body.gitCommitSha,
    healthVersionMatches:
      healthResult.body.version?.gitCommitSha === versionResult.body.gitCommitSha,
    criticalRequestFailures,
    optionalResourceFailureCount: optionalResourceFailures.length,
    optionalResourceFailureSamples: optionalResourceFailures.slice(0, 5),
    browserResourceWarningCount: browserResourceWarnings.length,
    submitFields,
    anonymousAdminStatus: adminResponse?.status() ?? null,
    anonymousAdminAtLogin: new URL(page.url()).pathname === "/admin/login",
    anonymousAdminContainsPrivateData:
      adminBody.includes("最近操作") || adminBody.includes("待审核提交"),
    anonymousAdminApiStatus: adminLegacyResponse.status(),
    errors,
    screenshot,
  });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));

const failures = [];
for (const result of results) {
  const prefix = result.profile;
  if (result.status !== 200) failures.push(`${prefix}: homepage HTTP ${result.status}`);
  if (result.horizontalOverflow) failures.push(`${prefix}: horizontal overflow`);
  if (!result.hasCoverageSummary) failures.push(`${prefix}: missing coverage summary`);
  if (!result.hasSubmitLink) failures.push(`${prefix}: missing submission link`);
  if (!result.hasProfessionalCoverageCopy) failures.push(`${prefix}: missing coverage copy`);
  if (result.newPageMarkers.length !== 3) failures.push(`${prefix}: missing new page markers`);
  if (result.forbiddenVisiblePhrases.length > 0) failures.push(`${prefix}: visible demo text`);
  if (result.forbiddenHtmlPhrases.length > 0) failures.push(`${prefix}: demo text in HTML`);
  if (result.syncStatusCards < 5) failures.push(`${prefix}: incomplete sync status cards`);
  if (result.gameOptions < 6) failures.push(`${prefix}: incomplete game filters`);
  if (!result.themeToggleWorks) failures.push(`${prefix}: theme toggle failed`);
  if (result.refreshedApiMode === undefined) failures.push(`${prefix}: refresh API missing mode`);
  if (result.healthStatus !== 200) failures.push(`${prefix}: health HTTP ${result.healthStatus}`);
  if (result.healthGames.length !== 5) failures.push(`${prefix}: health game coverage incomplete`);
  if (result.versionStatus !== 200) failures.push(`${prefix}: version HTTP ${result.versionStatus}`);
  if (!result.versionMatchesHomepage) failures.push(`${prefix}: homepage/version commit mismatch`);
  if (!result.healthVersionMatches) failures.push(`${prefix}: health/version commit mismatch`);
  if (result.submitFields < 6) failures.push(`${prefix}: submission form incomplete`);
  if (result.anonymousAdminStatus !== 200) failures.push(`${prefix}: admin login HTTP ${result.anonymousAdminStatus}`);
  if (!result.anonymousAdminAtLogin) failures.push(`${prefix}: anonymous admin page was not redirected to login`);
  if (result.anonymousAdminContainsPrivateData) failures.push(`${prefix}: anonymous admin page exposed private data`);
  if (result.anonymousAdminApiStatus !== 401) failures.push(`${prefix}: anonymous admin API HTTP ${result.anonymousAdminApiStatus}`);
  failures.push(...result.errors.map((error) => `${prefix}: ${error}`));
  failures.push(...result.criticalRequestFailures.map((error) => `${prefix}: ${error}`));
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log("Browser verification passed.");
