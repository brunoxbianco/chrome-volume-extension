# CLAUDE.md — Tab Volume Mixer

Context for Claude Code (and humans) continuing work on this project on any machine.
The user writes in **Polish**; answer in Polish. Code, comments and commit messages are in English.

## What this is
MV3 browser extension for **Helium** (Chromium-based; also works in Chrome/Edge/Brave, min Chrome 116).
It sets the volume of each tab separately: the popup lists every tab that plays sound, and each tab gets a slider (0–100 %), a mute button, a reset to 100 % and a click-to-go-to-tab action.
Local only: no backend, no network, no accounts.

Status (2026-11-19): **v1.0.0 done**. E2E 29/29 passing in real Helium 147, security review done, Chrome Web Store
materials ready. **Not submitted to the Web Store yet** (needs the user's developer account).

## Layout
| Path | What |
| --- | --- |
| `extension/` | The extension itself (load unpacked / zip this). No build step, plain JS. |
| `extension/background.js` | Service worker: per-tab levels in `chrome.storage.session`, message validation, on-demand injection, badge |
| `extension/content/volume-main.js` | MAIN world, `document_start`, all frames: patches `HTMLMediaElement.prototype.volume` + `AudioNode.prototype.connect/disconnect` (GainNode before `ctx.destination`). Real volume = page volume × tab level |
| `extension/content/bridge.js` | ISOLATED world: gets the level from the worker, forwards it to MAIN via `CustomEvent('tvm-level-v1')` |
| `extension/popup/` | Mixer UI (EN/PL via `_locales`, light/dark, keyboard accessible) |
| `tests/e2e.mjs` | Real-browser E2E (puppeteer-core 25) |
| `tests/store-assets.mjs` | Regenerates the Web Store screenshots and promo tile from the real popup |
| `tests/make_icons.py` | Pure-Python icon generator (no Pillow); the 128 px icon has 16 px padding for the store |
| `research/ architecture/ design/` | Decisions (ADR-001 explains why not `tabCapture`) |
| `quality/` | Test, security and performance reports + evidence screenshots |
| `release/` | ZIP, `store-submission.md` (every Web Store dashboard field, ready to paste), `store-assets/` |
| `PRIVACY.md` | Privacy policy. Its GitHub URL is the policy URL for the Web Store |
| `.extension-builder/project.json` | Stage/evidence tracker of the `chrome-extension-builder` plugin |

## Key decisions (don't silently reverse)
* **Page-level gain instead of `chrome.tabCapture`.** Capture needs a user gesture on each tab, so background tabs couldn't be controlled from one list. Trade-off: no boost above 100 %, and nothing works on `chrome://` pages (mute only there).
* Levels live in `storage.session` (per tab, survive reload, cleared when the tab or browser closes). Nothing is persisted.
* Permissions: `<all_urls>`, `storage`, `scripting`, `favicon`. **No `tabs` permission** (host access already gives titles/URLs). Adding permissions requires updating `release/store-submission.md` + `PRIVACY.md`.
* The worker accepts `tvm:set`/`tvm:levels` only from the extension's own origin (`sender.url`), and `tvm:get` only for the sender's own tab.
* The MAIN-world listener is on `window`, capture phase, registered at document_start, so pages can't swallow it (security finding S1).

## Commands
```powershell
# E2E (opens an off-screen Helium window; fixtures are ~-55 dBFS, practically silent)
cd tests; npm install; node e2e.mjs
# Store screenshots / promo tile
node tests/store-assets.mjs
# Icons
py -3 tests/make_icons.py extension/icons
```
Override the browser path with env `BROWSER` (default: `%LOCALAPPDATA%\imput\Helium\Application\chrome.exe`).

## Gotchas learned the hard way
* **Headless Chromium never reports `tab.audible`**, so the E2E must run headed (the window is placed off-screen). `--mute-audio` also breaks audible detection.
* puppeteer-core 25 needs `pipe: true` + `--enable-unsafe-extension-debugging` to load an unpacked extension (`enableExtensions`).
* The popup can't be opened by automation; tests open `chrome-extension://<id>/popup/popup.html` in a tab, which is why sender validation is origin-based.
* CSS `display:` on an element overrides the `hidden` attribute; there is a global `[hidden]{display:none!important}` rule.
* Windows: `python3`/`python` may be the Microsoft Store alias. Use `py -3`. The plugin CLI (`extension_builder.mjs`) spawns `python3`, so run its Python scripts directly with `py -3 <plugin>/skills/chrome-extension-builder/scripts/<script>.py`.
* Git push: HTTPS credentials on the desktop failed; the remote uses **SSH** (`git@github.com:brunoxbianco/chrome-volume-extension.git`).

## Release workflow
1. Change code → run `node tests/e2e.mjs` (must be all PASS).
2. Bump `version` in `extension/manifest.json`.
3. Zip `extension/` contents (manifest at the zip root) into `release/tab-volume-mixer-<version>.zip`. The plugin's `package_extension.py` does this and validates it.
4. Update `quality/test-report.md`, plus `quality/security-review.md` if permissions or messaging changed.

## Open items / ideas
* Web Store submission (user action): follow `release/store-submission.md`.
* Not yet tested on live sites (YouTube, Spotify, Meet), in cross-origin iframes, or with `file://` pages.
* Possible features: remember levels per site (would need `storage.local` + a privacy update), keyboard shortcuts, optional >100 % boost via `tabCapture` for the active tab only.
