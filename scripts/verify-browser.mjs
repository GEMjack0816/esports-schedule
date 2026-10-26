import os from "node:os";
import path from "node:path";
import {
  addTrustedSourceHeader,
  getTrustedVercelDeploymentOrigin,
  isolateBrowserEnvironment,
  redactTrustedSourceToken,
} from "./vercel-trusted-source-headers.mjs";

const baseUrl = process.argv[2] || "http://localhost:3000";
const trustedSourceToken = process.env.VERCEL_OIDC_TOKEN;
const trustedSourceOrigin = trustedSourceToken
  ? getTrustedVercelDeploymentOrigin(baseUrl)
  : null;

if (trustedSourceToken && !trustedSourceOrigin) {
  throw new Error("VERCEL_OIDC_TOKEN only supports this project's HTTPS Vercel Preview deployment URL.");
}

const browserEnvironment = trustedSourceToken
  ? isolateBrowserEnvironment(process.env)
  : process.env;

if (trustedSourceToken) {
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, browserEnvironment);
  // Prevent Playwright protocol diagnostics from printing authenticated headers.
  delete process.env.DEBUG;
  delete process.env.PWDEBUG;
}

const { chromium } = await import("playwright-core");

const executableCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

let browser;
let launchError;
for (const executablePath of executableCandidates) {
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      env: browserEnvironment,
    });
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
  const sanitizeDiagnostic = (value) => redactTrustedSourceToken(value, trustedSourceToken);
  const applyTrustedSourceHeader = (request) => addTrustedSourceHeader(
    request.headers(),
    request.url(),
    trustedSourceOrigin || auditUrl.origin,
    trustedSourceToken,
  );
  const continueRequest = async (route) => {
    try {
      return await route.continue({ headers: applyTrustedSourceHeader(route.request()) });
    } catch (error) {
      throw new Error(sanitizeDiagnostic(error instanceof Error ? error.message : error));
    }
  };
  const fetchRequest = async (route) => {
    try {
      return await route.fetch({ headers: applyTrustedSourceHeader(route.request()) });
    } catch (error) {
      throw new Error(sanitizeDiagnostic(error instanceof Error ? error.message : error));
    }
  };
  // Vercel's short-lived local OIDC identity is optional. Scope it to this
  // deployment origin only; never attach it to third-party scripts or images.
  await context.route("**/*", continueRequest);
  auditUrl.searchParams.set("audit", `${profile.name}-${Date.now()}`);
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/^Failed to load resource: net::ERR_/.test(text)) {
      browserResourceWarnings.push(sanitizeDiagnostic(text));
      return;
    }
    errors.push(`console:${sanitizeDiagnostic(text)}`);
  });
  page.on("pageerror", (error) => errors.push(`page:${sanitizeDiagnostic(error.message)}`));
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
    errors.push(`request:${request.method()} ${sanitizeDiagnostic(request.url())}`);
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
  const serverHtml = response ? await response.text() : "";
  const hasUpcomingPlaceholderBeforeHydration = serverHtml.includes("UP NEXT · 24H</span><strong>—</strong>");
  await page.waitForFunction(() => {
    const count = document.querySelector(".hero-stats .stat-card:nth-child(2) strong")?.textContent?.trim();
    return Boolean(count && count !== "—");
  });
  const bodyText = await page.locator("body").innerText();
  const html = await page.content();
  const homepageCommit = await page.locator("#esports-schedule-version").getAttribute("data-git-commit");
  const upcomingHeroText = await page.locator(".hero-stats .stat-card").nth(1).innerText();
  const dateInputBounds = await page.evaluate(async () => {
    const input = document.querySelector('input[type="date"]');
    const response = await fetch("/api/health/data-coverage", { cache: "no-store" });
    if (!response.ok) throw new Error(`Date-bound health check returned HTTP ${response.status}`);
    const health = await response.json();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const localDate = (value) => {
      if (!value) return null;
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return null;
      const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(date).map((part) => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    };
    const current = new Date();
    const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(current).map((part) => [part.type, part.value]));
    const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
    const earliest = localDate(health.range?.earliestMatchAt);
    const latest = localDate(health.range?.latestMatchAt);
    return {
      timeZone,
      min: input?.getAttribute("min") ?? null,
      expectedMin: earliest && earliest < today ? earliest : today,
      max: input?.getAttribute("max") ?? null,
      expectedMax: latest && latest > today ? latest : today,
      today,
    };
  });
  if (dateInputBounds.min !== dateInputBounds.expectedMin
    || dateInputBounds.max !== dateInputBounds.expectedMax) {
    throw new Error(`Date input bounds do not match local timezone ${dateInputBounds.timeZone}`);
  }
  if (dateInputBounds.min > dateInputBounds.today || dateInputBounds.max < dateInputBounds.today) {
    throw new Error(`Date input does not allow local Today in ${dateInputBounds.timeZone}`);
  }
  const gameOptions = await page.locator('.filter-panel select').first().locator('option').count();
  const syncStatusCards = await page.locator('.sync-status-card').count();
  const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByRole('button', { name: /切换到.+主题/ }).click();
  const toggledTheme = await page.evaluate(() => document.documentElement.dataset.theme);

  const searchPage = await context.newPage();
  const searchPageErrors = [];
  searchPage.on('pageerror', (error) => searchPageErrors.push(sanitizeDiagnostic(error.message)));
  await searchPage.goto(auditUrl.toString(), { waitUntil: 'networkidle', timeout: 120_000 });
  const searchInitialLoadedCount = Number(await searchPage.locator('.schedule-section')
    .getAttribute('data-schedule-loaded-count'));
  const searchInitialTotalCount = Number(await searchPage.locator('.schedule-section')
    .getAttribute('data-schedule-total-count'));
  let globalSearchMode = 'empty';
  let globalSearchRequestStatus = null;
  let globalSearchResultCount = 0;
  let globalSearchFoundFixture = false;
  if (searchInitialLoadedCount < searchInitialTotalCount) {
    globalSearchMode = 'partial';
    await searchPage.route('**/api/matches', async (route) => {
      if (route.request().method() !== 'GET') return continueRequest(route);
      const response = await fetchRequest(route);
      const body = await response.json();
      const fixtureName = 'Codex global search fixture';
      const outsideToday = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      body.matches = body.matches.map((match, index) => ({
        ...match,
        startTimeUtc: outsideToday,
        status: 'scheduled',
        homeTeam: index === 0 ? { ...match.homeTeam, name: fixtureName } : match.homeTeam,
      }));
      body.coverage.totals.finalWithManual = body.matches.length;
      await route.fulfill({ response, body: JSON.stringify(body) });
    });
    const globalSearchRequest = searchPage.waitForResponse(
      (candidate) => new URL(candidate.url()).pathname === '/api/matches'
        && candidate.request().method() === 'GET',
      { timeout: 120_000 },
    );
    await searchPage.locator('.search-field input').fill('Codex global search fixture');
    const searchResponse = await globalSearchRequest;
    globalSearchRequestStatus = searchResponse.status();
    if (!searchResponse.ok()) {
      throw new Error(`Global search schedule request returned HTTP ${searchResponse.status()}`);
    }
    await searchPage.waitForFunction(() => {
      const section = document.querySelector('.schedule-section');
      return !!section
        && Number(section.getAttribute('data-schedule-loaded-count'))
          >= Number(section.getAttribute('data-schedule-total-count'));
    }, { timeout: 120_000 });
    globalSearchResultCount = await searchPage.locator('.match-card').count();
    globalSearchFoundFixture = (await searchPage.locator('.match-list').innerText())
      .includes('Codex global search fixture');
    if (!(await searchPage.getByText("正在全部已收录赛程中搜索；选择日期可缩小范围。", { exact: true }).count())) {
      throw new Error("Global search scope hint is missing");
    }
  } else {
    await searchPage.getByRole('tab', { name: /全部收录/ }).click();
    if (searchInitialTotalCount > 0) {
      await searchPage.locator('.match-card').first().waitFor({ timeout: 120_000 });
    }
    const firstTeam = searchPage.locator('.team-name').first();
    if (await firstTeam.count()) {
      globalSearchMode = 'complete';
      const searchTerm = (await firstTeam.innerText()).trim();
      await searchPage.locator('.search-field input').fill(searchTerm);
      await searchPage.locator('.match-card').filter({ hasText: searchTerm }).first()
        .waitFor({ timeout: 120_000 });
      globalSearchResultCount = await searchPage.locator('.match-card').count();
      globalSearchFoundFixture = (await searchPage.locator('.match-list').innerText())
        .includes(searchTerm);
    }
  }
  await searchPage.close();

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

  // Client-only fixtures cover running matches that are undated or cross local midnight.
  await page.route("**/api/matches", async (route) => {
    if (route.request().method() !== "GET") return continueRequest(route);
    const response = await fetchRequest(route);
    const body = await response.json();
    const syntheticRunning = [
      { id: "browser-verify-running-undated", date: null, name: "Codex undated live fixture" },
      { id: "browser-verify-running-yesterday", date: "2026-10-21T12:30:00.000Z", name: "Codex midnight live fixture" },
    ].map((fixture) => ({
      id: fixture.id,
      provider: "manual",
      providerMatchId: fixture.id,
      game: "lol",
      tournament: null,
      league: fixture.name,
      stage: null,
      homeTeam: { name: fixture.name, acronym: "CLF", logo: "/team-placeholder.svg" },
      awayTeam: { name: "Verification opponent", acronym: "VO", logo: "/team-placeholder.svg" },
      homeScore: null,
      awayScore: null,
      bestOf: null,
      status: "running",
      startTimeUtc: fixture.date,
      streams: [],
      lastUpdatedAt: new Date().toISOString(),
    }));
    body.matches = [...body.matches, ...syntheticRunning];
    body.coverage.totals.finalWithManual += syntheticRunning.length;
    await route.fulfill({ response, body: JSON.stringify(body) });
  });

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
  await page.locator(".match-card").filter({ hasText: "Codex undated live fixture" }).waitFor();
  const expectedTodayRunningCount = apiBody.matches.filter((match) => match.status === "running").length;
  const todayTabCount = Number(await page.getByRole("tab", { name: /^今日/ }).locator("em").innerText());
  await statusSelect.selectOption("running");
  const todayRunningCount = await page.locator(".match-card").count();
  const liveHeadingVisible = await page.getByText("正在进行", { exact: true }).count() > 0;
  const selectedDateInput = page.locator(".date-field input[type='date']");
  const { localToday, tomorrow } = await page.evaluate(() => {
    const date = new Date();
    const key = (value) => [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
    const today = key(date);
    date.setDate(date.getDate() + 1);
    return { localToday: today, tomorrow: key(date) };
  });
  await selectedDateInput.fill(localToday);
  const selectedTodayRunningCount = await page.locator(".match-card").count();
  await selectedDateInput.fill(tomorrow);
  const selectedOtherDateRunningCount = await page.locator(".match-card").count();
  await selectedDateInput.fill("");
  await statusSelect.selectOption("all");
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
    groupHeadings: Array.from(document.querySelectorAll(".date-group .date-divider span"))
      .map((element) => element.textContent?.trim() || ""),
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
    errors.push(`version-health:${sanitizeDiagnostic(error instanceof Error ? error.message : "request failed")}`);
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
    hasUpcomingPlaceholderBeforeHydration,
    hasExplicitUpcomingWindow: upcomingHeroText.includes("UP NEXT · 24H")
      && upcomingHeroText.includes("24 小时内开赛"),
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
    dateInputBounds,
    gameFilterCounts,
    statusFilterCounts,
    themeToggleWorks: initialTheme !== toggledTheme,
    globalSearchCompleteness: {
      mode: globalSearchMode,
      initialLoadedCount: searchInitialLoadedCount,
      initialTotalCount: searchInitialTotalCount,
      requestStatus: globalSearchRequestStatus,
      resultCount: globalSearchResultCount,
      foundFixture: globalSearchFoundFixture,
      errors: searchPageErrors,
    },
    refreshedApiUrl: apiResponse.url(),
    expectedTodayRunningCount,
    todayTabCount,
    todayRunningCount,
    selectedTodayRunningCount,
    selectedOtherDateRunningCount,
    liveHeadingVisible,
    liveGroupIsFirst: layout.groupHeadings[0] === "正在进行",
    groupHeadings: layout.groupHeadings,
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
  if (!result.hasUpcomingPlaceholderBeforeHydration) failures.push(`${prefix}: upcoming hero briefly renders an uninitialized count`);
  if (!result.hasExplicitUpcomingWindow) failures.push(`${prefix}: upcoming hero window is not explicit`);
  if (!result.hasSubmitLink) failures.push(`${prefix}: missing submission link`);
  if (!result.hasProfessionalCoverageCopy) failures.push(`${prefix}: missing coverage copy`);
  if (result.newPageMarkers.length !== 3) failures.push(`${prefix}: missing new page markers`);
  if (result.forbiddenVisiblePhrases.length > 0) failures.push(`${prefix}: visible demo text`);
  if (result.forbiddenHtmlPhrases.length > 0) failures.push(`${prefix}: demo text in HTML`);
  if (result.syncStatusCards < 5) failures.push(`${prefix}: incomplete sync status cards`);
  if (result.gameOptions < 6) failures.push(`${prefix}: incomplete game filters`);
  if (!result.themeToggleWorks) failures.push(`${prefix}: theme toggle failed`);
  if (result.globalSearchCompleteness.initialLoadedCount < result.globalSearchCompleteness.initialTotalCount
    && result.globalSearchCompleteness.requestStatus !== 200) {
    failures.push(`${prefix}: global search did not load the complete schedule`);
  }
  if (result.globalSearchCompleteness.mode === 'partial'
    && (!result.globalSearchCompleteness.foundFixture || result.globalSearchCompleteness.resultCount !== 1)) {
    failures.push(`${prefix}: global search did not find exactly one full-schedule fixture`);
  }
  if (result.globalSearchCompleteness.mode === 'complete'
    && (!result.globalSearchCompleteness.foundFixture || result.globalSearchCompleteness.resultCount < 1)) {
    failures.push(`${prefix}: search failed on an initially complete schedule`);
  }
  failures.push(...result.globalSearchCompleteness.errors.map((error) => `${prefix}: search:${error}`));
  if (result.todayTabCount < result.expectedTodayRunningCount) failures.push(`${prefix}: Today tab count excludes one or more running fixtures`);
  if (result.todayRunningCount < result.expectedTodayRunningCount) failures.push(`${prefix}: Today/Running filter hides an undated or prior-local-day live match`);
  if (result.selectedTodayRunningCount < result.expectedTodayRunningCount) failures.push(`${prefix}: selecting local Today hides an undated or prior-local-day live match`);
  if (result.selectedOtherDateRunningCount !== 0) failures.push(`${prefix}: running matches leak into a manually selected non-today date`);
  if (!result.liveHeadingVisible) failures.push(`${prefix}: running fixtures are not grouped under the live heading`);
  if (!result.liveGroupIsFirst) failures.push(`${prefix}: live group is not ordered before calendar date groups`);
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
