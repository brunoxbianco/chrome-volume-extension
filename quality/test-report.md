# Test report — Tab Volume Mixer 1.0.0

Date: 2026-11-19 (re-run after the security pass, puppeteer-core 25.18.1) · Role: qa-engineer (run serially by the orchestrator; not an independent agent)

## Exact artifact & browser
* Build: `extension/` (the same files zipped into `release/tab-volume-mixer-1.0.0.zip`)
* Browser: **Helium, Chrome/147.0.7727.137** (local install), fresh temporary profile, extension loaded unpacked via CDP `Extensions.loadUnpacked`
* Mode: headed window placed off-screen. Headless mode was tried first: Chromium never reports `tab.audible` there, so headless cannot verify the core journey.
* Fixtures include a hostile page listener that tries to swallow the level event (security S1 regression).
* Fixtures: local `127.0.0.1` server; a 440 Hz `<audio>` loop and a 330 Hz Web Audio oscillator, both at ≈ −55 dBFS (above Chromium's audible threshold, barely perceptible).
* Command: `cd tests && npm install && node e2e.mjs` → `quality/evidence/e2e-results.json`

## Result: 29/29 pass
| Journey | Observed |
| --- | --- |
| J1 list | Popup lists both audible tabs, hides the silent one |
| J2 per-tab level | Media element real volume 0.30 at 30 %; the page still reads its own `volume` (1.0 → 0.5 gives real 0.15) |
| J2 silence | Media tab at 0 % → browser audio monitor reports **not audible**; the other tab stays audible |
| J2 Web Audio | Web Audio tab at 0 % → not audible; back at 100 % → audible (GainNode path) |
| J3 persistence | Level survives tab reload (0.40); toolbar badge shows `40` on that tab |
| J4 mute | Mute button mutes the tab; `aria-pressed=true` reflected |
| J5 paused | A silent tab with a non-default level stays listed |
| J6 restricted | `chrome://version` → set refused (`restricted`); row shows a disabled slider and an explanation |
| J7 a11y | Slider/mute have names that include the tab title; `aria-valuetext` is a percentage; ArrowLeft changes the value |
| Lifecycle | Closing a tab removes its stored level; after an **extension reload** an already-open tab is re-injected and set to 0.25 |
| Security | Page MAIN world has no `chrome.runtime`; an out-of-range level is rejected |
| UI | The reset button appears only when the level is not 100 % |

Screenshots (actual extension, dark theme, 360×520): `quality/evidence/popup-two-tabs.png`, `popup-adjusted.png`, `popup-restricted.png`, `popup-final.png`.

## Defects found and fixed during verification
1. The worker rejected `tvm:set` when the mixer page ran in a tab (`sender.tab` present). Validation now checks the extension origin of `sender.url`.
2. The reset button was visible at 100 %: CSS `display:grid` overrode the `hidden` attribute. Fixed with a `[hidden]` rule, and a regression assertion was added.
3. The disabled slider on restricted pages wasn't dimmed: a muted-row rule was overriding it.

## Not run / limitations
* The real toolbar popup can't be opened by automation, so the same `popup.html` was tested in a tab. The flows are the same, apart from popup sizing.
* Not tested: light theme and Polish UI captures; live sites (YouTube, Spotify, Meet); cross-origin iframes; `file://` pages; Helium's own settings for extension site access.
* Web Audio graphs created **before** an on-demand injection (tab open before install) are not covered by design; the documented fix is reloading the tab.
