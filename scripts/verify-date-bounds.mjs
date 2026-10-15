import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const root = fileURLToPath(new URL('../', import.meta.url));
assert.equal((await readdir(root)).some(n => /^\.env(?:\.|$)/.test(n) && n !== '.env.example'), false, 'Local env files must be absent');
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: root, windowsHide: true, stdio: 'ignore',
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, NODE_ENV: 'production' },
});
let browser;
const results = [];
const localKey = (value, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(value));
try {
  let ready = false;
  for(let i=0; i<60; i++) {
    if(child.exitCode !== null) throw new Error('LOCAL_SERVER_EXITED');
    try { ready = (await fetch(`${base}/api/version`, { redirect: 'error' })).ok; } catch {}
    if(ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'LOCAL_SERVER_NOT_READY');
  const browserPaths = [
    ...(process.env.CHROME_PATH ? [process.env.CHROME_PATH] : []),
    undefined,
    ...(process.platform === 'win32' ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ] : []),
  ];
  for (const executablePath of browserPaths) {
    try {
      browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
      break;
    } catch {
      // Try the bundled Playwright browser, then an explicitly installed local browser.
    }
  }
  if (!browser) throw new Error('No supported browser executable found for date-bound verification.');
  const response = await fetch(`${base}/api/matches`, { redirect: 'error' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const earliest = '2026-09-01T01:30:00.000Z';
  const latest = '2026-09-02T23:30:00.000Z';
  payload.matches = [earliest, latest].map((startTimeUtc, i) => ({
    id: `manual:lol:ui-${i}`, provider: 'manual', providerMatchId: `ui-${i}`, game: 'lol',
    league: `Local UI fixture ${i}`, tournament: null, stage: null,
    homeTeam: { name: 'Fixture Alpha', logo:'/team-placeholder.svg' },
    awayTeam: { name: 'Fixture Beta', logo:'/team-placeholder.svg' },
    homeScore:null, awayScore:null, bestOf:3, status:'scheduled', startTimeUtc,
    streams:[], lastUpdatedAt:earliest,
  }));
  payload.coverage.range.earliestMatchAt = earliest;
  payload.coverage.range.latestMatchAt = latest;
  for(const profile of [{ width:1440, timeZone:'Asia/Shanghai', selected:latest }, { width:390, timeZone:'America/Los_Angeles', selected:earliest }]) {
    const context = await browser.newContext({ viewport:{width:profile.width,height:900},timezoneId:profile.timeZone,locale:'zh-CN' });
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', () => errors.push('PAGE_ERROR'));
    page.on('console', message => { if(message.type()==='error') errors.push('CONSOLE_ERROR'); });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if(url.origin !== base || !['GET','HEAD'].includes(request.method())) return route.abort();
      if(url.pathname==='/api/matches') return route.fulfill({ status:200, contentType:'application/json',body:JSON.stringify(payload) });
      return route.continue();
    });
    assert.equal((await page.goto(base)).status(),200);
    await page.locator('.refresh-button').click();
    await page.getByRole('tab', {name:/全部收录/}).click();
    await page.getByRole('heading', {name:'Local UI fixture 1',exact:true}).waitFor();
    const field = page.locator('input[type=date]');
    const actual = {min:await field.getAttribute('min'),max:await field.getAttribute('max')};
    const expected = {min:localKey(earliest,profile.timeZone),max:localKey(latest,profile.timeZone)};
    await field.fill(localKey(profile.selected,profile.timeZone));
    await page.waitForFunction(() => document.querySelectorAll('.match-card').length===1);
    const valid = await field.evaluate(input=>input.validity.valid);
    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    results.push({width:profile.width,timeZone:profile.timeZone,actual,expected,valid,overflow,errors});
    await context.close();
  }
  console.log(JSON.stringify(results));
  for(const result of results) {
    assert.deepEqual(result.actual,result.expected,'LOCAL_DATE_BOUNDS_MISMATCH');
    assert.ok(result.valid,'LOCAL_DATE_REJECTED');
    assert.equal(result.overflow,false);
    assert.deepEqual(result.errors,[]);
  }
} finally {
  await browser?.close();
  child.kill();
}

