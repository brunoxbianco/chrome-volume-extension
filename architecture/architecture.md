# Architecture (ADR-001) — Tab Volume Mixer

Status: accepted · Mode: **local only** (no backend, no network, no integrations → backend/integrations nodes not applicable)

## Contexts
| Context | File | Responsibility |
| --- | --- | --- |
| Service worker | `extension/background.js` | Source of truth for per-tab levels (`chrome.storage.session`), validates messages, pushes levels to tabs, injects scripts on demand into tabs opened before install, sets the per-tab badge |
| Content, MAIN world, all frames, `document_start` | `extension/content/volume-main.js` | Patches `HTMLMediaElement.prototype.volume` and `AudioNode.prototype.connect/disconnect` so that real output = page volume × tab level |
| Content, ISOLATED world, all frames, `document_start` | `extension/content/bridge.js` | Asks the worker for the tab's level on load, relays level changes to the MAIN world through a `CustomEvent` on `document` |
| Popup | `extension/popup/*` | Lists tabs that are audible / muted / have a non-default level, sliders + mute + reset + go-to-tab, live updates via `chrome.tabs` events |

## Message contract (all validated in the worker)
| From → to | Message | Response |
| --- | --- | --- |
| bridge → worker | `{type:"tvm:get"}` (sender.tab required) | `{level:number}` 0–1 |
| popup → worker | `{type:"tvm:set", tabId:int, level:number 0–1}` (sender must be an extension page, not a tab) | `{ok:true}` or `{ok:false, error:"restricted"\|"no-tab"}` |
| popup → worker | `{type:"tvm:levels"}` | `{levels:{[tabId]:number}}` |
| worker → bridge | `{type:"tvm:apply", level:number}` | — |
| bridge → MAIN | `CustomEvent("tvm-level-<build>", {detail:number})` | — |

Page scripts can dispatch the same DOM event; the only effect is changing that page's own volume, which the page can do anyway → acceptable trust boundary. Nothing flows from MAIN back to the extension.

## Storage
`chrome.storage.session` key `levels` → `{ "<tabId>": number }`. Cleared on browser restart; entries deleted on `tabs.onRemoved`. No persistent or synced data.

## Permissions
| Permission | Why |
| --- | --- |
| `host_permissions: <all_urls>` | Run the volume script on any site the user plays audio on; read tab title/URL for the list |
| `storage` | Session-scoped per-tab levels |
| `scripting` | Inject into tabs that were already open when the extension was installed/updated |
| `favicon` | Show tab favicons from the browser's cache (`_favicon/`) without fetching remote URLs |

No `tabs` permission (host access already exposes title/URL), no `tabCapture`, no remote code, default MV3 CSP.

## Known limitations
* Level range 0–100 % (no boost).
* `chrome://`, extension and Web Store pages: mute only.
* After late injection, Web Audio graphs connected before injection keep full volume until the tab reloads (media elements are handled immediately).
