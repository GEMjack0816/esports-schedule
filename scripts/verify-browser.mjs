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
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console:${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page:${error.message}`));
  page.on("requestfailed", (request) => errors.push(`request:${request.method()} ${request.url()}`));

  const response = await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 120_000 });
  const bodyText = await page.locator("body").innerText();
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

  let healthResult = { status: 0, body: {} };
  try {
    healthResult = await page.evaluate(async () => {
      const response = await fetch("/api/health/data-coverage", { cache: "no-store" });
      return { status: response.status, body: await response.json() };
    });
  } catch (error) {
    errors.push(`health:${error instanceof Error ? error.message : "request failed"}`);
  }
  await page.goto(`${baseUrl}/submit-match`, { waitUntil: "networkidle", timeout: 120_000 });
  const submitFields = await page.locator("form input, form select").count();

  results.push({
    profile: profile.name,
    status: response?.status() ?? null,
    horizontalOverflow: layout.scrollWidth > layout.clientWidth,
    scrollWidth: layout.scrollWidth,
    clientWidth: layout.clientWidth,
    overflowElements: layout.offenders,
    hasCoverageSummary: bodyText.includes("当前收录范围"),
    hasSubmitLink: bodyText.includes("提交遗漏比赛"),
    healthStatus: healthResult.status,
    healthMode: healthResult.body.mode,
    healthDemoMode: healthResult.body.demoMode,
    submitFields,
    errors,
    screenshot,
  });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
