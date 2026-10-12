import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const base = new URL(process.argv[2] || "http://localhost:3105");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) {
  throw new Error("Logo fault injection is restricted to localhost.");
}
const response = await fetch(new URL("/api/matches", base));
assert.equal(response.status, 200);
const template = await response.json();
assert.ok(template.matches.length > 0, "NO_MATCHES_FOR_LOGO_TEST");
const transientLogo = "https://cdn.pandascore.co/images/team/image/test/transient.png";
const persistentLogo = "https://cdn.pandascore.co/images/team/image/test/persistent.png";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvT8AAAAASUVORK5CYII=", "base64");
const installedChrome = process.env.CHROME_PATH ?? [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
const browser = await chromium.launch({
  ...(installedChrome ? { executablePath: installedChrome } : {}),
  headless: true,
});
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const payload = structuredClone(template);
    for (const match of payload.matches) {
      match.homeTeam.logo = "/team-placeholder.svg";
      match.awayTeam.logo = "/team-placeholder.svg";
    }
    payload.matches[0].homeTeam.logo = transientLogo;
    payload.matches[0].awayTeam.logo = persistentLogo;
    let transientAttempts = 0;
    let persistentAttempts = 0;
    const referrerHeaders = [];
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === base.origin) {
        if (url.pathname === "/api/matches") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
        }
        return route.continue();
      }
      if (url.href === transientLogo) {
        transientAttempts += 1;
        referrerHeaders.push(route.request().headers().referer ?? null);
        if (transientAttempts === 1) return route.abort("connectionreset");
        return route.fulfill({ status: 200, contentType: "image/png", body: png });
      }
      if (url.href === persistentLogo) {
        persistentAttempts += 1;
        referrerHeaders.push(route.request().headers().referer ?? null);
        return route.abort("connectionreset");
      }
      if (url.pathname.match(/\.(?:png|jpe?g|webp|gif|svg)$/i)) {
        return route.fulfill({ status: 200, contentType: "image/png", body: png });
      }
      return route.abort();
    });
    await page.goto(base.href);
    await page.locator(".refresh-button").click();
    await page.getByRole("tab", { name: /全部收录/ }).click();
    await page.waitForFunction(url => {
      const image = document.querySelector(".team-mark img");
      return image?.currentSrc === url && image.complete && image.naturalWidth > 0;
    }, transientLogo);
    assert.equal(transientAttempts, 2, "a transient logo failure should cause exactly one retry");

    const persistentMark = page.locator(".team-mark").nth(1);
    await page.waitForFunction(() => {
      const image = document.querySelectorAll(".team-mark img")[1];
      const source = image?.currentSrc;
      if (!source) return false;
      try {
        return new URL(source, window.location.href).pathname === "/team-placeholder.svg";
      } catch {
        return false;
      }
    });
    assert.equal(persistentAttempts, 2, "a persistent remote failure should stop after one retry");
    assert.ok(await persistentMark.locator("img").count());
    await persistentMark.locator("img").evaluate(image => image.dispatchEvent(new Event("error")));
    await page.waitForFunction(() => document.querySelectorAll(".team-mark .team-logo-text").length > 0);
    assert.equal(await persistentMark.locator("img").count(), 0);
    assert.ok(await persistentMark.locator(".team-logo-text").isVisible());
    assert.ok((await persistentMark.innerText()).trim());
    assert.deepEqual(referrerHeaders, [null, null, null, null]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: one transient retry, bounded persistent fallback, no referrer/page error/overflow`);
    await context.close();
  }
} finally {
  await browser.close();
}
