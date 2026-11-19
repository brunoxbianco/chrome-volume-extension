# Security & privacy review — Tab Volume Mixer 1.0.0

Date: 2026-11-19 (second, full pass) · Role: security-reviewer, run **serially by the orchestrator**: no independent reviewer agent ran this pass.
Scope: every file in `extension/`, the test tooling in `tests/` and the release ZIP.

## Threat model
| Boundary | Who is untrusted | What they could try |
| --- | --- | --- |
| Web page → MAIN-world script | Any website (incl. ads/iframes) | Spoof or swallow level events; tamper with prototypes; fingerprint the extension |
| Content script → service worker | A compromised renderer | Read or change other tabs' levels; inject into arbitrary tabs |
| Other extensions / websites → worker | External senders | `runtime.sendMessage(extId)` / `connect` |
| Build/package | Dependencies | Shipped third-party or remote code |

## Findings
| # | Sev. | Area | Finding | Status / evidence |
| --- | --- | --- | --- | --- |
| S1 | Low | Page → MAIN bridge | Level updates travelled as a DOM `CustomEvent` on `document`. A page listener registered on `window` in capture phase could call `stopImmediatePropagation()` and block the user's volume change for that page. | **Fixed**: the listener is now registered on `window`, capture phase, at `document_start` before any page script, so it always runs first. Regression: the E2E media fixture now installs such a hostile listener; J2/J3 still pass. |
| S2 | Info | Page → MAIN bridge | A page can dispatch the event itself. The effect is limited to its **own** output volume, which a page can always change, and the value is clamped to 0–1 with non-finite values ignored. | Accepted |
| S3 | Low | Privacy / fingerprinting | Pages can detect the extension: patched `HTMLMediaElement.prototype.volume` / `AudioNode.prototype.connect` have non-native `toString()`, and pages can observe the level event. This reveals only that a volume mixer is installed and the level for that page. | Accepted, disclosed in PRIVACY.md and the listing |
| S4 | Info | Worker message validation | Messages are accepted only when `sender.id` is our extension ID. `tvm:get` answers only for the sender's own tab. `tvm:set` / `tvm:levels` require the sender URL to be our own extension origin, so content scripts are rejected even if a renderer is compromised. `tabId` must be an integer and `level` a finite number in 0–1. Restricted URLs are refused. | Verified (E2E: invalid level rejected; restricted page refused) |
| S5 | Info | External messaging | No `externally_connectable`, no `onMessageExternal` / `onConnectExternal` listeners, no `web_accessible_resources`, so websites and other extensions cannot reach the worker. | Verified by manifest/code review |
| S6 | Info | Injection | `executeScript` only targets tabs whose URL is http(s)/file and is not the Web Store, and only injects the extension's own packaged files. No strings or functions from messages are executed. | Verified |
| S7 | Info | Code execution / CSP | No `eval`, `new Function`, `innerHTML`, `document.write`, remote scripts, `fetch` or XHR. Default MV3 CSP. All UI text goes through `textContent` / attributes. Favicons come from the local `_favicon` cache, not remote URLs. | Verified by grep and review |
| S8 | Info | Storage | `chrome.storage.session` (in memory, default access level is trusted contexts only, so content scripts cannot read it) holds only `{tabId: level}`. Entries are deleted on tab close. No `local`/`sync` storage, no cookies. | Verified (E2E lifecycle) |
| S9 | Info | Permissions | `<all_urls>` hosts, `storage`, `scripting`, `favicon`. No `tabs`, `tabCapture`, `webRequest`, `cookies`, `history`. Each permission is used and justified (see release/store-submission.md). | Accepted (broad host is required for the core feature) |
| S10 | Info | Supply chain | The shipped ZIP has **zero third-party code**. The test-only devDependency `puppeteer-core` was upgraded 24 → 25.18.1 because `npm audit` reported 9 high advisories via `chromium-bidi → zod`. It now reports **0 vulnerabilities**. `node_modules` is git-ignored and never packaged. | Fixed |
| S11 | Info | Robustness | Patches keep native behaviour: the volume setter still throws on invalid input, `connect()` returns the original destination, OfflineAudioContext is untouched, and errors inside `play()` hook are swallowed so playback never breaks. | Verified (E2E) |

**Result: no critical/high/medium findings open.** No covert collection, secrets, remote code, unsafe privilege boundary or deceptive UI.

## Residual risks
* Broad host permission ⇒ longer Web Store review ("may take longer" for `<all_urls>`, per the review-process page).
* Pages that deliberately tamper with prototypes before an **on-demand** injection (tab opened before install) can prevent the mixer from working **on themselves** only.
