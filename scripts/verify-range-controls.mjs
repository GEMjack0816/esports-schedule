import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const target = new URL(process.argv[2] ?? "http://localhost:3000");
if (
  !["http:", "https:"].includes(target.protocol)
  || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  || target.username
  || target.password
) {
  throw new Error("Range-control regression verification is loopback-only.");
}

let browser;
try {
  // CI installs the Playwright-managed Chromium; use it on Linux/macOS and
  // prefer it locally whenever it is available.
  browser = await chromium.launch({ headless: true });
} catch {
  // playwright-core does not download a browser automatically. On Windows,
  // reuse an installed browser without ever attaching to a user profile.
}
for (const executablePath of browser ? [] : [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
]) {
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    break;
  } catch {
    // Try the next local browser; never reuse an authenticated user profile.
  }
}
if (!browser) throw new Error("No supported local browser executable found.");

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", () => errors.push("pageerror"));
      page.on("console", (message) => {
        if (message.type() === "error" && !/^Failed to load resource: net::ERR_/.test(message.text())) {
          errors.push("console error");
        }
      });
      const response = await page.goto(target.origin, { waitUntil: "networkidle" });
      assert.equal(response?.status(), 200);
      await page.getByRole("button", { name: "刷新赛程", exact: true }).waitFor();
      const search = page.getByRole("textbox", { name: "搜索战队或赛事", exact: true });
      await search.waitFor();
      const tabs = page.getByRole("tab");
      assert.equal(await tabs.count(), 5);

      async function selected(label) {
        const tab = page.getByRole("tab", { name: new RegExp(`^${label}`) });
        assert.equal(await tab.getAttribute("aria-selected"), "true");
        assert.equal(await tab.getAttribute("tabindex"), "0");
        assert.equal(await page.locator('[role="tab"][tabindex="0"]').count(), 1);
        const panel = page.getByRole("tabpanel");
        assert.equal(await panel.getAttribute("id"), await tab.getAttribute("aria-controls"));
        assert.equal(await panel.getAttribute("aria-labelledby"), await tab.getAttribute("id"));
        assert.equal(await tab.evaluate((element) => element === document.activeElement), true);
      }

      await page.getByRole("tab", { name: /^今日/ }).focus();
      await page.keyboard.press("ArrowLeft");
      await selected("全部收录");
      await page.keyboard.press("Home");
      await selected("今日");
      await page.keyboard.press("ArrowRight");
      await selected("明日");
      await page.keyboard.press("End");
      await selected("全部收录");
      await page.keyboard.press("Tab");
      assert.equal(await search.evaluate((element) => element === document.activeElement), true);

      const date = page.getByLabel("日期", { exact: true });
      async function setDateOverride() {
        const min = await date.getAttribute("min");
        const max = await date.getAttribute("max");
        const value = min ?? max ?? await date.evaluate(() => {
          const localDate = new Date();
          localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
          return localDate.toISOString().slice(0, 10);
        });
        await date.fill(value);
        assert.equal(await date.inputValue(), value, "date override should be set before testing its reset");
      }

      await setDateOverride();
      await page.getByRole("tab", { name: /^今日/ }).click();
      assert.equal(await date.inputValue(), "");
      await setDateOverride();
      await page.getByRole("tab", { name: /^今日/ }).focus();
      await page.keyboard.press("ArrowRight");
      await selected("明日");
      assert.equal(await date.inputValue(), "");

      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: accessible names, keyboard tabs, panel identity, date reset, layout and Console`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

