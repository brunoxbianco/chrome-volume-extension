// Live-site check: runs the unpacked extension against real websites (needs network).
// Not part of the deterministic E2E: sites change, ads and consent walls vary by region.
// Every test tab is muted with chrome.tabs.update({muted}) before it loads, so nothing is heard;
// Chromium still reports tab.audible for muted tabs, which is what the checks rely on.
// Usage: node live-sites.mjs [--only=youtube,vimeo]   (env BROWSER=path\to\chrome.exe to override)
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
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split(',') : null;
fs.mkdirSync(OUT, { recursive: true });

// ---------- local helper pages (embed host + Meet-like WebRTC loopback) ----------
const pages = {
  '/blank': '<!doctype html><title>blank</title>',
  // WebRTC loopback, the way Meet/Teams play remote participants: remote MediaStream in an <audio srcObject>.
  '/webrtc.html': `<!doctype html><title>WebRTC loopback</title><audio id="a" autoplay></audio><script>
    (async () => {
      const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = 0.05; // the tab is muted; quieter tones get dropped by Opus
      const dest = ctx.createMediaStreamDestination(); o.connect(g); g.connect(dest); o.start();
      const a = new RTCPeerConnection(), b = new RTCPeerConnection();
      a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
      b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
      b.ontrack = (e) => { document.getElementById('a').srcObject = e.streams[0]; };
      dest.stream.getTracks().forEach((t) => a.addTrack(t, dest.stream));
      await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription);
    })();
  </script>`
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/embed') {
    const src = u.searchParams.get('src') || '';
    if (!/^https:\/\//.test(src)) { res.writeHead(400); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!doctype html><title>Embed host: ${new URL(src).host}</title>
      <iframe src="${src.replace(/"/g, '&quot;')}" width="640" height="360" allow="autoplay; encrypted-media" frameborder="0"></iframe>`);
  }
  const body = pages[u.pathname];
  if (!body) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const embed = (src) => `${ORIGIN}/embed?src=${encodeURIComponent(src)}`;

// ---------- harness ----------
const results = [];
function check(site, name, status, detail = '') {
  // status: true (pass) | false (fail) | 'skip'
  const s = status === 'skip' ? 'SKIP' : status ? 'PASS' : 'FAIL';
  results.push({ site, name, status: s, detail: String(detail) });
  console.log(`${s}  [${site}] ${name}${detail !== '' ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 10000, step = 300) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) { try { last = await fn(); } catch { last = undefined; } if (last) return last; await sleep(step); }
  return last;
}

async function clickInFrames(page, predicateSrc) {
  for (const f of page.frames()) {
    try {
      const hit = await f.evaluate(predicateSrc);
      if (hit) return hit;
    } catch { /* detached or cross-origin navigation */ }
  }
  return null;
}
// Privacy-preserving answer on cookie walls: always the "reject" option.
const rejectConsent = (page) => clickInFrames(page, () => {
  const re = /^(reject all|reject|decline|decline all|only necessary|use necessary cookies only|odrzuć wszystko)$/i;
  const el = [...document.querySelectorAll('button, [role=button], a')]
    .find((b) => re.test((b.innerText || b.getAttribute('aria-label') || '').trim()));
  if (!el) return null;
  el.click();
  return el.innerText.trim() || el.getAttribute('aria-label');
});
const kickPlayback = (page) => clickInFrames(page, () => {
  let n = 0;
  for (const m of document.querySelectorAll('video, audio')) if (m.paused) { m.play().catch(() => {}); n++; }
  return n ? `play() on ${n}` : null;
});

const SITES = [
  {
    id: 'youtube', name: 'YouTube watch page', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', spa: true
  },
  {
    id: 'youtube-embed', name: 'YouTube embed (cross-origin iframe)',
    url: embed('https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=1'),
    start: (p) => clickInFrames(p, () => { const b = document.querySelector('.ytp-large-play-button'); if (b) { b.click(); return 'large play'; } return null; })
  },
  { id: 'vimeo', name: 'Vimeo embed (cross-origin iframe)', url: embed('https://player.vimeo.com/video/76979871?autoplay=1') },
  {
    id: 'soundcloud', name: 'SoundCloud widget (cross-origin iframe)',
    url: embed('https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/293&auto_play=true'),
    start: (p) => clickInFrames(p, () => { const b = document.querySelector('.playButton, [title="Play"]'); if (b) { b.click(); return 'play button'; } return null; })
  },
  {
    id: 'spotify', name: 'Spotify embed (cross-origin iframe, no login)',
    url: embed('https://open.spotify.com/embed/track/11dFghVXANMlKmJXsNCbNl'),
    start: (p) => clickInFrames(p, () => { const b = document.querySelector('[data-testid="play-pause-button"], button[aria-label="Play"]'); if (b) { b.click(); return 'play button'; } return null; })
  },
  {
    id: 'tone', name: 'Online tone generator (Web Audio)', url: 'https://www.szynalski.com/tone-generator/',
    start: (p) => clickInFrames(p, () => {
      const b = document.querySelector('#play-button, #playBtn, .play-button') ||
        [...document.querySelectorAll('button, [role=button]')].find((x) => /^\s*play\s*$/i.test(x.innerText));
      if (b) { b.click(); return 'play button'; } return null;
    })
  },
  { id: 'webrtc', name: 'WebRTC loopback (Meet-like, local)', url: `${ORIGIN}/webrtc.html`, noAudible: true }
].filter((s) => !ONLY || ONLY.includes(s.id));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tvm-live-'));
const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: false, // headless never reports tab.audible
  userDataDir: profile,
  enableExtensions: [EXT],
  pipe: true,
  args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required', '--no-first-run',
    '--lang=en-US', '--window-position=-2400,0', '--window-size=1100,800'],
  defaultViewport: null
});
const version = await browser.version();
console.log('Browser:', version);

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 10000 });
  const extId = new URL(swTarget.url()).host;
  const sw = await swTarget.worker();
  const popup = await browser.newPage();
  await popup.setViewport({ width: 360, height: 560 }); // max popup body height
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);

  const tabState = (id) => sw.evaluate(async (id) => {
    const t = await chrome.tabs.get(id);
    return { audible: !!t.audible, muted: t.mutedInfo.muted, title: t.title, url: t.url };
  }, id);
  const setLevel = (id, level) => popup.evaluate((id, level) => chrome.runtime.sendMessage({ type: 'tvm:set', tabId: id, level }), id, level);
  // Reads every <audio>/<video> in every frame twice: in the extension's isolated world (native getter → real
  // volume) and in the page's MAIN world (patched getter → the volume the page believes it set).
  const probe = (id) => sw.evaluate(async (id) => {
    const fn = () => ({ href: location.href, media: [...document.querySelectorAll('video, audio')].map((m) => ({ v: m.volume, paused: m.paused, t: m.currentTime, rs: m.readyState })) });
    const target = { tabId: id, allFrames: true };
    const iso = await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: fn });
    const main = await chrome.scripting.executeScript({ target, world: 'MAIN', func: fn });
    const out = [];
    for (const r of iso) {
      const m = main.find((x) => x.frameId === r.frameId);
      if (!r.result) continue;
      r.result.media.forEach((el, i) => out.push({ frame: r.result.href.slice(0, 60), real: el.v, page: m?.result?.media[i]?.v, paused: el.paused, t: el.t, rs: el.rs }));
    }
    return out;
  }, id);
  const playing = (list) => list.filter((m) => !m.paused);
  const levelOk = (list, level) => playing(list).length > 0 &&
    playing(list).every((m) => Math.abs(m.real - Math.min(1, m.page * level)) < 0.011);
  const fmt = (list) => playing(list).map((m) => `real ${m.real.toFixed(3)} / page ${m.page?.toFixed(3)}`).join('; ') || 'no playing DOM media';

  async function startPlayback(site, page) {
    for (let i = 0; i < 4; i++) {
      const c = await rejectConsent(page);
      if (c) { console.log(`      consent → "${c}"`); await sleep(2500); }
      if (site.start) await site.start(page);
      await kickPlayback(page);
      // WebRTC remote audio is not reported through tab.audible in this setup: use element progress instead.
      const started = site.noAudible
        ? async () => playing(await probe(site.tabId)).some((m) => m.t > 0.5)
        : async () => (await tabState(site.tabId)).audible;
      if (await waitFor(started, 6000)) return true;
    }
    return false;
  }

  for (const site of SITES) {
    console.log(`\n== ${site.name}`);
    const page = await browser.newPage();
    site.page = page;
    try {
      const marker = `${ORIGIN}/blank?site=${site.id}`;
      await page.goto(marker);
      site.tabId = await sw.evaluate(async (u) => {
        const t = (await chrome.tabs.query({})).find((x) => x.url === u);
        await chrome.tabs.update(t.id, { muted: true });
        return t.id;
      }, marker);
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2500);

      const audible = await startPlayback(site, page);
      const st = await tabState(site.tabId);
      if (!audible) {
        // A player that never gets past HAVE_METADATA is a site/environment problem, not the mixer's
        // (Vimeo does this in automated Helium with and without the extension).
        const stuck = (await probe(site.tabId)).filter((m) => !m.paused && m.t === 0 && m.rs < 3);
        if (stuck.length) {
          check(site.id, 'plays sound', 'skip', `player stuck loading media (readyState ${stuck[0].rs}); not caused by the extension`);
          continue;
        }
      }
      check(site.id, site.noAudible ? 'plays (WebRTC stream advancing)' : 'plays sound (tab audible, tab muted for the test)', audible, `${st.title} | muted=${st.muted}`);
      if (!audible) {
        await page.screenshot({ path: path.join(OUT, `live-${site.id}-noaudio.png`) }).catch(() => {});
        continue;
      }
      const base = await probe(site.tabId);
      console.log(`      DOM media: ${base.length} (${playing(base).length} playing) ${fmt(base)}`);

      // Level 30 %
      const r30 = await setLevel(site.tabId, 0.3);
      await sleep(800);
      const p30 = await probe(site.tabId);
      check(site.id, 'set 30 % accepted', r30 && r30.ok, JSON.stringify(r30));
      if (playing(p30).length) {
        check(site.id, 'media real volume = page volume × 0.30', levelOk(p30, 0.3), fmt(p30));
        check(site.id, 'page still sees its own volume', playing(p30).every((m) => {
          const b = base.find((x) => x.frame === m.frame);
          return !b || Math.abs(b.page - m.page) < 1e-6;
        }), playing(p30).map((m) => m.page).join(','));
      } else {
        check(site.id, 'media real volume = page volume × 0.30', 'skip', 'no DOM media element (audio comes from Web Audio or detached Audio)');
      }

      // 0 % → browser audio monitor must report silence (covers Web Audio and detached media too)
      await setLevel(site.tabId, 0);
      if (site.noAudible) {
        await sleep(800);
        const p0 = await probe(site.tabId);
        check(site.id, '0 % → media real volume 0', levelOk(p0, 0), fmt(p0));
      } else {
        const silent = await waitFor(async () => (await tabState(site.tabId)).audible === false, 10000);
        check(site.id, '0 % → tab becomes inaudible', silent, silent ? '' : fmt(await probe(site.tabId)));
      }

      await setLevel(site.tabId, 1);
      await kickPlayback(page);
      if (!site.noAudible) {
        const back = await waitFor(async () => (await tabState(site.tabId)).audible, 10000);
        check(site.id, '100 % → audible again', back);
      }
      await sleep(800);
      const p100 = await probe(site.tabId);
      if (playing(p100).length) check(site.id, 'media real volume = page volume at 100 %', levelOk(p100, 1), fmt(p100));

      // Persistence across a full reload
      await setLevel(site.tabId, 0.4);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2500);
      const replay = await startPlayback(site, page);
      if (!replay) {
        check(site.id, 'level 40 % survives reload', 'skip', 'no sound after reload');
      } else {
        await sleep(800);
        const pr = await probe(site.tabId);
        if (playing(pr).length) check(site.id, 'level 40 % survives reload', levelOk(pr, 0.4), fmt(pr));
        else check(site.id, 'level 40 % survives reload', 'skip', 'no DOM media to measure');
      }
      const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), site.tabId);
      check(site.id, 'badge shows 40 after reload', badge === '40', badge);

      // YouTube: in-app (SPA) navigation to another video keeps the level
      if (site.spa) {
        const before = (await tabState(site.tabId)).url;
        const href = await page.evaluate(() => {
          const a = [...document.querySelectorAll('a[href^="/watch?v="]')].find((x) => !x.href.includes('aqz-KE-bpKQ') && x.offsetParent);
          if (a) { a.click(); return a.getAttribute('href'); }
          return null;
        });
        if (!href) {
          check(site.id, 'SPA navigation keeps level', 'skip', 'no related-video link found');
        } else {
          await waitFor(async () => (await tabState(site.tabId)).url !== before, 10000);
          await sleep(3000);
          await kickPlayback(page);
          await waitFor(async () => playing(await probe(site.tabId)).length, 10000);
          await sleep(1500);
          const ps = await probe(site.tabId);
          check(site.id, 'SPA navigation to another video keeps 40 %', levelOk(ps, 0.4), `${href} → ${fmt(ps)}`);
        }
      }
      await page.screenshot({ path: path.join(OUT, `live-${site.id}.png`) }).catch(() => {});
    } catch (err) {
      check(site.id, 'unexpected error', false, err.message);
    }
  }

  // The popup lists all live tabs
  await popup.reload();
  await popup.waitForSelector('.row', { timeout: 5000 }).catch(() => {});
  await sleep(500);
  const titles = await popup.$$eval('.row .title', (els) => els.map((e) => e.textContent));
  for (const site of SITES.filter((s) => s.tabId)) {
    const t = (await tabState(site.tabId)).title;
    const st = await tabState(site.tabId);
    if (st.audible || st.muted) check(site.id, 'listed in the popup', titles.includes(t), t);
  }
  await popup.bringToFront();
  const overflow = await popup.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rows: [...document.querySelectorAll('.row')].filter((r) => r.querySelector('.value').getBoundingClientRect().right > document.documentElement.clientWidth).length,
    scrolls: document.body.scrollHeight > document.body.clientHeight
  }));
  check('popup', 'many tabs: no horizontal overflow, values fully visible', overflow.doc <= 0 && overflow.rows === 0, JSON.stringify(overflow));
  await popup.screenshot({ path: path.join(OUT, 'live-popup.png') });
} catch (err) {
  check('harness', 'unexpected error', false, err.stack);
} finally {
  await browser.close();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  fs.writeFileSync(path.join(OUT, 'live-results.json'), JSON.stringify({ date: new Date().toISOString(), browser: version, results }, null, 2));
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exitCode = failed ? 1 : 0;
}
