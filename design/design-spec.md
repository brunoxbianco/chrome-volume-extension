# Design spec — popup mixer

Width 360 px, max height ~520 px (scrolls). Follows system light/dark theme. UI language follows the browser (English / Polish).

## Layout
* Header: app name + count of tabs playing sound.
* One card per tab, ordered: currently playing first, then by window/tab order.
  * Row 1: favicon · title (button → switch to that tab) · "now playing" equalizer glyph when audible.
  * Row 2: mute toggle (speaker icon, `aria-pressed`) · range slider 0–100 (step 1, `aria-valuetext="45 %"`) · numeric value · reset-to-100 % button (shown only when ≠ 100 %).
  * Active tab card gets an accent outline.
  * Restricted tab: slider disabled, hint "Only mute is available on this page".
* Empty state: icon + "No tab is playing sound right now" + hint "Start playback and reopen…" (the list also updates live).

## States
Playing · paused-but-adjusted · muted (slider dimmed, still adjustable) · restricted · error toast ("Couldn't change volume on this page").

## Accessibility
Native `<input type=range>` and `<button>`; visible focus ring; contrast ≥ 4.5:1 in both themes; labels include tab title
("Volume: YouTube – …"); keyboard: arrows ±1, PageUp/PageDown ±10, Home/End 0/100; `prefers-reduced-motion` disables the equalizer animation.
