# Test report — Tab Volume Mixer 1.0.1

Date: 2026-11-20 · Role: qa-engineer (run serially by the orchestrator; not an independent agent)

## Exact artifact & browser
* Build: `extension/` (the same files zipped into `release/tab-volume-mixer-1.0.1.zip`)
* Browser: **Helium, Chrome/157.0.8103.78** (local install; it auto-updated from 147 since 1.0.0), fresh temporary profile, extension loaded unpacked via CDP
* Mode: headed window placed off-screen. Headless Chromium never reports `tab.audible`, so it cannot verify the core journey.

## 1. Deterministic E2E — 36/36 pass
Command: `cd tests && node e2e.mjs` → `quality/evidence/e2e-results.json`.
Fixtures: local `127.0.0.1` server; a 440 Hz `<audio>` loop and a 330 Hz Web Audio oscillator, both at ≈ −55 dBFS. The media fixture includes a hostile listener that tries to swallow the level event (security S1 regression).

| Journey | Observed |
| --- | --- |
| J1 list | Popup lists both audible tabs, hides the silent one |
| J2 per-tab level | Media element real volume 0.30 at 30 %; the page still reads its own `volume` (1.0 → 0.5 gives real 0.15) |
| J2 silence | Media tab at 0 % → browser audio monitor reports **not audible**; the other tab stays audible |
| J2 Web Audio | Web Audio tab at 0 % → not audible; back at 100 % → audible (GainNode path) |
| **J2c Web Audio-routed media (new)** | `<audio>` routed through `createMediaElementSource()` and `new MediaElementAudioSourceNode()` keeps the page volume at 50 % (scaled once, by the GainNode); at 0 % the tab is inaudible; the constructor still returns real `MediaElementAudioSourceNode` instances |
| J3 persistence | Level survives tab reload (0.40); toolbar badge shows `40` on that tab |
| J4 mute | Mute button mutes the tab; `aria-pressed=true` reflected |
| J5 paused | A silent tab with a non-default level stays listed |
| J6 restricted | `chrome://version` → set refused (`restricted`); row shows a disabled slider and an explanation |
| **UI long title (new)** | A tab with a ~190-character title ellipsizes; no horizontal overflow, every value visible |
| J7 a11y | Slider/mute have names that include the tab title; `aria-valuetext` is a percentage; ArrowLeft changes the value |
| Lifecycle | Closing a tab removes its stored level; after an **extension update** (uninstall + load of the same unpacked path, same ID) an already-open tab is re-injected and set to 0.25 |
| Security | Page MAIN world has no `chrome.runtime`; an out-of-range level is rejected |
| UI | The reset button appears only when the level is not 100 % |

## 2. Live sites (new) — 45 pass, 0 extension failures
Command: `cd tests && node live-sites.mjs [--only=youtube,spotify,...]` → `quality/evidence/live-results.json`, screenshots `quality/evidence/live-*.png`.
Needs network. Every test tab is muted with `chrome.tabs.update({muted:true})` before it loads, so nothing is heard; Chromium still reports `tab.audible` for muted tabs. Real media volume is read in the extension's isolated world (native getter) in **all frames**, and compared with the volume the page sees in the MAIN world. Cookie walls are answered with "Reject all".

| Site | How it plays | Result |
| --- | --- | --- |
| YouTube watch page | `<video>` (MSE) | 30 % → real 0.30, page still sees 1.0; 0 % → inaudible; 100 % → audible; 40 % survives reload; badge 40; **SPA navigation to another video keeps 40 %** |
| YouTube embed (`youtube-nocookie.com`, cross-origin iframe) | `<video>` in OOPIF | Same as above (no SPA step) |
| Spotify embed (cross-origin iframe, no login) | media not in the DOM | 0 % → inaudible, 100 % → audible, badge after reload |
| SoundCloud widget (cross-origin iframe) | media not in the DOM | 0 % → inaudible, 100 % → audible. Flaky on the site side: in 1 of 4 runs the widget never started (passed on immediate rerun, `live-results-soundcloud-rerun.json`) |
| Online tone generator (szynalski.com) | Web Audio oscillator | 0 % → inaudible, 100 % → audible |
| WebRTC loopback (local, Meet-like) | remote `MediaStream` in `<audio srcObject>` | 30 % → real 0.30; 0 % → real 0; reload keeps 40 %. Chromium does not report `tab.audible` for this loopback, so it is verified by element volume only |
| Vimeo embed | — | **Skipped**: the player stays at `readyState` 0–1 in automated Helium **with and without** the extension (environment, not the mixer) |
| Popup with all 7 live tabs | — | Every tab listed; no horizontal overflow (`live-popup.png`) |

"Skip" for "real volume × 0.30" / "survives reload" on Spotify, SoundCloud and the tone generator means there is no DOM media element to measure; their audio path was verified through the browser's audio monitor instead.

## Defects found and fixed in 1.0.1
1. **Double attenuation for Web Audio-routed media (found by analysis, confirmed by measurement).** Chromium applies `element.volume` before a `MediaElementAudioSourceNode`, and the graph also passes the extension's GainNode, so 50 % gave 25 % and 25 % gave ~6 % on visualizers/EQ players. Fix in `content/volume-main.js`: elements passed to `createMediaElementSource()` or `new MediaElementAudioSourceNode()` keep the page's volume and are scaled only by the GainNode. Regression J2c fails on 1.0.0 (`a=0.5 b=0.5`) and passes on 1.0.1.
2. **Popup layout blow-out with long titles / many tabs (found on live sites).** The list grid column grew to the longest title (up to 551 px in a 360 px popup), cutting off values and showing a horizontal scrollbar; with many tabs the document scrollbar also pushed content sideways. Fix in `popup/popup.css`: `grid-template-columns: minmax(0, 1fr)` and body as the scroll container. Regression "UI long title" fails on 1.0.0 (819 px overflow) and passes on 1.0.1.
3. Test harness: since Chromium ~157 `chrome.runtime.reload()` no longer brings back a CDP-loaded unpacked extension (and the worker keeps its target ID), so the lifecycle test now simulates an update with uninstall + install.

Defects fixed in 1.0.0 (still covered): worker rejected `tvm:set` from the mixer opened in a tab; reset button visible at 100 % (`display` vs `hidden`); disabled slider not dimmed.

## Not run / limitations
* The real toolbar popup can't be opened by automation, so `popup.html` was tested in a tab (viewport 360×520/560).
* Not tested: Google Meet and Spotify web player with a signed-in account (need the user's sign-in; the WebRTC loopback covers Meet's playback path), Vimeo (environment), light theme and Polish UI captures, `file://` pages, Helium's site-access settings.
* Web Audio graphs created **before** an on-demand injection (tab open before install) are not covered by design; the documented fix is reloading the tab.
