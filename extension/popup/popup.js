'use strict';

const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const toastEl = document.getElementById('toast');
const tpl = document.getElementById('rowTpl');

const rows = new Map(); // tabId -> { li, refs, dragging }
let levels = {};
let activeTabId = null;
let toastTimer = 0;

document.documentElement.lang = chrome.i18n.getUILanguage();
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
document.title = t('extName');

const isScriptable = (url) => typeof url === 'string' && /^(https?|file):/i.test(url) &&
  !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url);

function hostOf(url) {
  try { return new URL(url).hostname || url; } catch { return ''; }
}

function faviconUrl(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl || 'about:blank');
  u.searchParams.set('size', '32');
  return u.toString();
}

function levelOf(tabId) {
  return typeof levels[tabId] === 'number' ? levels[tabId] : 1;
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
}

// Throttle per tab: send at most one update per animation frame, always send the last value.
const pending = new Map();
function sendLevel(tabId, pct) {
  const first = !pending.has(tabId);
  pending.set(tabId, pct);
  if (!first) return;
  requestAnimationFrame(async () => {
    const value = pending.get(tabId);
    pending.delete(tabId);
    const level = value / 100;
    if (level === 1) delete levels[tabId]; else levels[tabId] = level;
    const res = await chrome.runtime.sendMessage({ type: 'tvm:set', tabId, level }).catch(() => null);
    if (!res || !res.ok) {
      showToast(res && res.error === 'restricted' ? t('restrictedHint') : t('applyFailed'));
    }
  });
}

function paintSlider(refs, pct, title) {
  refs.slider.value = String(pct);
  refs.slider.style.setProperty('--pct', pct + '%');
  refs.slider.setAttribute('aria-valuetext', pct + '%');
  refs.value.textContent = pct + '%';
  refs.reset.hidden = pct === 100;
  refs.reset.setAttribute('aria-label', t('resetLabel', [title]));
  refs.reset.title = t('resetLabel', [title]);
}

function createRow(tab) {
  const li = tpl.content.firstElementChild.cloneNode(true);
  const refs = {
    favicon: li.querySelector('.favicon'),
    title: li.querySelector('.title'),
    mute: li.querySelector('.mute'),
    slider: li.querySelector('.slider'),
    value: li.querySelector('.value'),
    reset: li.querySelector('.reset'),
    hint: li.querySelector('.hint')
  };
  const row = { li, refs, dragging: false, title: '' };
  const tabId = tab.id;

  refs.title.addEventListener('click', async () => {
    try {
      const current = await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(current.windowId, { focused: true });
    } catch { /* tab gone */ }
  });

  refs.mute.addEventListener('click', async () => {
    const muted = refs.mute.getAttribute('aria-pressed') !== 'true';
    try { await chrome.tabs.update(tabId, { muted }); } catch { showToast(t('applyFailed')); }
  });

  refs.slider.addEventListener('pointerdown', () => { row.dragging = true; });
  refs.slider.addEventListener('change', () => { row.dragging = false; });
  refs.slider.addEventListener('input', () => {
    const pct = Number(refs.slider.value);
    paintSlider(refs, pct, row.title);
    sendLevel(tabId, pct);
  });

  refs.reset.addEventListener('click', () => {
    paintSlider(refs, 100, row.title);
    sendLevel(tabId, 100);
    refs.slider.focus();
  });

  rows.set(tabId, row);
  return row;
}

function updateRow(row, tab) {
  const { li, refs } = row;
  const scriptable = isScriptable(tab.url);
  const title = tab.title || hostOf(tab.url) || t('systemPage');
  const muted = !!(tab.mutedInfo && tab.mutedInfo.muted);
  row.title = title;

  li.classList.toggle('active', tab.id === activeTabId);
  li.classList.toggle('playing', !!tab.audible);
  li.classList.toggle('idle', !tab.audible);
  li.classList.toggle('muted', muted);
  li.classList.toggle('restricted', !scriptable);

  const favSrc = faviconUrl(tab.url);
  if (refs.favicon.getAttribute('src') !== favSrc) refs.favicon.src = favSrc;
  refs.title.textContent = title;
  refs.title.title = `${title}\n${hostOf(tab.url)}`;
  refs.title.setAttribute('aria-label', t('goToTab', [title]));

  refs.mute.setAttribute('aria-pressed', String(muted));
  const muteLabel = muted ? t('unmuteLabel', [title]) : t('muteLabel', [title]);
  refs.mute.setAttribute('aria-label', muteLabel);
  refs.mute.title = muteLabel;

  refs.slider.disabled = !scriptable;
  refs.slider.setAttribute('aria-label', t('volumeLabel', [title]));
  if (!row.dragging && !pending.has(tab.id)) paintSlider(refs, Math.round(levelOf(tab.id) * 100), title);
  else refs.reset.setAttribute('aria-label', t('resetLabel', [title]));

  refs.hint.hidden = scriptable;
  if (!scriptable) refs.hint.textContent = t('restrictedHint');
}

async function render() {
  const tabs = await chrome.tabs.query({});
  // A row that appeared while the popup is open stays until its tab closes (pausing must not make it jump away).
  const shown = tabs.filter((tab) =>
    tab.audible || (tab.mutedInfo && tab.mutedInfo.muted) || levelOf(tab.id) !== 1 || rows.has(tab.id)
  );
  // Order: playing first, then by window / tab index (query order).
  shown.sort((a, b) => Number(!!b.audible) - Number(!!a.audible));

  const keep = new Set(shown.map((tab) => tab.id));
  for (const [id, row] of rows) {
    if (!keep.has(id)) {
      row.li.remove();
      rows.delete(id);
    }
  }
  shown.forEach((tab, index) => {
    const row = rows.get(tab.id) || createRow(tab);
    updateRow(row, tab);
    if (listEl.children[index] !== row.li) listEl.insertBefore(row.li, listEl.children[index] || null);
  });

  const playing = shown.filter((tab) => tab.audible).length;
  countEl.textContent = playing ? t('playingCount', [String(playing)]) : '';
  emptyEl.hidden = shown.length > 0;
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => { renderQueued = false; render().catch(console.error); }, 50);
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if ('audible' in info || 'mutedInfo' in info || 'title' in info || 'url' in info || 'favIconUrl' in info) scheduleRender();
});
chrome.tabs.onRemoved.addListener(scheduleRender);
chrome.tabs.onActivated.addListener(({ tabId }) => { activeTabId = tabId; scheduleRender(); });

(async () => {
  const [res, [active]] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'tvm:levels' }).catch(() => null),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]);
  levels = (res && res.levels) || {};
  activeTabId = active ? active.id : null;
  await render();
  const first = listEl.querySelector('.slider:not(:disabled)');
  if (first) first.focus();
})();
