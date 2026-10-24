import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import sharp from "sharp";

const base = new URL(process.argv[2] || "http://localhost:3105");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) {
  throw new Error("Logo fault injection is restricted to localhost.");
}
const now = new Date().toISOString();
const fixtureTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const template = {
  matches: [{
    id: "logo-fallback-test-match",
    provider: "pandascore",
    providerMatchId: "logo-fallback-test-match",
    game: "lol",
    tournament: "Logo Retry Test",
    league: "Logo Retry Test",
    stage: null,
    homeTeam: { name: "Alpha Test", acronym: "ALT", logo: "/team-placeholder.svg" },
    awayTeam: { name: "Bravo Test", acronym: "BVT", logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: 3,
    status: "scheduled",
    startTimeUtc: fixtureTime,
    streams: [],
    lastUpdatedAt: now,
  }],
  generatedAt: now,
  mode: "live",
  demoMode: false,
  stale: false,
  lastSuccessfulSyncAt: now,
  providers: { pandascore: "connected", manual: "json+database" },
  coverage: {
    sourceFetchedAt: now,
    lastAttemptAt: now,
    range: { earliestMatchAt: fixtureTime, latestMatchAt: fixtureTime },
    games: Object.fromEntries(["lol", "valorant", "honor-of-kings", "cs2", "dota2"].map(game => [game, {
      syncStatus: "normal",
      refreshInProgress: false,
      sourceFetchedAt: now,
    }])),
  },
};
const transientLogo = "https://cdn-api.pandascore.co/images/team/image/136955/transient.png";
const persistentLogo = "https://cdn.pandascore.co/images/team/image/900002/persistent.png";
const hangingLogo = "https://cdn.pandascore.co/images/team/image/900003/hanging.png";
const png = await sharp({
  create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
}).png().toBuffer();
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
    const hangingMatch = structuredClone(payload.matches[0]);
    hangingMatch.id = `${payload.matches[0].id}-logo-timeout-${width}`;
    hangingMatch.homeTeam.logo = hangingLogo;
    hangingMatch.awayTeam.logo = "/team-placeholder.svg";
    payload.matches.splice(1, 0, hangingMatch);
    let transientAttempts = 0;
    let persistentAttempts = 0;
    let hangingAttempts = 0;
    let optimizedLogoRequests = 0;
    const optimizedLogoSources = [];
    const referrerHeaders = [];
    const logoResponses = [];
    const logoRequestFailures = [];
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => {
      if (new URL(response.url()).pathname === "/_next/image") {
        logoResponses.push({ status: response.status(), contentType: response.headers()["content-type"], url: response.url() });
      }
    });
    page.on("requestfailed", request => {
      if (new URL(request.url()).pathname === "/_next/image") logoRequestFailures.push(request.failure()?.errorText);
    });
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === base.origin) {
        if (url.pathname === "/api/matches") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
        }
        if (url.pathname === "/_next/image") {
          const source = url.searchParams.get("url");
          optimizedLogoSources.push(source);
          referrerHeaders.push(route.request().headers().referer ?? null);
          if (source === transientLogo) {
            optimizedLogoRequests += 1;
            transientAttempts += 1;
            if (transientAttempts === 1) return route.abort("connectionreset");
            return route.fulfill({ status: 200, contentType: "image/png", body: png });
          }
          if (source === persistentLogo) {
            optimizedLogoRequests += 1;
            persistentAttempts += 1;
            return route.abort("connectionreset");
          }
          if (source === hangingLogo) {
            optimizedLogoRequests += 1;
            hangingAttempts += 1;
            await new Promise(resolve => setTimeout(resolve, 6_000));
            try {
              await route.abort("timedout");
            } catch {
              // The component may already have abandoned this request after its bounded timeout.
            }
            return;
          }
        }
        return route.continue();
      }
      if (`${url.origin}${url.pathname}` === transientLogo
        && url.searchParams.get("esports_logo_retry") === "1") {
        transientAttempts += 1;
        referrerHeaders.push(route.request().headers().referer ?? null);
        if (transientAttempts === 1) return route.abort("connectionreset");
        return route.fulfill({ status: 200, contentType: "image/png", body: png });
      }
      if (`${url.origin}${url.pathname}` === persistentLogo) {
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
    await page.locator(".team-mark").first().scrollIntoViewIfNeeded();
    try {
      await page.waitForFunction(url => {
        const image = document.querySelector(".team-mark img");
        if (!image?.currentSrc || !image.complete || image.naturalWidth === 0) return false;
        const current = new URL(image.currentSrc, window.location.href);
        const expected = new URL(url);
        return current.origin === expected.origin
          && current.pathname === expected.pathname
          && current.searchParams.get("esports_logo_retry") === "1";
      }, transientLogo, { timeout: 10_000 });
    } catch (error) {
      console.error(JSON.stringify({
        width,
        transientAttempts,
        optimizedLogoRequests,
        optimizedLogoSources,
        logoResponses,
        logoRequestFailures,
        imageResponseProbe: await page.evaluate(async () => {
          const image = document.querySelector(".team-mark img");
          if (!image?.currentSrc) return null;
          try {
            const response = await fetch(image.currentSrc);
            const body = await response.arrayBuffer();
            const blob = new Blob([body], { type: response.headers.get("content-type") || "" });
            const probe = new Image();
            probe.src = URL.createObjectURL(blob);
            await probe.decode().catch(() => undefined);
            return { status: response.status, type: response.headers.get("content-type"), bytes: body.byteLength,
              signature: Array.from(new Uint8Array(body).slice(0, 8)), probeWidth: probe.naturalWidth, probeHeight: probe.naturalHeight };
          } catch (probeError) {
            return probeError instanceof Error ? probeError.message : String(probeError);
          }
        }),
        images: await page.locator(".team-mark img").evaluateAll(images => images.map(image => ({
          src: image.src,
          currentSrc: image.currentSrc,
          complete: image.complete,
          naturalWidth: image.naturalWidth,
        }))),
      }));
      throw error;
    }
    assert.equal(transientAttempts, 2, "a transient logo failure should cause exactly one retry");

    const hangingMark = page.locator(".team-mark").nth(2);
    await hangingMark.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const image = document.querySelectorAll(".team-mark img")[2];
      if (!image?.currentSrc) return false;
      return new URL(image.currentSrc, window.location.href).pathname === "/team-placeholder.svg";
    }, undefined, { timeout: 12_000 });
    assert.equal(hangingAttempts, 1, "a hanging remote logo should time out to the local placeholder without waiting for a retry");

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
    assert.ok(optimizedLogoRequests >= 3, "canonical CDN faults should exercise Next's optimized-image route");
    assert.ok(referrerHeaders.every(header => header === null), "logo requests must not include a referrer");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: transient retry, hanging-request timeout, persistent fallback, no referrer/page error/overflow`);
    await context.close();
  }
} finally {
  await browser.close();
}
