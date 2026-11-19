// ISOLATED world, all frames, document_start.
// Gets this tab's level from the service worker and forwards changes to the MAIN-world script.
(() => {
  'use strict';
  const EVENT = 'tvm-level-v1';
  const FLAG = '__tabVolumeMixerBridge';
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  const forward = (level) => {
    if (typeof level !== 'number' || !Number.isFinite(level)) return;
    document.dispatchEvent(new CustomEvent(EVENT, { detail: level }));
  };

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || !msg || msg.type !== 'tvm:apply') return;
    forward(msg.level);
  });

  chrome.runtime.sendMessage({ type: 'tvm:get' }).then(
    (res) => { if (res && res.level !== 1) forward(res.level); },
    () => { /* worker unavailable (extension updating); default 100 % */ }
  );
})();
