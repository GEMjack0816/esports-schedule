import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  env: {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

const now = new Date().toISOString();
const startTimeUtc = new Date(Date.now() + 86_400_000).toISOString();
const transientLogo = "https://cdn.pandascore.co/images/team/image/test/transient.png";
const persistentLogo = "https://cdn.pandascore.co/images/team/image/test/persistent.png";
const stalledLogo = "https://cdn.pandascore.co/images/team/image/test/stalled.png";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvT8AAAAASUVORK5CYII=", "base64");
const matches = [
  { id: "logo-retry-success", homeTeam: { name: "Retry Success", acronym: "RS", logo: transientLogo }, awayTeam: { name: "Persistent Failure", acronym: "PF", logo: persistentLogo } },
  { id: "logo-retry-stalled", homeTeam: { name: "Stalled Retry", acronym: "SR", logo: stalledLogo }, awayTeam: { name: "No Logo", acronym: "NL", logo: "/team-placeholder.svg" } },
].map((match) => ({
  ...match,
  provider: "pandascore",
  providerMatchId: match.id,
  game: "lol",
  tournament: "Logo retry test",
  league: "Logo retry test",
  stage: null,
  homeScore: null,
  awayScore: null,
  bestOf: 3,
  status: "scheduled",
  startTimeUtc,
  streams: [],
  lastUpdatedAt: now,
}));
const payload = {
  matches,
  generatedAt: now,
  mode: "live",
  demoMode: false,
  stale: false,
  lastSuccessfulSyncAt: now,
  providers: { pandascore: "connected", manual: "json+database" },
  coverage: {
    sourceFetchedAt: now,
    lastAttemptAt: now,
    range: { earliestMatchAt: startTimeUtc, latestMatchAt: startTimeUtc },
    games: Object.fromEntries(["lol", "valorant", "honor-of-kings", "cs2", "dota2"].map(game => [game, {
      syncStatus: "normal", refreshInProgress: false, sourceFetchedAt: now,
    }])),
  },
};
const requestCounts = new Map();
const executablePath = process.env.CHROME_PATH ?? [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
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

  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
  for (const width of [1440, 390]) {
    requestCounts.clear();
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "zh-CN" });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await context.route("**/*", async route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === base) {
        if (requestUrl.pathname === "/api/matches") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
        }
        if (requestUrl.pathname === "/_next/image") {
          const source = requestUrl.searchParams.get("url");
          requestCounts.set(`optimized:${source}`, (requestCounts.get(`optimized:${source}`) ?? 0) + 1);
          return route.abort("connectionreset");
        }
        return route.continue();
      }

      if (requestUrl.href === transientLogo) {
        requestCounts.set(`direct:${transientLogo}`, (requestCounts.get(`direct:${transientLogo}`) ?? 0) + 1);
        return route.fulfill({ status: 200, contentType: "image/png", body: png });
      }
      if (requestUrl.href === persistentLogo) {
        requestCounts.set(`direct:${persistentLogo}`, (requestCounts.get(`direct:${persistentLogo}`) ?? 0) + 1);
        return route.abort("connectionreset");
      }
      if (requestUrl.href === stalledLogo) {
        requestCounts.set(`direct:${stalledLogo}`, (requestCounts.get(`direct:${stalledLogo}`) ?? 0) + 1);
        await new Promise(resolve => setTimeout(resolve, 8_000));
        try {
          await route.fulfill({ status: 200, contentType: "image/png", body: png });
        } catch {
          // The component should abandon the stalled request after its timeout.
        }
        return;
      }
      return route.abort();
    });

    assert.equal((await page.goto(base)).status(), 200);
    await page.locator(".refresh-button").click();
    await page.getByRole("tab", { name: /全部收录/ }).click();
    await page.locator(".match-card").first().waitFor();

    const logoImage = (index) => page.locator(".team-mark img").nth(index);
    await logoImage(0).scrollIntoViewIfNeeded();
    await page.waitForFunction((url) => {
      const image = document.querySelector(".team-mark img");
      return image?.currentSrc === url && image.complete && image.naturalWidth > 0;
    }, transientLogo, { timeout: 12_000 });
    assert.equal(requestCounts.get(`optimized:${transientLogo}`), 1);
    assert.equal(requestCounts.get(`direct:${transientLogo}`), 1);

    await logoImage(1).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const image = document.querySelectorAll(".team-mark img")[1];
      if (!image?.complete || !image.currentSrc) return false;
      return new URL(image.currentSrc).pathname === "/team-placeholder.svg";
    }, undefined, { timeout: 12_000 });
    assert.equal(requestCounts.get(`optimized:${persistentLogo}`), 1);
    assert.equal(requestCounts.get(`direct:${persistentLogo}`), 1, "a failed direct retry must not loop");

    await logoImage(2).scrollIntoViewIfNeeded();
    try {
      await page.waitForFunction(() => {
        const image = document.querySelectorAll(".team-mark img")[2];
        if (!image?.complete || !image.currentSrc) return false;
        return new URL(image.currentSrc).pathname === "/team-placeholder.svg";
      }, undefined, { timeout: 12_000 });
    } catch (error) {
      const imageState = await page.locator(".team-mark img").evaluateAll(images =>
        images.map(image => ({ src: image.getAttribute("src"), currentSrc: image.currentSrc, complete: image.complete })));
      console.error("LOGO_RETRY_DIAGNOSTICS", JSON.stringify({
        requestCounts: [...requestCounts.entries()], imageState,
      }));
      throw error;
    }
    assert.equal(requestCounts.get(`optimized:${stalledLogo}`), 1);
    assert.equal(requestCounts.get(`direct:${stalledLogo}`), 1, "a stalled direct retry must remain bounded to one attempt");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(pageErrors, []);
    console.log(`PASS ${width}px: optimized failure, direct retry success/failure/stall, local fallback, no page error or overflow`);
    await context.close();
  }
} finally {
  await browser?.close();
  child.kill();
}
