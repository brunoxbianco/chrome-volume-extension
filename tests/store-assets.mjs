// Generates Chrome Web Store images from the REAL extension popup (Helium/Chromium, synthetic local tabs).
// Output: release/store-assets/{screenshot-en.png, screenshot-pl.png, promo-small-440x280.png}
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'release', 'store-assets');
const BROWSER = process.env.BROWSER ||
  path.join(os.homedir(), 'AppData', 'Local', 'imput', 'Helium', 'Application', 'chrome.exe');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Near-silent synthetic audio (≈ -55 dBFS) so tabs count as "audible" without disturbing anyone.
const tone = (title, freq) => `<!doctype html><meta charset="utf-8"><title>${title}</title><script>
  const c = new AudioContext(); const o = c.createOscillator(); o.frequency.value = ${freq};
  const g = c.createGain(); g.gain.value = 0.002; o.connect(g); g.connect(c.destination); o.start();</script>`;
const pages = {
  '/music': tone('Lo-fi beats to study to – Music player', 220),
  '/call': tone('Weekly team call', 330),
  '/video': tone('How volcanoes work – Video', 440),
  '/podcast': tone('Podcast · Episode 42', 550)
};
const server = http.createServer((req, res) => {
  const body = pages[req.url];
  res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body || '');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

async function capturePopup(lang, dark) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tvm-assets-'));
  const browser = await puppeteer.launch({
    executablePath: BROWSER, headless: false, pipe: true, userDataDir: profile,
    enableExtensions: [EXT], defaultViewport: null,
    args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required', '--no-first-run',
      `--lang=${lang}`, '--window-position=-2400,0', '--window-size=900,700']
  });
  try {
    const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'));
    const extId = new URL(sw.url()).host;
    for (const p of Object.keys(pages)) await (await browser.newPage()).goto(ORIGIN + p);
    const worker = await sw.worker();
    await worker.evaluate(async () => {
      for (let i = 0; i < 40; i++) {
        if ((await chrome.tabs.query({ audible: true })).length >= 4) return;
        await new Promise((r) => setTimeout(r, 250));
      }
    });
    const popup = await browser.newPage();
    await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
    await popup.setViewport({ width: 360, height: 420, deviceScaleFactor: 2 });
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.waitForSelector('.row');
    await sleep(400);
    const set = async (i, pct) => popup.evaluate((i, pct) => {
      const s = document.querySelectorAll('.row .slider')[i];
      s.value = String(pct); s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }, i, pct);
    await set(0, 35); await set(2, 70);
    await popup.evaluate(() => document.querySelectorAll('.row .mute')[3].click());
    await sleep(800);
    await popup.evaluate(() => document.activeElement && document.activeElement.blur());
    const h = await popup.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await popup.setViewport({ width: 360, height: h, deviceScaleFactor: 2 });
    await sleep(200);
    return (await popup.screenshot({ type: 'png' })).toString('base64');
  } finally {
    await browser.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

const icon = fs.readFileSync(path.join(EXT, 'icons', 'icon128.png')).toString('base64');
const font = "font-family: 'Segoe UI', system-ui, sans-serif;";
function screenshotHtml(popupB64, headline, sub, bullets) {
  return `<!doctype html><html><body style="margin:0;width:1280px;height:800px;overflow:hidden;${font}
    background:linear-gradient(135deg,#eef0ff 0%,#dcdcfb 55%,#c9c6f7 100%);display:flex;align-items:center;gap:70px;padding:0 90px;box-sizing:border-box">
    <div style="flex:1;color:#1b1840">
      <img src="data:image/png;base64,${icon}" width="96" height="96" style="margin-left:-16px">
      <h1 style="font-size:50px;line-height:1.1;margin:14px 0 18px;font-weight:700">${headline}</h1>
      <p style="font-size:24px;line-height:1.45;margin:0 0 26px;color:#3b3770">${sub}</p>
      <ul style="font-size:21px;line-height:1.9;margin:0;padding-left:26px;color:#2c2960">${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
    </div>
    <img src="data:image/png;base64,${popupB64}" style="width:auto;max-width:400px;max-height:700px;border-radius:14px;box-shadow:0 30px 70px rgba(40,30,120,.35)">
  </body></html>`;
}

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, pipe: true });
async function render(html, width, height, file) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: path.join(OUT, file), type: 'png' });
  await page.close();
  console.log('wrote', path.join(OUT, file));
}

try {
  const en = await capturePopup('en-US', true);
  const pl = await capturePopup('pl', false);
  await render(screenshotHtml(en, 'A volume slider<br>for every tab',
    'Turn down one noisy tab without touching the rest. No Windows mixer needed.',
    ['Lists every tab that plays sound', 'Per-tab slider 0–100% and mute', 'Kept after reload, nothing leaves your device']),
  1280, 800, 'screenshot-en.png');
  await render(screenshotHtml(pl, 'Osobny suwak<br>dla każdej karty',
    'Ścisz jedną głośną kartę, nie ruszając pozostałych. Bez miksera Windows.',
    ['Lista wszystkich kart z dźwiękiem', 'Suwak 0–100% i wyciszenie dla każdej karty', 'Działa po przeładowaniu, dane nie opuszczają urządzenia']),
  1280, 800, 'screenshot-pl.png');
  await render(`<!doctype html><html><body style="margin:0;width:440px;height:280px;overflow:hidden;${font}
      background:linear-gradient(135deg,#635bff,#4338ca);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <img src="data:image/png;base64,${icon}" width="112" height="112" style="margin:-16px 0 -4px;filter:drop-shadow(0 6px 14px rgba(0,0,0,.25))">
      <div style="font-size:34px;font-weight:700;letter-spacing:-.5px">Tab Volume Mixer</div>
      <div style="font-size:17px;opacity:.9;margin-top:6px">A volume slider for every tab</div>
    </body></html>`, 440, 280, 'promo-small-440x280.png');
} finally {
  await browser.close();
  server.close();
}
