// End-to-end test against a real Chromium build (Helium by default) with the unpacked extension.
// Usage: node e2e.mjs [--headful]   (env BROWSER=path\to\chrome.exe to override)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '..', 'extension');
const OUT = path.resolve(here, '..', 'quality', 'evidence');
const BROWSER = process.env.BROWSER ||
  path.join(os.homedir(), 'AppData', 'Local', 'imput', 'Helium', 'Application', 'chrome.exe');
const headful = !process.argv.includes('--headless'); // headless builds never report tab.audible
fs.mkdirSync(OUT, { recursive: true });

// ---------- synthetic fixtures ----------
function sineWav(seconds = 2, freq = 440, rate = 22050) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  // amplitude 60/32768 ≈ -55 dBFS: above Chrome's audible threshold (~-72 dBFS), barely perceptible
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 60), 44 + i * 2);
  return buf;
}
const pages = {
  // Hostile page script: tries to swallow the extension's level event (must not work).
  '/media.html': `<!doctype html><title>Fixture media tab</title><script>for (const t of [window, document]) t.addEventListener('tvm-level-v1', (e) => e.stopImmediatePropagation(), true);</script><audio id="a" src="/tone.wav" loop autoplay></audio>`,
  '/webaudio.html': `<!doctype html><title>Fixture Web Audio tab</title><script>
    const ctx = new AudioContext(); const o = ctx.createOscillator(); o.frequency.value = 330;
    const g = ctx.createGain(); g.gain.value = 0.002; o.connect(g); g.connect(ctx.destination); o.start();
    window.__ret = g.connect(ctx.destination) === ctx.destination; // chaining contract
  </script>`,
  '/silent.html': `<!doctype html><title>Fixture silent tab</title><p>no audio</p>`
};
const wav = sineWav();
const server = http.createServer((req, res) => {
  if (req.url === '/tone.wav') { res.writeHead(200, { 'content-type': 'audio/wav' }); return res.end(wav); }
  const body = pages[req.url];
  if (!body) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ---------- harness ----------
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 8000, step = 250) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(step); }
  return last;
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tvm-e2e-'));
const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: !headful,
  userDataDir: profile,
  enableExtensions: [EXT],
  pipe: true,
  args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--lang=en-US', '--window-position=-2400,0', '--window-size=900,700'],
  defaultViewport: null
});
const version = await browser.version();
console.log('Browser:', version);

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 10000 });
  const extId = new URL(swTarget.url()).host;
  check('extension loaded, service worker running', !!extId, extId);
  const sw = await swTarget.worker();

  // Isolated-world probe: reads the *real* (unpatched) media volume.
  async function realVolume(page) {
    const cdp = await page.createCDPSession();
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
    await cdp.send('Runtime.enable');
    await sleep(200);
    const iso = contexts.find((c) => c.auxData && c.auxData.type === 'isolated' && c.auxData.frameId === page.mainFrame()._id);
    if (!iso) { await cdp.detach(); return null; }
    const r = await cdp.send('Runtime.evaluate', { contextId: iso.id, expression: "document.querySelector('audio').volume", returnByValue: true });
    await cdp.detach();
    return r.result.value;
  }
  const tabInfo = (urlPart) => sw.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find((x) => x.url && x.url.includes(u));
    return t && { id: t.id, audible: !!t.audible, muted: t.mutedInfo.muted, title: t.title };
  }, urlPart);

  const media = await browser.newPage();
  await media.goto(ORIGIN + '/media.html');
  const wa = await browser.newPage();
  await wa.goto(ORIGIN + '/webaudio.html');
  const silent = await browser.newPage();
  await silent.goto(ORIGIN + '/silent.html');

  check('Web Audio connect() keeps native return value', await wa.evaluate(() => window.__ret) === true);
  const mediaAudible = await waitFor(async () => (await tabInfo('/media.html'))?.audible);
  const waAudible = await waitFor(async () => (await tabInfo('/webaudio.html'))?.audible);
  check('J1 precondition: media tab is audible', mediaAudible);
  check('J1 precondition: Web Audio tab is audible', waAudible);

  // Open the popup UI as a tab.
  const popup = await browser.newPage();
  await popup.setViewport({ width: 360, height: 520 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForSelector('.row', { timeout: 5000 }).catch(() => {});
  const titles = await popup.$$eval('.row .title', (els) => els.map((e) => e.textContent));
  check('J1 popup lists both audible tabs', titles.includes('Fixture media tab') && titles.includes('Fixture Web Audio tab'), titles.join(' | '));
  check('J1 popup hides the silent tab', !titles.includes('Fixture silent tab'));
  await popup.screenshot({ path: path.join(OUT, 'popup-two-tabs.png') });

  async function setSlider(title, pct) {
    await popup.evaluate((title, pct) => {
      const row = [...document.querySelectorAll('.row')].find((r) => r.querySelector('.title').textContent === title);
      const s = row.querySelector('.slider');
      s.value = String(pct);
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }, title, pct);
    await sleep(400);
  }

  // J2: media tab to 30 %
  await setSlider('Fixture media tab', 30);
  const v30 = await realVolume(media);
  check('J2 media element real volume = 0.30', Math.abs(v30 - 0.3) < 0.01, v30);
  check('J2 page still sees its own volume 1.0', await media.evaluate(() => document.querySelector('audio').volume) === 1);
  await media.evaluate(() => { document.querySelector('audio').volume = 0.5; });
  const v15 = await realVolume(media);
  check('J2 page sets 0.5 → real 0.15 (multiplicative)', Math.abs(v15 - 0.15) < 0.01, v15);
  check('J2 page getter returns 0.5', await media.evaluate(() => document.querySelector('audio').volume) === 0.5);
  const bg = await popup.evaluate(() => document.querySelector('.row .value').textContent);
  check('J2 popup shows value', /30%/.test(await popup.$$eval('.row .value', (e) => e.map((x) => x.textContent).join(','))), bg);

  // J2b: 0 % → Chrome's audio monitor reports the tab as no longer audible; other tab unaffected
  await setSlider('Fixture media tab', 0);
  const mediaSilent = await waitFor(async () => (await tabInfo('/media.html'))?.audible === false, 8000);
  check('J2 media tab at 0% becomes inaudible (browser audio monitor)', mediaSilent);
  check('J2 Web Audio tab still audible', (await tabInfo('/webaudio.html'))?.audible);

  await setSlider('Fixture Web Audio tab', 0);
  const waSilent = await waitFor(async () => (await tabInfo('/webaudio.html'))?.audible === false, 8000);
  check('J2 Web Audio tab at 0% becomes inaudible (GainNode path)', waSilent);
  await setSlider('Fixture Web Audio tab', 100);
  const waBack = await waitFor(async () => (await tabInfo('/webaudio.html'))?.audible, 8000);
  check('J2 Web Audio tab back to 100% is audible again', waBack);

  // J5: idle tab with non-default level stays listed
  const stillListed = await popup.$$eval('.row .title', (els) => els.some((e) => e.textContent === 'Fixture media tab'));
  check('J5 inaudible tab with level ≠ 100% stays in list', stillListed);

  // J3: reload keeps level
  await setSlider('Fixture media tab', 40);
  await media.reload();
  await sleep(800);
  const vReload = await realVolume(media);
  check('J3 level survives reload (real volume 0.40)', Math.abs(vReload - 0.4) < 0.01, vReload);
  const badge = await sw.evaluate(async (u) => {
    const t = (await chrome.tabs.query({})).find((x) => x.url && x.url.includes(u));
    return chrome.action.getBadgeText({ tabId: t.id });
  }, '/media.html');
  check('J3 badge shows level on that tab', badge === '40', badge);

  // J4: mute toggle
  await popup.evaluate(() => {
    const row = [...document.querySelectorAll('.row')].find((r) => r.querySelector('.title').textContent === 'Fixture Web Audio tab');
    row.querySelector('.mute').click();
  });
  const muted = await waitFor(async () => (await tabInfo('/webaudio.html'))?.muted, 3000);
  check('J4 mute button mutes tab', muted);
  await sleep(300);
  const pressed = await popup.evaluate(() => [...document.querySelectorAll('.row')].find((r) => r.querySelector('.title').textContent === 'Fixture Web Audio tab').querySelector('.mute').getAttribute('aria-pressed'));
  check('J4 mute state reflected (aria-pressed=true)', pressed === 'true');
  await popup.screenshot({ path: path.join(OUT, 'popup-adjusted.png') });
  const resetVis = await popup.evaluate(() => [...document.querySelectorAll('.row')].map((r) =>
    [r.querySelector('.value').textContent, r.querySelector('.reset').getBoundingClientRect().width > 0]));
  check('UI reset button visible only when level ≠ 100%', resetVis.every(([v, vis]) => vis === (v !== '100%')), JSON.stringify(resetVis));

  // Message validation: page/tab context cannot set levels of other tabs
  const forged = await media.evaluate(() => typeof chrome !== 'undefined' && chrome.runtime ? 'runtime-visible' : 'no-runtime');
  check('Security: page MAIN world has no extension messaging', forged === 'no-runtime', forged);
  const invalid = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'tvm:set', tabId: 1, level: 7 }));
  check('Security: out-of-range level rejected', invalid && invalid.ok === false && invalid.error === 'invalid', JSON.stringify(invalid));

  // J6: restricted page
  const sys = await browser.newPage();
  await sys.goto('chrome://version');
  // No host access to chrome:// → the extension cannot see its URL; it is the newest tab.
  const sysId = await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.filter((x) => !x.url).sort((a, b) => b.id - a.id)[0];
    await chrome.tabs.update(t.id, { muted: true }); // muted tabs are listed even when silent
    return t.id;
  });
  const restricted = await popup.evaluate((id) => chrome.runtime.sendMessage({ type: 'tvm:set', tabId: id, level: 0.5 }), sysId);
  check('J6 restricted page refused with reason', restricted && restricted.error === 'restricted', JSON.stringify(restricted));
  await sleep(500);
  const sysRow = await popup.evaluate(() => {
    const row = [...document.querySelectorAll('.row')].find((r) => r.querySelector('.slider').disabled);
    return row && { title: row.querySelector('.title').textContent, hint: !row.querySelector('.hint').hidden };
  });
  check('J6 restricted tab listed with disabled slider + hint', sysRow && sysRow.hint, JSON.stringify(sysRow));
  await popup.screenshot({ path: path.join(OUT, 'popup-restricted.png') });

  // J7: keyboard / a11y basics
  const a11y = await popup.evaluate(() => {
    const s = document.querySelector('.row .slider');
    const m = document.querySelector('.row .mute');
    return { slider: s.getAttribute('aria-label'), valuetext: s.getAttribute('aria-valuetext'), mute: m.getAttribute('aria-label') };
  });
  check('J7 controls have accessible names', a11y.slider && a11y.valuetext && a11y.mute, JSON.stringify(a11y));
  await popup.bringToFront();
  await popup.focus('.row .slider');
  const before = await popup.$eval('.row .slider', (s) => Number(s.value));
  await popup.keyboard.press('ArrowLeft');
  await sleep(300);
  const after = await popup.$eval('.row .slider', (s) => Number(s.value));
  check('J7 arrow key changes slider', after === before - 1, `${before} → ${after}`);

  // Lifecycle: tab close removes stored level
  const mediaId = (await tabInfo('/media.html')).id;
  await media.close();
  await sleep(500);
  const levels = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'tvm:levels' }));
  check('Lifecycle: closed tab level removed from session storage', !(String(mediaId) in levels.levels), JSON.stringify(levels.levels));
  await popup.screenshot({ path: path.join(OUT, 'popup-final.png') });

  // Lifecycle: extension reload/update while a media tab stays open → content scripts are orphaned,
  // worker must re-inject on demand.
  const media2 = await browser.newPage();
  await media2.goto(ORIGIN + '/media.html');
  await sleep(500);
  await sw.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 50); }).catch(() => {});
  await sleep(1500);
  const sw2Target = await browser.waitForTarget((t) => t !== swTarget && t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 10000 });
  const sw2 = await sw2Target.worker();
  const id2 = await sw2.evaluate(async (u) => (await chrome.tabs.query({})).find((x) => x.url && x.url.includes(u)).id, '/media.html');
  const popup2 = await browser.newPage();
  await popup2.goto(`chrome-extension://${extId}/popup/popup.html`);
  const res2 = await popup2.evaluate((id) => chrome.runtime.sendMessage({ type: 'tvm:set', tabId: id, level: 0.25 }), id2);
  const v25 = await realVolume(media2);
  check('Lifecycle: after extension reload, open tab is re-injected and set to 0.25', res2 && res2.ok && Math.abs(v25 - 0.25) < 0.01, `${JSON.stringify(res2)} real=${v25}`);
} catch (err) {
  check('unexpected error', false, err.stack);
} finally {
  await browser.close();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify({ date: new Date().toISOString(), browser: version, headless: !headful, results }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}
