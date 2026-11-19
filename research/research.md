# Research brief — Tab Volume Mixer

Date: 2026-11-19 · Role: product-researcher (executed serially by the orchestrator, not an independent agent run)

## Job to be done
A Helium (Chromium 147) user wants to set the loudness of each tab that plays sound
independently, instead of changing the whole browser's volume in the Windows mixer.

## Target user / trigger
Single desktop user with several sound-playing tabs (music + video call + YouTube).
Trigger: click the toolbar icon → see every tab producing sound → drag its slider.

## Feasibility — two known MV3 techniques

| Technique | How | Pros | Cons |
| --- | --- | --- | --- |
| A. `chrome.tabCapture` + offscreen Web Audio gain | Capture the tab's audio stream, play it back through a GainNode | Works for any audio source, allows boost > 100 % | Needs a user gesture **on that tab** (`activeTab`) before capture → cannot adjust a background tab from a list; shows a "sharing" indicator; one capture pipeline per tab (CPU) |
| B. Page-level gain (content script in the page's MAIN world) | Scale every `HTMLMediaElement.volume` and insert a GainNode before every `AudioContext.destination` | Works on every tab from one list without visiting it; no capture indicator; ~zero cost when idle | 0–100 % only (no boost); cannot reach `chrome://` / Web Store pages; Web Audio graphs created **before** a late injection are not caught until reload |

Decision input: the core requirement is "list every audible tab and change each one's level from one place".
Technique A cannot satisfy that for background tabs, so **B is selected**. Tab-level mute (`chrome.tabs.update({muted})`)
complements it and also works on pages where scripts cannot run.

## Acceptance journeys
1. Two tabs play sound → popup lists both with title, site, favicon and a slider at 100 %.
2. Dragging tab A to 30 % immediately lowers only tab A; tab B unchanged.
3. Reloading / navigating tab A keeps 30 % (per-tab level survives within the browser session).
4. Mute button toggles tab mute; state is reflected in the popup.
5. A tab that stops playing but has a non-default level stays in the list (so it can be reset).
6. Restricted pages (`chrome://…`) are listed with mute only and an explanation.
7. Keyboard-only use: Tab/Shift+Tab between controls, arrows change sliders, value announced as a percentage.

## Policy notes
`<all_urls>` host access is required because the user can open sound on any site; it is used only to run the
volume script. No data is read from pages, nothing leaves the device.
