# Chrome Web Store submission sheet — Tab Volume Mixer 1.0.1

Requirements were checked against the official pages on **2026-11-19**: Images, Listing, Privacy practices, User Data FAQ, Program Policies and Review process.
Status: **ready to upload, not submitted.** Submission requires your developer account (one-time registration fee, identity/2-step verification) and is done by you in the Developer Dashboard.

## Compliance checklist
| Requirement (source) | Status |
| --- | --- |
| MV3, no remotely hosted code (Privacy practices) | ✅ all code packaged; declare **"No, I am not using remote code"** |
| Single, narrow purpose (Policies) | ✅ per-tab volume control only |
| Narrowest permissions (Policies) | ✅ 4 permissions, each used (justifications below). `<all_urls>` is required, so expect a longer review |
| No obfuscation (Policies) | ✅ readable, unminified source |
| Store icon 128×128 PNG, 96×96 artwork + 16 px transparent padding (Images) | ✅ `extension/icons/icon128.png` |
| ≥1 screenshot, 1280×800 or 640×400, square corners, no padding (Images) | ✅ `release/store-assets/screenshot-en.png`, `screenshot-pl.png` (1280×800, made from the real extension UI) |
| Small promo tile 440×280 (optional, but improves placement) | ✅ `release/store-assets/promo-small-440x280.png` |
| Marquee 1400×560 (optional) | — not prepared |
| Description starts with what the item does, no keyword spam (Listing / Policies) | ✅ text below |
| Privacy policy URL, consistent with disclosures (Privacy practices, User Data FAQ #14: needed even for local-only data) | ✅ `PRIVACY.md` → use the GitHub URL below |
| Disclose handling of "web browsing activity" even if processed only locally (User Data FAQ #2/#3) | ✅ tick **Web history** (tab URLs/titles shown in the UI, never transmitted) |
| Limited Use certification (Policies) | ✅ no transfer, sale, ads or credit use |
| No "Chrome" trademark in the name, no impersonation (Policies) | ✅ "Tab Volume Mixer" |
| Manifest name ≤ 75, description ≤ 132 chars | ✅ EN 16/87, PL 21/103 |
| Package ZIP with manifest at root | ✅ `release/tab-volume-mixer-1.0.1.zip` |

## Store listing tab
* **Name:** Tab Volume Mixer (comes from the manifest; Polish UI: "Mikser głośności kart")
* **Category:** Tools
* **Language:** English (add Polish as a localized listing)
* **Homepage / support URL:** https://github.com/brunoxbianco/chrome-volume-extension (issues for support)
* **Detailed description (EN):**

  > Tab Volume Mixer gives every browser tab its own volume slider.
  >
  > Click the toolbar icon to see all tabs that are playing sound. Drag a tab's slider (0–100 %) to make it quieter, mute it, or jump to it. Other tabs keep playing at their own level, so you no longer have to change the volume of the whole browser in your system mixer.
  >
  > • Lists every tab that plays sound, live
  > • Per-tab slider, mute button and one-click reset to 100 %
  > • Works with video and music players, and with web-audio pages
  > • The level stays when the tab reloads; the toolbar badge shows the level of the current tab
  > • Keyboard accessible, light and dark theme, English and Polish
  >
  > Privacy: no data leaves your device. No accounts, analytics or network requests.
  >
  > Note: browsers don't allow extensions on internal pages (such as settings or the extension store), so only mute is available there.

* **Detailed description (PL):**

  > Mikser głośności kart daje każdej karcie przeglądarki osobny suwak głośności.
  >
  > Kliknij ikonę na pasku, żeby zobaczyć wszystkie karty odtwarzające dźwięk. Przesuń suwak karty (0–100%), żeby ją ściszyć, wycisz ją albo przejdź do niej jednym kliknięciem. Pozostałe karty grają dalej na swoim poziomie, bez zmieniania głośności całej przeglądarki w mikserze systemu.
  >
  > • Lista kart z dźwiękiem aktualizowana na żywo
  > • Suwak, wyciszenie i powrót do 100% dla każdej karty
  > • Działa z odtwarzaczami wideo i muzyki oraz stronami Web Audio
  > • Poziom zostaje po przeładowaniu karty, a ikona na pasku pokazuje poziom bieżącej karty
  > • Obsługa klawiatury, jasny i ciemny motyw, polski i angielski
  >
  > Prywatność: żadne dane nie opuszczają urządzenia.

## Privacy practices tab
* **Single purpose:** Lets the user set the audio volume of each browser tab individually (slider and mute per tab).
* **Permission justifications:**
  * `host permission <all_urls>`: The volume-scaling script must run on whatever site the user plays audio on, starting before the page's audio begins. It only scales audio output and does not read page content.
  * `storage`: Keeps the user's chosen volume level for each open tab in session storage, so it survives reloads; cleared when the tab closes.
  * `scripting`: Applies the volume control to tabs that were already open when the extension was installed or updated.
  * `favicon`: Shows each tab's icon in the mixer list from the browser's local favicon cache.
* **Remote code:** No, I am not using remote code.
* **Data usage, collected data types:** tick **Web history** only. Reason: tab titles and URLs are read to display the list of tabs that play sound; processed locally and never transmitted. Everything else is unticked.
* **Certifications (tick all three):** not sold to third parties; not used for unrelated purposes; not used for creditworthiness or lending.
* **Privacy policy URL:** https://github.com/brunoxbianco/chrome-volume-extension/blob/main/PRIVACY.md

## Distribution
Public or unlisted, all regions, free. Expect a longer first review: new developer, new item and `<all_urls>`. Reviews usually take a few days but can take up to a few weeks.

## Not done (needs you)
Developer account registration and payment, account verification, upload, filling the dashboard fields above, and submitting for review. Store acceptance is **not** established by any local check.
