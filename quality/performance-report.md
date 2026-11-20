# Performance — Tab Volume Mixer 1.0.1

Role: performance-engineer (run serially by the orchestrator).

* Injected per frame: `volume-main.js` 4.6 KB + `bridge.js` 0.9 KB, unminified. Neither does work until a level changes. The only exceptions are one `sendMessage` at load and constant-time hooks in `play()`/`connect()`.
* No timers, MutationObservers or polling in pages. Level changes touch only the media elements and AudioContexts that were tracked (held by WeakRefs).
* Web Audio: one extra GainNode per AudioContext. Level changes ramp via `setTargetAtTime` (15 ms), so there are no clicks.
* Service worker: event-driven only. Writes go through one queue to `storage.session`.
* Popup: incremental row updates keyed by tabId, with at most one message per animation frame while dragging.
* Not measured: CPU/memory traces on heavy real sites. The estimates above come from code inspection.
