import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = new URL(process.argv[2] || "http://localhost:3105");
if (!["localhost", "127.0.0.1"].includes(base.hostname)) {
  throw new Error("Logo fault injection is restricted to localhost.");
}
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base.href);
    await page.getByRole("tab", { name: /全部收录/ }).click();
    const mark = page.locator(".team-mark").first();
    await mark.waitFor();
    // Control failure delivery without relying on a live third-party CDN.
    await mark.locator("img").evaluate(image => image.dispatchEvent(new Event("error")));
    const remaining = mark.locator("img");
    if (await remaining.count()) {
      await remaining.evaluate(image => image.dispatchEvent(new Event("error")));
    }
    await page.waitForFunction(() => document.querySelector(".team-mark .team-logo-text"));
    assert.equal(await mark.locator("img").count(), 0);
    assert.ok(await mark.locator(".team-logo-text").isVisible());
    assert.ok((await mark.innerText()).trim());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: terminal text fallback, no image retry, no page error or overflow`);
    await context.close();
  }
} finally {
  await browser.close();
}
