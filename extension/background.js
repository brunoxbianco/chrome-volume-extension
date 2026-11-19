// Service worker: source of truth for per-tab volume levels.
'use strict';

const KEY = 'levels';
const SCRIPTS = [
  { files: ['content/volume-main.js'], world: 'MAIN' },
  { files: ['content/bridge.js'], world: 'ISOLATED' }
];

async function getLevels() {
  const data = await chrome.storage.session.get(KEY);
  return data[KEY] || {};
}

// Serialize writes so quick slider moves on several tabs never lose an update.
let writeChain = Promise.resolve();
function updateLevels(mutator) {
  writeChain = writeChain.then(async () => {
    const levels = await getLevels();
    mutator(levels);
    await chrome.storage.session.set({ [KEY]: levels });
  }).catch((err) => console.warn('[tab-volume] storage', err));
  return writeChain;
}

function isScriptable(url) {
  return typeof url === 'string' && /^(https?|file):/i.test(url) &&
    !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url);
}

async function setBadge(tabId, level) {
  const text = level >= 1 ? '' : level <= 0 ? '0' : String(Math.round(level * 100));
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#4f46e5' });
  } catch { /* tab closed */ }
}

async function pushLevel(tab, level) {
  const msg = { type: 'tvm:apply', level };
  try {
    await chrome.tabs.sendMessage(tab.id, msg);
    return;
  } catch {
    // No receiver: tab was opened before install/update. Inject on demand.
  }
  for (const s of SCRIPTS) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: s.files,
      world: s.world,
      injectImmediately: true
    });
  }
  await chrome.tabs.sendMessage(tab.id, msg);
}

async function handleSet(tabId, level) {
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return { ok: false, error: 'no-tab' }; }
  if (!isScriptable(tab.url)) return { ok: false, error: 'restricted' };
  await updateLevels((levels) => {
    if (level === 1) delete levels[tabId]; else levels[tabId] = level;
  });
  setBadge(tabId, level);
  try {
    await pushLevel(tab, level);
    return { ok: true };
  } catch (err) {
    console.warn('[tab-volume] apply failed', err);
    return { ok: false, error: 'inject-failed' };
  }
}

function isExtensionPage(sender) {
  // Popup (or the popup page opened in a tab). Content scripts always report the web page URL here.
  return sender.id === chrome.runtime.id &&
    typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;

  if (msg.type === 'tvm:get' && sender.tab && Number.isInteger(sender.tab.id)) {
    const tabId = sender.tab.id;
    getLevels().then((levels) => {
      const level = typeof levels[tabId] === 'number' ? levels[tabId] : 1;
      if (sender.frameId === 0) setBadge(tabId, level); // badge is reset on navigation
      sendResponse({ level });
    });
    return true;
  }

  if (!isExtensionPage(sender)) return false;

  if (msg.type === 'tvm:levels') {
    getLevels().then((levels) => sendResponse({ levels }));
    return true;
  }

  if (msg.type === 'tvm:set') {
    const { tabId, level } = msg;
    if (!Number.isInteger(tabId) || typeof level !== 'number' || !(level >= 0 && level <= 1)) {
      sendResponse({ ok: false, error: 'invalid' });
      return false;
    }
    const rounded = Math.round(level * 100) / 100;
    handleSet(tabId, rounded).then(sendResponse);
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateLevels((levels) => { delete levels[tabId]; });
});
