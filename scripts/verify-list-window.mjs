import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const probe = createServer();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [
  "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port),
], {
  cwd: root,
  windowsHide: true,
  stdio: "ignore",
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, NODE_ENV: "production" },
});

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error("LOCAL_SERVER_EXITED");
    try {
      ready = (await fetch(`${base}/api/version`, { redirect: "error" })).ok;
    } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "LOCAL_SERVER_NOT_READY");

  const response = await fetch(`${base}/api/matches`, { redirect: "error" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const start = Date.now() + 86_400_000;
  payload.matches = Array.from({ length: 450 }, (_, index) => ({
    id: `manual:lol:list-window-${index}`,
    provider: "manual",
    providerMatchId: `list-window-${index}`,
    game: "lol",
    tournament: null,
    league: "Progressive rendering fixture",
    stage: null,
    homeTeam: { name: `Alpha ${index}`, logo: "/team-placeholder.svg" },
    awayTeam: { name: `Beta ${index}`, logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: 3,
    status: "scheduled",
    startTimeUtc: new Date(start + index * 60_000).toISOString(),
    streams: [],
    lastUpdatedAt: new Date(start).toISOString(),
  }));

  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "zh-CN" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") errors.push(message.text());
    });
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base || !["GET", "HEAD"].includes(request.method())) return route.abort();
      if (url.pathname === "/api/matches") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
      }
      return route.continue();
    });

    assert.equal((await page.goto(base)).status(), 200);
    await page.locator(".refresh-button").click();
    await page.getByRole("tab", { name: /全部收录/ }).click();
    await page.waitForFunction(() => document.querySelectorAll(".match-card").length === 200);
    const loadMore = page.getByRole("button", { name: "加载更多比赛" });
    assert.match(await page.locator(".match-list-more p").innerText(), /200 \/ 450/);
    await loadMore.click();
    await page.waitForFunction(() => document.querySelectorAll(".match-card").length === 400);
    await loadMore.click();
    await page.waitForFunction(() => document.querySelectorAll(".match-card").length === 450);
    assert.equal(await loadMore.count(), 0);

    await page.locator(".filter-panel select").first().selectOption("lol");
    await page.waitForFunction(() => document.querySelectorAll(".match-card").length === 200);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: 200 -> 400 -> 450, filter reset -> 200, no page error or overflow`);
    await context.close();
  }
} finally {
  await browser?.close();
  child.kill();
}
