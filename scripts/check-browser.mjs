// Production UI checks. Fake only the window.CleanFrameAndroid bridge; never contact a TV.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { openPreview, root } from './browser.mjs';

const KEY = 'cleanframe.home.v1';
const EXTRA = 'tv.family.player', KODI = 'org.xbmc.kodi', VLC = 'org.videolan.vlc', PLEX = 'com.plexapp.android';
const SWITCH = 'input.hw5', PC = 'input.hw6';
const UNSAFE_NAME = 'Family <img src=x onerror="window.__catalogXss=1"> & TV';
// appsJson() rows as the Android shell sends them: apps, then HDMI inputs.
const CATALOG = [
  { appId: EXTRA, name: UNSAFE_NAME, kind: 'app', icon: '' },
  { appId: 'org.jellyfin.androidtv', name: 'Jellyfin', kind: 'app', icon: '' },
  { appId: KODI, name: 'Kodi', kind: 'app', icon: '' },
  { appId: 'com.netflix.ninja', name: 'Netflix', kind: 'app', icon: '' },
  { appId: PLEX, name: 'Plex', kind: 'app', icon: '' },
  { appId: 'com.amazon.amazonvideo.livingroom', name: 'Prime Video', kind: 'app', icon: '' },
  { appId: 'org.smarttube.stable', name: 'SmartTube', kind: 'app', icon: '' },
  { appId: VLC, name: 'VLC', kind: 'app', icon: '' },
  { appId: SWITCH, name: 'Nintendo Switch', kind: 'input', icon: '' },
  { appId: PC, name: 'PC', kind: 'input', icon: '' }
];
// Brands found in CATALOG, in device.js brand order: the default Home. SmartTube stands for YouTube.
const PRIMARY = ['primevideo', 'youtube', 'netflix', 'jellyfin', 'nintendoswitch'];
const PACKAGE = { primevideo: 'com.amazon.amazonvideo.livingroom', youtube: 'org.smarttube.stable', netflix: 'com.netflix.ninja', jellyfin: 'org.jellyfin.androidtv', nintendoswitch: SWITCH };
// A full nine-entry Home: the brands, unbranded apps and the PC input. EXTRA stays off Home.
const HOME = PRIMARY.concat([KODI, VLC, PLEX, PC]);
const NAME = Object.fromEntries(CATALOG.map(a => [a.appId, a.name]));
// photosJson() rows as the shell sends them (newest first). The fake serves each one from a bundled photo.
const BING = [
  { id: 'bing-20261020', file: 'bing-20261020', base: '/photos/', name: 'Lago di Bled', caption: 'Lago di Bled, Slovenia (© QA Photographer)', tone: 'dark', ut: { tr: 'mist', br: 'light' }, frostVeil: 0.12, listColumn: 0, dockQuiet: false, clockMist: true },
  { id: 'bing-20261019', file: 'bing-20261019', base: '/photos/', name: 'Dolomiti', caption: 'Dolomiti, Italia (© QA Photographer)', tone: 'light', ut: { tr: 'light', br: 'mist' }, frostVeil: 0.12, listColumn: 0, dockQuiet: false, clockMist: false }
];
const BING_FILES = { 'bing-20261020': 'summit', 'bing-20261019': 'cove' };
const walls = JSON.parse(readFileSync(root + 'app/assets/wallpapers/SOURCES.json', 'utf8'));
const out = root + '.local/qa/';
mkdirSync(out, { recursive: true });
const sourceFiles = ['app/main.js', 'app/device.js', 'app/index.html', 'app/style.css', 'app/assets/wallpapers/SOURCES.json', 'app/assets/wallpapers/catalog.js', 'app/assets/adaptive-ink.js', 'app/assets/icons/metrics.js'];
const hashes = () => Object.fromEntries(sourceFiles.map(f => [f, createHash('sha256').update(readFileSync(root + f)).digest('hex')]));
const report = { scope: 'Production UI in Chromium; fake window.CleanFrameAndroid bridge only; no TV contacted.', sourceBefore: hashes(), checks: [], failures: [], pageErrors: [], expectedNetworkFailures: [] };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const records = ids => ids.filter(id => !PRIMARY.includes(id)).map(id => ({ id, appId: id, name: NAME[id], brand: '', icon: '' }));
const baseline = (patch = {}) => ({ dock: HOME.slice(), wallpaper: walls[0].id, mode: 'fixed', lastApp: 'netflix', theme: 'shore', appRecords: records(HOME), ...patch });
let preview, current, section = '';

function check(name, pass, detail) {
  const result = { section, name, passed: !!pass, ...(pass ? {} : { detail }) };
  report.checks.push(result);
  if (!pass) { report.failures.push(result); throw Error(name + (detail ? ': ' + JSON.stringify(detail).slice(0, 500) : '')); }
}
async function run(name, fn) {
  if (process.env.CHECK_SECTION && !name.toLowerCase().includes(process.env.CHECK_SECTION.toLowerCase())) return;
  section = name;
  try { await fn(); console.log(name + ': passed'); }
  catch (error) { if (!report.failures.some(f => f.section === name)) report.failures.push({ section: name, error: error.stack }); console.error(name + ': ' + error.message); }
  finally { await closePage(); }
}
async function closePage() { if (current) { current.__closing = true; await current.close(); current = null; } }

// Production still calls its unmodified device.js adapter; only the Android bridge object is fake.
function installHarness({ seed, legacy, mock, catalog, photos, config, is24, minuteMs, noFontAPI, storageFailure, buttons }) {
  if (!sessionStorage.getItem('__cleanframe_seeded')) {
    if (seed !== undefined) localStorage.setItem('cleanframe.home.v1', typeof seed === 'string' ? seed : JSON.stringify(seed));
    if (legacy !== undefined) localStorage.setItem('cleanframe.shore.v1', typeof legacy === 'string' ? legacy : JSON.stringify(legacy));
    sessionStorage.setItem('__cleanframe_seeded', '1');
  }
  window.ShoreQA = { minuteMs };
  window.__failWrites = !!storageFailure;
  window.__storageAttempts = 0;
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === 'cleanframe.home.v1') window.__storageAttempts++;
    if (window.__failWrites && key === 'cleanframe.home.v1') throw new DOMException('QA storage failure', 'QuotaExceededError');
    return set.call(this, key, value);
  };
  window.__setHidden = value => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  if (noFontAPI) Object.defineProperty(document, 'fonts', { configurable: true, value: undefined });
  if (!mock) return;
  // Synchronous like the real @JavascriptInterface methods. Actions are recorded in calls; reads are counted.
  // __cleanframe_catalog_down survives reloads, to fail the catalogue from the very first read.
  const tv = window.__tv = { catalog, photos, is24, buttons: buttons || { enabled: true, list: [{ code: 192, name: 'Button 5', target: 'org.smarttube.stable' }] }, catalogFailure: !!sessionStorage.getItem('__cleanframe_catalog_down'), launchFailure: false, calls: [], reads: { apps: 0, photos: 0, config: 0, is24: 0 } };
  window.CleanFrameAndroid = {
    // A Java exception in a bridge method reaches the page as a thrown Error.
    appsJson() { tv.reads.apps++; if (tv.catalogFailure) throw new Error('Java exception was raised during method invocation'); return JSON.stringify(tv.catalog); },
    launch(appId) { tv.calls.push(['launch', appId]); return tv.launchFailure ? 'App unavailable for QA' : ''; },
    closeApp(appId) { tv.calls.push(['closeApp', appId]); return appId.indexOf('input.') === 0 ? 'Inputs can’t be closed.' : ''; },
    openSettings() { tv.calls.push(['openSettings']); return tv.launchFailure ? 'Settings unavailable for QA' : ''; },
    openPreviousLauncher() { tv.calls.push(['openPreviousLauncher']); return tv.launchFailure ? 'Previous launcher unavailable for QA' : ''; },
    is24Hour() { tv.reads.is24++; return tv.is24; },
    photosJson() { tv.reads.photos++; return JSON.stringify(tv.photos); },
    refreshPhotos() { tv.calls.push(['refreshPhotos']); },
    // Remote buttons: the real service hands the learned key to the page as cleanframe:button-learned.
    buttonsJson() { return JSON.stringify({ enabled: tv.buttons.enabled, buttons: tv.buttons.list }); },
    learnButton() { tv.calls.push(['learnButton']); return tv.buttons.enabled ? '' : 'Turn on CleanFrame TV remote buttons in Accessibility settings first.'; },
    cancelLearnButton() { tv.calls.push(['cancelLearnButton']); },
    setButton(code, target) {
      tv.calls.push(['setButton', code, target]);
      tv.buttons.list = tv.buttons.list.filter(b => b.code !== code);
      if (target) tv.buttons.list = tv.buttons.list.concat([{ code, name: 'Button ' + (code - 187), target }]).sort((a, b) => a.code - b.code);
      return '';
    },
    openAccessibilitySettings() { tv.calls.push(['openAccessibilitySettings']); return ''; },
    // The shell hands an ADB configuration over once; it survives page reloads, so remember that it was taken.
    takeConfig() {
      tv.reads.config++;
      if (sessionStorage.getItem('__cleanframe_config_taken')) return '';
      sessionStorage.setItem('__cleanframe_config_taken', '1');
      return config || '';
    }
  };
}
// Bing photos live under /photos/ on the TV; serve each one from the bundled photo it stands for.
async function servePhoto(route) {
  const match = new URL(route.request().url()).pathname.match(/^\/photos\/(wallpapers|materials)\/(bing-\d{8})(-[a-z-]+)?\.jpg$/);
  const file = match && BING_FILES[match[2]];
  if (!file) return route.fulfill({ status: 404, body: 'Not found' });
  return route.fulfill({ path: root + 'app/assets/' + match[1] + '/' + file + (match[3] || '') + '.jpg' });
}
async function page(options = {}) {
  const { timezoneId, systemTime, ...harness } = options;
  current = await preview.browser.newPage({ viewport: { width: 1920, height: 1080 }, ...(timezoneId ? { timezoneId } : {}) });
  const owner = current;
  current.setDefaultTimeout(10000);
  const expected = [];
  current.__expectedFailures = expected;
  current.on('pageerror', error => report.pageErrors.push({ section, error: error.message }));
  current.on('response', response => { if (response.status() >= 400 && !expected.some(s => response.url().includes(s))) report.pageErrors.push({ section, status: response.status(), url: response.url() }); });
  current.on('requestfailed', request => {
    if (owner.__closing) return;
    const failure = { section, url: request.url(), error: request.failure()?.errorText };
    if (expected.some(s => request.url().includes(s))) report.expectedNetworkFailures.push(failure);
    else if (failure.error !== 'net::ERR_ABORTED') report.pageErrors.push(failure);
  });
  await current.route('**/photos/**', servePhoto);
  if (systemTime) await current.clock.setSystemTime(new Date(systemTime));
  await current.addInitScript(installHarness, { mock: true, catalog: CATALOG, photos: BING, config: '', is24: true, minuteMs: 60000, seed: baseline(), ...harness });
  await current.goto(preview.baseURL + '/home/');
  await ready();
  await current.waitForLoadState('networkidle');
  return current;
}
const state = () => current.evaluate(() => ShoreQA.state());
const stored = () => current.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
const call = (method, ...args) => current.evaluate(([m, a]) => ShoreQA[m](...a), [method, args]);
const ready = () => current.waitForFunction(() => window.ShoreQA && typeof ShoreQA.ready === 'function' && ShoreQA.ready(), null, { timeout: 15000 });
const nav = (...keys) => call('nav', keys);
const calls = () => current.evaluate(() => window.__tv.calls);
const lastCall = async () => (await calls()).at(-1);
async function act(action) { const result = await call('activate', action); if (result === null || result === false) throw Error('Action unavailable: ' + action); return result; }
async function scene(name) { await call('scene', name); await current.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); }
async function look(patch) { await call('look', patch); await ready(); }
async function group(name) {
  await scene('settings'); await act('settings.group.' + name);
  await current.waitForFunction(expected => ShoreQA.state().settingsGroup === expected, name);
}
const settingsSnapshot = () => current.evaluate(() => {
  const s = ShoreQA.state();
  const rendered = [...document.getElementById('stage').classList].filter(c => /^(bg|l|a|u|f|m|font)-/.test(c)).sort();
  return { stored: localStorage.getItem('cleanframe.home.v1'), committed: s.committed, shown: s.shown, rendered, writes: s.writes, storageAttempts: window.__storageAttempts };
});
const choice = (axis, value) => act('choice.' + axis + '.' + value);
const radios = () => current.evaluate(() => [...document.querySelectorAll('#stage [role="radio"]')].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map(e => ({ action: e.getAttribute('data-action'), checked: e.getAttribute('aria-checked'), disabled: e.getAttribute('aria-disabled') === 'true', focused: e.classList.contains('is-focus'), text: e.textContent.trim() })));
async function focusedChoice() {
  const action = (await state()).focusAction;
  return (await radios()).find(r => r.action === action);
}
async function unselectedChoice() {
  for (const direction of ['right', 'right', 'down', 'left', 'left', 'down', 'right', 'right', 'down']) {
    await nav(direction);
    const radio = await focusedChoice();
    if (radio && radio.checked === 'false' && !radio.disabled) return radio;
  }
  throw Error('Remote could not reach an unselected choice');
}
async function walkEnabledChoices() {
  const visited = [];
  for (const direction of ['down', 'down', 'right', 'right', 'up', 'left', 'left', 'down', 'down', 'up', 'up']) {
    await nav(direction);
    const focus = await current.evaluate(() => {
      const action = ShoreQA.state().focusAction;
      const el = [...document.querySelectorAll('#stage [data-action]')].find(e => e.getAttribute('data-action') === action && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
      return { action, exists: !!el, disabled: el?.getAttribute('aria-disabled') === 'true', count: ShoreQA.where().focusCount };
    });
    visited.push(focus.action);
    if (!focus.exists || focus.disabled || focus.count !== 1) throw Error('Remote ' + direction + ' focused an unavailable choice: ' + JSON.stringify(focus));
  }
  return visited;
}
async function wallpaper() {
  await group('background'); await act('background.wallpaper');
  await current.waitForFunction(() => ShoreQA.state().view === 'wallpaper' && ShoreQA.state().settingsGroup === 'wallpaper');
}
const wallpaperSettled = id => current.waitForFunction(expected => !ShoreQA.state().pending && ShoreQA.state().shown.wall === expected, id);
const wallpaperRowVisible = id => current.waitForFunction(expected => {
  const list = document.querySelector('.wallpaper-list'), row = document.querySelector('[data-action="wallpaper.choose.' + expected + '"]');
  if (!list || !row || getComputedStyle(row).visibility === 'hidden') return false;
  const bounds = list.getBoundingClientRect(), r = row.getBoundingClientRect();
  return r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1;
}, id);
const wallpaperSaved = () => current.evaluate(() => {
  const s = ShoreQA.state(), bg = document.getElementById('sheetBg'), veil = document.querySelector('.sheet-veil');
  const bgStyle = getComputedStyle(bg), veilStyle = getComputedStyle(veil);
  return { stored: localStorage.getItem('cleanframe.home.v1'), committed: s.committed, writes: s.writes, attempts: window.__storageAttempts,
    backdrop: { src: bg.currentSrc || bg.src, opacity: bgStyle.opacity, filter: bgStyle.filter, veil: veilStyle.background, veilOpacity: veilStyle.opacity } };
});
const wallpaperApplied = () => current.locator('.wallpaper-choice[aria-checked="true"]').evaluateAll(elements => elements.map(e => e.getAttribute('data-action')));
const wallpaperNames = () => current.locator('.wallpaper-choice .setting-name').allTextContents();
const wallpaperBundle = () => current.evaluate(() => Object.fromEntries(['photo', 'matImg', 'phFieldImg', 'phFieldImgAlt', 'utFieldImg', 'utFieldImgAlt'].map(id => [id, document.getElementById(id).currentSrc || document.getElementById(id).src])));
const previewFrame = () => current.evaluate(() => {
  const e = document.getElementById('scene'), r = e.getBoundingClientRect(), css = getComputedStyle(e);
  return { x: r.x, y: r.y, width: r.width, height: r.height, radius: css.borderRadius, transform: css.transform };
});
const wallpaperListGeometry = () => current.evaluate(() => {
  const list = document.querySelector('.wallpaper-list'), bounds = list.getBoundingClientRect(), rows = [...list.querySelectorAll('.wallpaper-choice')];
  const fullyVisible = [], partlyVisible = [], clippedParts = [];
  rows.forEach(row => {
    const r = row.getBoundingClientRect(), action = row.getAttribute('data-action');
    const visible = getComputedStyle(row).visibility !== 'hidden';
    if (visible && r.bottom > bounds.top + 1 && r.top < bounds.bottom - 1) partlyVisible.push(action);
    if (visible && r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1) fullyVisible.push(action);
    const parts = [...row.querySelectorAll('.setting-name, .setting-tick svg')].map(e => e.getBoundingClientRect());
    if (parts.some(p => p.x < r.x - 1 || p.right > r.right + 1 || p.y < r.y - 1 || p.bottom > r.bottom + 1)) clippedParts.push(action);
    const name = row.querySelector('.setting-name'), tick = row.querySelector('.setting-tick svg');
    if (name && tick && name.getBoundingClientRect().right > tick.getBoundingClientRect().left + 1) clippedParts.push(action);
  });
  return { fullyVisible, partlyVisible, clippedParts, focus: ShoreQA.state().focusAction, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, top: ShoreQA.state().wallpaperPicker.top };
});
async function editor() { await scene('settings'); await act('settings.editor'); await current.waitForFunction(() => document.querySelector('[data-action^="editor.move."]')); await current.waitForFunction(() => !ShoreQA.state().catalog.loading); }
async function remove(id) { await act('editor.move.' + id); await nav('back', 'right', 'ok'); }
async function library() { await scene('home'); await act('util.apps'); await current.waitForFunction(() => !ShoreQA.state().catalog.loading); }
const libraryNames = () => current.locator('[data-action^="apps.open."] .label').allTextContents();
async function noLiveFilters() {
  return current.evaluate(() => [...document.querySelectorAll('#stage, #stage *')].filter(e => e.getClientRects().length).map(e => {
    const s = getComputedStyle(e); return { tag: e.tagName, cls: e.className, filter: s.filter, backdrop: s.backdropFilter || s.webkitBackdropFilter || 'none' };
  }).filter(s => /blur|url\(/.test(s.filter) || s.backdrop !== 'none'));
}
// Photo mode is visible state only: the stage class, the hidden Home layers and the photo caption.
const photoMode = () => current.evaluate(() => {
  const stage = document.getElementById('stage'), opacity = id => Number(getComputedStyle(document.getElementById(id)).opacity);
  return { on: stage.classList.contains('is-photo-mode'), utils: opacity('utils'), dock: opacity('dock'), list: opacity('phScene'), caption: opacity('caption'), photo: opacity('photo'),
    clock: (document.querySelector('#caption .clock') || {}).textContent || '', photoCaption: document.getElementById('photoCaption').textContent, photoCaptionOpacity: opacity('photoCaption') };
});
const photoHidden = () => current.waitForFunction(() => ['utils', 'dock', 'phScene'].every(id => getComputedStyle(document.getElementById(id)).opacity === '0'));
const focusStatus = () => current.evaluate(() => { const e = document.getElementById('focusStatus'); return { on: e.classList.contains('is-on') && getComputedStyle(e).display !== 'none', text: e.textContent }; });
const clockText = () => current.evaluate(() => document.querySelector('#caption .clock').textContent);
// The rendered clock matches the page's own time in the given format (waits across a minute boundary).
const clockShows = format => current.waitForFunction(f => {
  const d = new Date(), h = f === '12' ? d.getHours() % 12 || 12 : d.getHours();
  return document.querySelector('#caption .clock').textContent === h + ':' + String(d.getMinutes()).padStart(2, '0');
}, format, { timeout: 3000 }).then(() => true, () => false);

try {
  preview = await openPreview();
  await run('Legacy preference migration', async () => {
    for (const theme of ['list', 'shore', 'grid']) {
      await page({ seed: baseline({ theme, dock: ['youtube', 'netflix'], wallpaper: walls[1].id, lastApp: 'youtube', mode: '15' }) });
      const s = await state();
      check(theme + ' preserves order, wallpaper and rotation', same(s.dock, ['youtube', 'netflix']) && s.wallpaper === walls[1].id && s.mode === '15' && s.lastApp === 'youtube', s);
      check(theme + ' maps to intended two-layout appearance', s.look.layout === (theme === 'list' ? 'list' : 'dock') && s.look.bg === (theme === 'list' ? 'dark' : 'photo'), s.look);
      check(theme + ' gains the TV clock format and built-in photos', s.look.clock === '24' && s.look.source === 'builtin', s.look);
      await closePage();
    }
    await page({ seed: undefined, legacy: baseline({ theme: 'list', dock: ['netflix'], lastApp: 'netflix' }) });
    check('Old shore key is read', (await state()).dock.length === 1 && (await state()).look.layout === 'list');
    await look({ controls: 'text' });
    check('Next completed edit writes stable home key', (await stored()).dock[0] === 'netflix');
    await current.reload(); await ready();
    check('Migrated preferences survive reload', (await state()).look.controls === 'text' && (await state()).dock[0] === 'netflix');
  });
  await run('Invalid preferences and saved native pins', async () => {
    await page({ seed: '{broken', legacy: baseline({ dock: ['netflix'], lastApp: 'netflix' }) });
    check('Malformed primary recovers valid legacy key', same((await state()).dock, ['netflix']));
    await closePage();
    await page({ seed: { dock: [], wallpaper: 'missing', mode: 'constructor', theme: 'constructor' } });
    const s = await state();
    check('Invalid values recover usable bounded Home', s.dock.length >= 1 && s.dock.length <= 9 && walls.some(w => w.id === s.wallpaper) && ['fixed', 'open', '5', '15', '60'].includes(s.mode), s);
    await closePage();
    await page({ seed: baseline({ dock: [EXTRA, 'netflix'], lastApp: EXTRA, appRecords: [{ id: EXTRA, appId: EXTRA, name: UNSAFE_NAME, brand: '', icon: '' }] }) });
    await current.evaluate(() => { __tv.catalogFailure = true; });
    await library();
    check('Discovery failure preserves saved native pin', (await state()).dock.includes(EXTRA));
    await scene('home');
    check('Saved native pin stays on Home with its saved name', (await call('actions')).includes('home.app.' + EXTRA) && (await current.locator('[data-action="home.app.' + EXTRA + '"]').getAttribute('aria-label')) === UNSAFE_NAME);
  });
  await run('Startup fallbacks remain usable', async () => {
    await page({ noFontAPI: true });
    check('Missing font-loading API has usable baseline Home', (await state()).look.font === 'manrope' && (await call('where')).focusCount === 1);
    await closePage();
    await page({ seed: baseline({ mode: 'open' }), storageFailure: true });
    check('Failed open-mode write retains prior photo', (await state()).wallpaper === walls[0].id && (await stored()).wallpaper === walls[0].id);
  });
  await run('Fresh Home from the bridge catalogue', async () => {
    await page({ seed: undefined });
    const s = await state();
    check('Fresh Home lists the installed brands in brand order', same(s.dock, PRIMARY), s.dock);
    check('Fresh Home starts on its first app', s.selected === PRIMARY[0] && s.focusAction === 'home.app.' + PRIMARY[0], s.focusAction);
    check('The Switch input joins Home as the Nintendo Switch brand', (await current.locator('[data-action="home.app.nintendoswitch"]').getAttribute('aria-label')) === 'Nintendo Switch');
    check('Home reads the catalogue, photos, clock format and configuration from the bridge', await current.evaluate(() => Object.values(__tv.reads).every(n => n > 0)), await current.evaluate(() => __tv.reads));
    check('Starting Home calls no bridge action', (await calls()).length === 0, await calls());
    await closePage();
    await page({ seed: undefined, catalog: CATALOG.filter(a => [KODI, VLC, PC].includes(a.appId)) });
    check('Without a known brand Home starts with the installed apps, not inputs', same((await state()).dock, [KODI, VLC]), (await state()).dock);
  });
  await run('Bridge catalogue and native launch boundary', async () => {
    await page(); await library();
    const names = await libraryNames();
    check('All apps lists every bridge app and input once', names.length === CATALOG.length && names.includes('Nintendo Switch') && names.includes('PC'), names);
    check('Brand apps show their brand name once', names.filter(n => n === 'YouTube').length === 1 && !names.includes('SmartTube'), names);
    check('Installed names stay text, including HTML punctuation', names.includes(UNSAFE_NAME) && !(await current.evaluate(() => window.__catalogXss)));
    check('The browser mock catalogue does not appear with a bridge', !names.some(n => ['RaiPlay', 'Mediaset Infinity', 's0undTV', 'Settings'].includes(n)), names);
    await act('apps.open.' + KODI);
    check('Unbranded app launches its package', same(await calls(), [['launch', KODI]]), await calls());
    await scene('home'); await act('home.app.youtube');
    check('YouTube on Home launches the preferred SmartTube package', same(await lastCall(), ['launch', PACKAGE.youtube]));
    await act('home.app.netflix');
    check('Primary app keeps its verified package', same(await lastCall(), ['launch', PACKAGE.netflix]));
    await group('android'); await act('android.settings');
    check('TV settings opens through the bridge', same(await lastCall(), ['openSettings']) && (await state()).settingsGroup === 'android');
    await group('android'); await act('android.previous');
    check('Previous launcher opens through the bridge', same(await lastCall(), ['openPreviousLauncher']) && (await state()).settingsGroup === 'android');
    await current.evaluate(() => { __tv.launchFailure = true; });
    await scene('home'); await act('home.app.netflix'); await current.waitForFunction(() => ShoreQA.where().view === 'message');
    check('Launch failure shows the bridge message', (await current.locator('#stage').innerText()).includes('App unavailable for QA'));
    await nav('back');
    check('Back from the failure returns Home on the same app', (await call('where')).view === 'home' && (await state()).focusAction === 'home.app.netflix');
    await group('android'); await act('android.settings'); await current.waitForFunction(() => ShoreQA.where().view === 'message');
    check('TV settings failure shows the bridge message', (await current.locator('#stage').innerText()).includes('Settings unavailable for QA'));
    await nav('back');
    check('Back from the TV settings failure returns to Android TV', (await state()).settingsGroup === 'android' && (await state()).focusAction === 'android.settings');
  });
  await run('HDMI inputs in All apps and on Home', async () => {
    await page(); await library();
    const actions = await call('actions');
    check('Both inputs are listed in All apps', actions.includes('apps.open.nintendoswitch') && actions.includes('apps.open.' + PC), actions);
    await act('apps.open.' + PC);
    check('An unbranded input launches its input id', same(await lastCall(), ['launch', PC]));
    await act('apps.open.nintendoswitch');
    check('The Switch brand launches its input id', same(await lastCall(), ['launch', SWITCH]));
    await scene('home'); await act('home.app.nintendoswitch');
    check('The Switch on Home launches its input id', same(await lastCall(), ['launch', SWITCH]));
    await editor(); await remove(PC);
    check('An input leaves Home like an app', !(await stored()).dock.includes(PC) && (await state()).focusAction === 'editor.add.' + PC);
    await nav('ok');
    check('An input returns to Home in the same position', same((await stored()).dock, HOME));
  });
  await run('Catalogue failure and retry', async () => {
    await page(); await current.evaluate(() => { __tv.catalogFailure = true; }); await library();
    check('Catalogue failure leaves Home intact', same((await state()).dock, HOME));
    check('Catalogue failure is shown with a retry', (await call('actions')).includes('apps.retry') && (await state()).catalog.error && !(await current.locator('[data-action^="apps.open."]').count()), (await state()).catalog);
    await current.evaluate(() => { __tv.catalogFailure = false; }); await act('apps.retry');
    await current.waitForSelector('[data-action="apps.open.' + EXTRA + '"]');
    check('Retry displays real installed names', (await current.locator('[data-action^="apps.open."]').count()) === CATALOG.length);
  });
  await run('Catalogue failure at startup', async () => {
    await page();
    const before = (await state()).dock;
    await current.evaluate(() => sessionStorage.setItem('__cleanframe_catalog_down', '1'));
    await current.reload(); await ready();
    check('The bridge failed from the first catalogue read', await current.evaluate(() => __tv.catalogFailure && __tv.reads.apps > 0));
    check('Home starts from the last catalogue that loaded', same((await state()).dock, before) && (await call('where')).focusCount === 1, { before, after: (await state()).dock });
    await act('home.app.netflix');
    check('A cached Home app still opens', same(await lastCall(), ['launch', PACKAGE.netflix]), await lastCall());
    await library();
    check('All apps reports the failure with a retry', (await call('actions')).includes('apps.retry'));
  });
  await run('Remote buttons in Settings', async () => {
    const learned = (code, name) => current.evaluate(([code, name]) => window.dispatchEvent(new CustomEvent('cleanframe:button-learned', { detail: { code, name } })), [code, name]);
    const title = () => current.evaluate(() => { const v = ShoreQA.where().view; const el = document.querySelector(v === 'appearance' ? '#appearanceTitle' : '.sheet .s-title'); return el ? el.textContent : ''; });
    await page({ buttons: { enabled: false, list: [] } });
    await scene('settings'); await act('settings.group.android');
    check('Android TV lists Remote buttons', (await call('actions')).includes('android.buttons'));
    await act('android.buttons');
    check('Remote buttons opens its own group', (await state()).view === 'appearance' && await title() === 'Remote buttons', await title());
    let actions = await call('actions');
    check('With the service off, the screen offers Accessibility settings and no Add', actions.includes('buttons.service') && !(await current.locator('[data-action="buttons.add"]:not(.is-disabled)').count()), actions);
    await act('buttons.service');
    check('Turn on remote buttons opens Accessibility settings', same(await lastCall(), ['openAccessibilitySettings']));
    await current.evaluate(() => { __tv.buttons.enabled = true; window.dispatchEvent(new Event('focus')); });
    check('Returning with the service on enables Add a button', (await current.locator('[data-action="buttons.add"]:not(.is-disabled)').count()) === 1 && !(await call('actions')).includes('buttons.service'));

    await act('buttons.add');
    check('Add a button asks for a remote button', same(await lastCall(), ['learnButton']) && (await state()).view === 'message' && (await current.locator('.msg-title').textContent()) === 'Press a remote button');
    await nav('back');
    check('Back cancels learning and returns to Remote buttons', same(await lastCall(), ['cancelLearnButton']) && (await state()).view === 'appearance');
    await act('buttons.add');
    await learned(193, 'Button 6');
    check('A learned button opens the app picker', (await state()).view === 'apps' && await title() === 'Choose what Button 6 opens', await title());
    actions = await call('actions');
    check('The picker lists apps and inputs and offers no Remove for a new button', actions.includes('apps.pick.jellyfin') && actions.includes('apps.pick.nintendoswitch') && actions.includes('apps.pick.' + PC) && !actions.includes('apps.remove') && !actions.some(a => a.startsWith('apps.open.')), actions);
    await act('apps.pick.jellyfin');
    check('Choosing an app assigns the button', same(await lastCall(), ['setButton', 193, PACKAGE.jellyfin]));
    check('Back on Remote buttons with the new button focused', (await state()).view === 'appearance' && (await state()).focusAction === 'buttons.edit.193', (await state()).focusAction);
    check('The assigned button shows what it opens', (await current.locator('[data-action="buttons.edit.193"]').textContent()).includes('Opens Jellyfin'));

    await act('buttons.edit.193');
    check('Editing shows the current choice and Remove', (await call('actions')).includes('apps.remove') && (await current.locator('[data-action="apps.pick.jellyfin"]').textContent()).includes('Assigned'));
    await nav('down'); await nav('up');
    await current.keyboard.down('Enter'); await current.waitForTimeout(150);
    check('OK in the picker assigns on key down (no hold-to-close)', (await lastCall())[0] === 'setButton' && !(await calls()).some(c => c[0] === 'closeApp'), await lastCall());
    await current.keyboard.up('Enter');
    await act('buttons.edit.193'); await act('apps.remove');
    check('Remove deletes the button', same(await lastCall(), ['setButton', 193, '']) && !(await call('actions')).includes('buttons.edit.193') && (await state()).focusAction === 'buttons.add');
    await nav('back');
    check('Back from Remote buttons returns to Android TV', (await state()).view === 'appearance' && await title() === 'Android TV');
  });
  await run('Native icon and failed-image fallback', async () => {
    await page({ catalog: CATALOG.map(a => a.appId === EXTRA ? { ...a, icon: '/icons/' + EXTRA + '.png' } : a) });
    await current.route('**/icons/' + EXTRA + '.png', route => route.fulfill({ path: root + 'app/icon.png' }));
    await library();
    await current.waitForFunction(id => { const row = document.querySelector('[data-action="apps.open.' + id + '"]'); const img = row && row.querySelector('img'); return img && img.complete && img.naturalWidth > 0; }, EXTRA);
    check('Unbranded installed app uses its native icon', await current.evaluate(id => { const img = document.querySelector('[data-action="apps.open.' + id + '"] img'); return img && getComputedStyle(img).display !== 'none' && img.parentNode.classList.contains('has-native-icon'); }, EXTRA));
    current.__expectedFailures.push('/icons/missing-native-icon.png');
    await current.evaluate(id => { __tv.catalog.find(a => a.appId === id).icon = '/icons/missing-native-icon.png'; }, EXTRA);
    await library();
    await current.waitForFunction(id => { const img = document.querySelector('[data-action="apps.open.' + id + '"] img'); return img && img.src.includes('/missing-native-icon.png') && img.complete; }, EXTRA);
    const fallback = await current.evaluate(id => {
      const row = document.querySelector('[data-action="apps.open.' + id + '"]'), mark = row.querySelector('.native-icon'), img = mark && mark.querySelector('img');
      return { html: row.innerHTML, src: img && img.src, imageDisplay: img && getComputedStyle(img).display, initialsVisibility: mark && getComputedStyle(mark.firstChild).visibility, complete: img && img.complete, width: img && img.naturalWidth, text: row.textContent };
    }, EXTRA);
    check('Failed native icon leaves readable initials and app name', fallback.imageDisplay === 'none' && fallback.initialsVisibility === 'visible' && fallback.text.includes('Family'), fallback);
  });
  await run('Catalogue refresh when apps change', async () => {
    await page(); await library();
    const reads = await current.evaluate(() => __tv.reads.apps);
    await nav('right', 'right');
    check('Remote focus reaches an app in All apps', (await state()).focusAction === 'apps.open.' + KODI, (await state()).focusAction);
    await current.evaluate(() => { __tv.catalog.push({ appId: 'com.example.arte', name: 'Arte', kind: 'app', icon: '' }); window.dispatchEvent(new Event('cleanframe:apps-changed')); });
    check('A newly installed app appears when the shell reports a change', (await state()).catalog.ids.includes('com.example.arte') && (await current.evaluate(() => __tv.reads.apps)) > reads);
    check('Focus stays on the same app as the list changes', (await state()).focusAction === 'apps.open.' + KODI && (await call('where')).focusCount === 1, await call('where'));
    await current.evaluate(id => { __tv.catalog = __tv.catalog.filter(a => a.appId !== id); window.dispatchEvent(new Event('cleanframe:apps-changed')); }, KODI);
    const where = await call('where');
    check('Uninstalling the focused app keeps one focus in All apps', !(await state()).catalog.ids.includes(KODI) && where.view === 'apps' && where.focusCount === 1 && where.focusAction.startsWith('apps.open.'), where);
    await nav('back'); await act('util.apps');
    check('Reopening All apps reads the catalogue again', (await current.evaluate(() => __tv.reads.apps)) > reads + 2 && (await call('where')).focusCount === 1);
  });
  await run('Immediate edits, undo, move cancellation and limits', async () => {
    await page(); await editor();
    const start = (await state()).dock;
    await remove('netflix');
    check('Remove persists membership and keeps installation', !(await stored()).dock.includes('netflix') && (await current.evaluate(() => __tv.catalog.some(a => a.appId === 'com.netflix.ninja'))) && (await calls()).length === 0);
    check('Focus follows removal into addable apps', (await state()).focusAction === 'editor.add.netflix', (await state()).focusAction);
    await nav('ok'); check('Second OK restores same position', same((await stored()).dock, start));
    await remove('netflix'); await act('editor.undo'); check('Undo persists previous membership', same((await stored()).dock, start));
    await act('editor.move.netflix'); await nav('down'); check('Unfinished move does not write', same((await stored()).dock, start));
    await nav('back'); check('Back cancels unfinished move', same((await state()).dock, start));
    await act('editor.move.netflix'); await nav('down', 'ok');
    const moved = start.slice(), at = moved.indexOf('netflix'); [moved[at], moved[at + 1]] = [moved[at + 1], moved[at]];
    check('Placed move persists immediately', same((await stored()).dock, moved));
    await act('editor.add.' + EXTRA); check('15-app cap prevents a 16th app', (await state()).dock.length === 9 && !(await state()).dock.includes(EXTRA));
    await remove(HOME[0]); await act('editor.add.' + EXTRA);
    check('Native app can be pinned with stable ID', (await stored()).dock.includes(EXTRA) && (await state()).dock.length === 9);
    check('Native pin retains readable metadata for failed discovery', (await stored()).appRecords.some(a => a.id === EXTRA && a.name === UNSAFE_NAME));
    await current.evaluate(() => {
      for (let i = 1; i <= 6; i++) __tv.catalog.push({ appId: 'com.example.qa' + i, name: 'QA app ' + i, kind: 'app', icon: '' });
      window.dispatchEvent(new Event('cleanframe:apps-changed'));
    });
    for (let i = 1; i <= 6; i++) await act('editor.add.com.example.qa' + i);
    const fullDock = await state(), fullStored = await stored();
    check('Home accepts 15 apps and persists all six additional pins', fullDock.dock.length === 15 && fullStored.dock.length === 15 && Array.from({ length: 6 }, (_, i) => 'com.example.qa' + (i + 1)).every(id => fullDock.dock.includes(id)));
    await current.evaluate(() => { __tv.catalog.push({ appId: 'com.example.qa7', name: 'QA app 7', kind: 'app', icon: '' }); window.dispatchEvent(new Event('cleanframe:apps-changed')); });
    await act('editor.add.com.example.qa7');
    check('A 16th app is rejected', (await state()).dock.length === 15 && !(await state()).dock.includes('com.example.qa7'));
    await current.reload(); await ready(); check('15 pinned apps survive reload', (await state()).dock.length === 15);
    await editor(); const ids = (await state()).dock;
    for (const id of ids.slice(1)) await remove(id);
    await remove(ids[0]); check('Last Home app cannot be removed', same((await state()).dock, [ids[0]]) && same((await stored()).dock, [ids[0]]));
    check('Editor has no Save action', !(await current.locator('#stage').innerText()).match(/\bSave\b/));
  });
  await run('Actual storage failures are atomic', async () => {
    await page(); await editor(); const before = await stored();
    await current.evaluate(() => { window.__failWrites = true; }); await remove('netflix');
    check('Failed removal changes neither committed state nor storage', same((await state()).dock, before.dock) && same(await stored(), before));
    check('Failed write gives visible feedback', /not saved|couldn.t save|tries again/i.test(await current.locator('#stage').innerText()));
    await current.evaluate(() => { window.__failWrites = false; }); await nav('ok');
    check('Retry commits through same action', !(await stored()).dock.includes('netflix'));
    await scene('home'); const old = await state(), oldStored = await stored();
    await current.evaluate(() => { window.__failWrites = true; }); await call('look', { bg: old.look.bg === 'light' ? 'dark' : 'light' });
    await current.waitForFunction(() => !ShoreQA.state().pending);
    check('Failed appearance write keeps display and preferences', (await state()).look.bg === old.look.bg && same(await stored(), oldStored));
  });
  await run('Appearance axes, fonts, scaling and matching materials', async () => {
    await page();
    for (const bg of ['dark', 'light', 'photo']) for (const layout of ['list', 'dock']) for (const focus of ['type', 'glass']) {
      await look({ bg, layout, focus }); const s = await state();
      check('Independent axes ' + [bg, layout, focus].join('/'), s.look.bg === bg && s.look.layout === layout && s.look.focus === focus && s.shown.bg === bg, s.look);
    }
    for (const axis of ['apps', 'controls']) for (const value of ['icons', 'both', 'text']) { await look({ [axis]: value }); check(axis + ' ' + value + ' persists', (await state()).look[axis] === value); }
    for (const value of ['12', '24']) { await look({ clock: value }); check('clock ' + value + ' persists and renders', (await state()).look.clock === value && (await stored()).look.clock === value && await clockShows(value)); }
    await look({ bg: 'photo', layout: 'dock', focus: 'glass', apps: 'both', controls: 'icons' });
    for (const material of ['soft', 'frost', 'tint']) { await look({ material }); check(material + ' matches displayed bundle', (await state()).shown.material === material && (await state()).look.material === material); }
    const fonts = (await state()).fonts.available; check('Font catalogue includes default', fonts.includes('manrope'));
    for (const font of fonts) {
      await look({ font }); check('Font ' + font + ' settles', (await state()).look.font === font && (await state()).shown.font === font);
      if (font === 'newsreader') {
        for (const layout of ['list', 'dock']) for (const controls of ['icons', 'both', 'text']) {
          await look({ layout, controls });
          const wrong = await current.evaluate(() => [...document.querySelectorAll('.home .clock, .home .u, .home .u-label, .home .ph-name, .home .tile .label, .home .app-focus-name, .home .util-focus-label, .home .wall-keep')].filter(e => !/Newsreader/.test(getComputedStyle(e).fontFamily)).map(e => ({ cls: e.className, font: getComputedStyle(e).fontFamily })));
          check('Newsreader covers Home text ' + layout + '/' + controls, wrong.length === 0, wrong);
        }
      }
    }
    await look({ font: 'manrope' });
    for (const wall of walls) { await look({ wall: wall.id }); check('Wallpaper ' + wall.id + ' has matching bundle', (await state()).shown.wall === wall.id && (await state()).wallpaper === wall.id); }
    for (const layout of ['list', 'dock']) for (const width of [1920, 1280]) {
      await current.setViewportSize({ width, height: width * 9 / 16 }); await look({ layout });
      await current.waitForFunction(w => Math.abs(document.getElementById('stage').getBoundingClientRect().width - w) < 1, width);
      const g = await current.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, focus: ShoreQA.where().focusCount }; });
      check(layout + ' fits ' + width + ' with one focus', Math.abs(g.x) < 1 && Math.abs(g.y) < 1 && Math.abs(g.width - width) < 1 && Math.abs(g.height - width * 9 / 16) < 1 && g.focus === 1, g);
      await current.screenshot({ path: out + 'production-' + layout + '-' + width + '.jpg', quality: 90 });
    }
    // Behind the TV's screensaver the launcher can load with a 0 x 0 window; the last fit stays until it has a size.
    const scaled = await current.evaluate(() => {
      const stage = document.getElementById('stage'), before = stage.style.transform, real = Object.getOwnPropertyDescriptor(window, 'innerWidth');
      Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => 0 });
      window.dispatchEvent(new Event('resize'));
      const hidden = stage.style.transform;
      if (real) Object.defineProperty(window, 'innerWidth', real); else delete window.innerWidth;
      stage.style.transform = 'scale(0)';
      window.dispatchEvent(new Event('focus'));
      return { before, hidden, refit: stage.style.transform };
    });
    check('A 0 x 0 window keeps the last fit and focus refits', scaled.hidden === scaled.before && scaled.refit === scaled.before && scaled.before !== 'scale(0)', scaled);
    check('No live blur/backdrop filters', (await noLiveFilters()).length === 0, await noLiveFilters());
    check('No prototype lab controls in production', await current.evaluate(() => !document.querySelector('[data-lab], #lab, #side') && !document.querySelector('script[src*="prototype"]')));
    const before = (await state()).look; await current.reload(); await ready(); check('Appearance survives reload', same((await state()).look, before));
  });
  await run('Settings overview and visible choices', async () => {
    await page(); await scene('settings');
    const expected = ['settings.group.background', 'settings.group.layout', 'settings.group.typography', 'settings.group.focus', 'settings.editor', 'settings.group.android'];
    check('Overview has all six settings groups', same((await call('actions')).filter(a => expected.includes(a)).sort(), expected.slice().sort()));
    check('No Samsung group remains', !(await call('actions')).some(a => /samsung/i.test(a)) && !/samsung/i.test(await current.locator('#stage').innerText()));
    const specs = {
      background: { bg: ['dark', 'light', 'photo'], source: ['builtin', 'bing'] },
      layout: { layout: ['list', 'dock'], apps: ['icons', 'both', 'text'], controls: ['icons', 'both', 'text'], clock: ['24', '12'] },
      typography: { font: (await state()).fonts.available },
      focus: { focus: ['type', 'glass'], material: ['soft', 'frost', 'tint'] }
    };
    for (const [name, axes] of Object.entries(specs)) {
      await group(name);
      const options = await radios(), committed = (await state()).committed;
      for (const [axis, values] of Object.entries(axes)) {
        const rows = options.filter(r => r.action?.startsWith('choice.' + axis + '.'));
        check(name + ' shows every ' + axis + ' choice together', same(rows.map(r => r.action).sort(), values.map(v => 'choice.' + axis + '.' + v).sort()), rows);
        check(axis + ' checked state identifies only the applied choice', same(rows.filter(r => r.checked === 'true').map(r => r.action), ['choice.' + axis + '.' + committed[axis]]), rows);
      }
      check(name + ' detail has no persistent category rail', !(await call('actions')).some(a => a.startsWith('settings.group.')));
      await nav('back');
      check(name + ' Back restores overview category focus', (await state()).view === 'settings' && (await state()).focusAction === 'settings.group.' + name, await call('where'));
    }
    await group('background');
    const backgroundActions = await call('actions');
    check('Photo tools are reachable from Background', backgroundActions.includes('background.wallpaper') && backgroundActions.includes('background.rotation'), backgroundActions);
    await act('background.rotation');
    const rotationRows = await radios();
    check('All five rotation modes are visible together', same(rotationRows.map(r => r.action).sort(), ['fixed', 'open', '5', '15', '60'].map(v => 'rotation.' + v).sort()), rotationRows);
    await nav('back');
    check('Rotation Back restores its Background row', (await state()).settingsGroup === 'background' && (await state()).focusAction === 'background.rotation', await call('where'));
    await group('android');
    const androidActions = await call('actions');
    check('Android TV group shows both native actions', androidActions.includes('android.settings') && androidActions.includes('android.previous'), androidActions);
    check('Android TV group opens on TV settings', (await state()).focusAction === 'android.settings');
  });
  await run('Settings focus never changes the applied Home', async () => {
    await page();
    for (const name of ['background', 'layout', 'typography', 'focus', 'android']) {
      await group(name); const before = await settingsSnapshot();
      const visited = new Set();
      for (const direction of ['right', 'right', 'down', 'left', 'left', 'down', 'right', 'right', 'down', 'left', 'up', 'up', 'up', 'right']) {
        await nav(direction); visited.add((await state()).focusAction);
        const after = await settingsSnapshot();
        if (!same(after, before)) throw Error(name + ' navigation changed committed state, Home preview or storage: ' + JSON.stringify({ before, after }));
        if ((await call('where')).focusCount !== 1) throw Error(name + ' navigation did not keep one focus');
      }
      check(name + ' arrows browse choices without preview or storage writes', visited.size > 1, [...visited]);
      const firstRadio = (await radios())[0];
      if (firstRadio) {
        await current.locator('[data-action="' + firstRadio.action + '"]').hover();
        check(name + ' pointer hover does not apply a choice', same(await settingsSnapshot(), before));
      }
      await nav('back');
      check(name + ' Back cancels the unconfirmed choice', same(await settingsSnapshot(), before) && (await state()).focusAction === 'settings.group.' + name);
    }
    check('Browsing Android TV calls no bridge action', (await calls()).length === 0, await calls());
    await group('background'); await act('background.rotation'); const before = await settingsSnapshot();
    await nav('down', 'down', 'up', 'right', 'left');
    check('Rotation arrows do not save a mode', same(await settingsSnapshot(), before));
    await nav('back'); check('Unconfirmed Rotation choice is cancelled', same(await settingsSnapshot(), before) && (await state()).settingsGroup === 'background');
  });
  await run('Settings on-screen Back preserves choice focus', async () => {
    await page(); await group('layout'); const before = await settingsSnapshot();
    const candidate = await unselectedChoice();
    await act('settings.back');
    check('On-screen Back returns to the matching overview category', (await state()).view === 'settings' && (await state()).focusAction === 'settings.group.layout');
    check('On-screen Back keeps unconfirmed choice unapplied', same(await settingsSnapshot(), before));
    await act('settings.group.layout');
    check('Reopening restores the last real choice after on-screen Back', (await state()).focusAction === candidate.action, { expected: candidate.action, actual: (await state()).focusAction });
    await nav('back'); await act('settings.group.layout');
    check('Physical Back also preserves the last real choice', (await state()).focusAction === candidate.action);
  });
  await run('Settings OK applies explicit choices atomically', async () => {
    await page();
    const specs = [
      ['background', 'bg', ['dark', 'light', 'photo']],
      ['layout', 'layout', ['list', 'dock']],
      ['layout', 'apps', ['icons', 'text', 'both']],
      ['layout', 'controls', ['text', 'both', 'icons']],
      ['layout', 'clock', ['12', '24']],
      ['typography', 'font', (await state()).fonts.available],
      ['focus', 'focus', ['type', 'glass']],
      ['focus', 'material', ['frost', 'tint', 'soft']]
    ];
    for (const [name, axis, values] of specs) {
      await group(name);
      const selected = await settingsSnapshot(); await choice(axis, selected.committed[axis]); await ready();
      check(axis + ' OK on applied choice does not write again', same(await settingsSnapshot(), selected));
      for (const value of values) {
        const before = await settingsSnapshot(); await choice(axis, value); await ready();
        const after = await settingsSnapshot(), rows = await radios();
        const expectedWrites = before.writes + (before.committed[axis] === value ? 0 : 1);
        const untouched = { ...after.committed, [axis]: before.committed[axis] };
        const prefix = { bg: 'bg', layout: 'l', apps: 'a', controls: 'u', focus: 'f', material: 'm', font: 'font' }[axis];
        const shown = !Object.hasOwn(after.shown, axis) || after.shown[axis] === value;
        // The clock has no stage class; its rendered text carries the format.
        const rendered = prefix ? after.rendered.includes(prefix + '-' + value) : await clockShows(value);
        check(axis + ' OK applies ' + value + ' once', after.committed[axis] === value && shown && rendered && same(untouched, before.committed) && expectedWrites === after.writes && after.storageAttempts - before.storageAttempts === expectedWrites - before.writes && rows.some(r => r.action === 'choice.' + axis + '.' + value && r.checked === 'true'), { before, after, rows });
      }
      const applied = await settingsSnapshot(); await nav('back');
      check(axis + ' applied choice survives Back', same(await settingsSnapshot(), applied) && (await state()).focusAction === 'settings.group.' + name);
    }
    await group('background'); await act('background.rotation');
    const selected = await settingsSnapshot(); await act('rotation.' + selected.committed.mode);
    check('Rotation OK on applied mode does not write again', same(await settingsSnapshot(), selected));
    for (const value of ['open', '5', '15', '60', 'fixed']) {
      const before = await settingsSnapshot(); await act('rotation.' + value);
      check('Rotation OK applies ' + value + ' once', (await state()).mode === value && (await stored()).mode === value && (await state()).writes === before.writes + 1 && (await radios()).some(r => r.action === 'rotation.' + value && r.checked === 'true'));
    }
    await group('layout'); const before = await settingsSnapshot(), candidate = await unselectedChoice();
    const [, axis, value] = candidate.action.split('.');
    await current.keyboard.down('Enter'); await current.keyboard.down('Enter'); await ready();
    check('Held physical OK applies the focused choice once', (await state()).committed[axis] === value && (await state()).writes === before.writes + 1);
    await current.keyboard.up('Enter');
    await current.keyboard.down('Escape'); await current.keyboard.down('Escape');
    check('Held physical Back closes one settings layer', (await state()).view === 'settings' && (await state()).focusAction === 'settings.group.layout');
    await current.keyboard.up('Escape');
  });
  await run('Settings inactive Material retains its choice', async () => {
    await page(); await look({ material: 'tint' });
    for (const patch of [{ bg: 'dark' }, { bg: 'light' }, { bg: 'photo', layout: 'list', focus: 'type' }]) {
      await look(patch); await group('focus'); const before = await settingsSnapshot();
      const materials = (await radios()).filter(r => r.action.startsWith('choice.material.'));
      check('Material stays visible but inactive for ' + JSON.stringify(patch), materials.length === 3 && materials.every(r => r.disabled) && materials.some(r => r.action === 'choice.material.tint' && r.checked === 'true'), materials);
      const focusBefore = (await state()).focusAction;
      await current.locator('[data-action="choice.material.frost"]').click({ force: true });
      check('Inactive Material ignores pointer focus and application', same(await settingsSnapshot(), before) && (await state()).focusAction === focusBefore);
      await walkEnabledChoices();
      check('Remote navigation skips inactive Material', same(await settingsSnapshot(), before));
      const reason = await current.locator('.setting-reason:visible').allTextContents();
      check('Inactive Material has a visible explanation', reason.some(text => /material/i.test(text) && text.length > 20), reason);
    }
    await look({ bg: 'photo', layout: 'dock', focus: 'glass' }); await group('focus');
    const materials = (await radios()).filter(r => r.action.startsWith('choice.material.'));
    check('Applicable Material restores the remembered selection', materials.every(r => !r.disabled) && materials.some(r => r.action === 'choice.material.tint' && r.checked === 'true'));
  });
  await run('Settings inactive photo tools retain wallpaper preferences', async () => {
    await page();
    for (const bg of ['dark', 'light']) {
      await look({ bg }); await group('background'); const before = await settingsSnapshot();
      for (const action of ['background.wallpaper', 'background.rotation', 'choice.source.builtin', 'choice.source.bing']) {
        check(bg + ' marks ' + action + ' inactive', await current.locator('[data-action="' + action + '"]').getAttribute('aria-disabled') === 'true');
        const focusBefore = (await state()).focusAction;
        await current.locator('[data-action="' + action + '"]').click({ force: true });
        check('Inactive ' + action + ' ignores pointer focus and keeps preferences', same(await settingsSnapshot(), before) && (await state()).settingsGroup === 'background' && (await state()).focusAction === focusBefore);
      }
      await walkEnabledChoices();
      check(bg + ' remote navigation skips inactive photo tools', same(await settingsSnapshot(), before));
      check(bg + ' inactive photo source asks the TV for nothing', (await calls()).length === 0, await calls());
      const reason = await current.locator('.setting-reason:visible').allTextContents();
      check(bg + ' explains how to enable photo tools', reason.some(text => /photo/i.test(text) && /wallpaper|rotation/i.test(text)), reason);
    }
  });
  await run('Settings normalises remembered inactive focus', async () => {
    await page(); await group('focus'); await choice('material', 'tint'); await ready();
    await nav('back'); await act('settings.group.background'); await choice('bg', 'dark'); await ready();
    await nav('back'); await act('settings.group.focus');
    const focus = await focusedChoice();
    check('Inactive remembered Material returns to an enabled focus choice', focus && !focus.disabled && focus.action.startsWith('choice.focus.'), focus);
    check('Changing Background preserves remembered Material', (await state()).look.material === 'tint');
    await look({ bg: 'photo' }); await group('background'); await act('background.rotation'); await act('rotation.fixed');
    await look({ bg: 'dark' }); const before = await settingsSnapshot();
    check('All-inactive Rotation restores its enabled Back action', (await state()).focusAction === 'settings.back');
    const visited = await walkEnabledChoices();
    check('All-inactive Rotation traps focus on its enabled Back action', visited.every(a => a === 'settings.back') && same(await settingsSnapshot(), before), visited);
    await current.locator('[data-action="rotation.5"]').click({ force: true });
    check('Inactive Rotation ignores pointer clicks', (await state()).focusAction === 'settings.back' && same(await settingsSnapshot(), before));
    await nav('back');
    const returned = await focusedChoice();
    check('Rotation Back skips its now-inactive Background row', (await state()).settingsGroup === 'background' && returned && !returned.disabled && returned.action.startsWith('choice.bg.'), returned);
  });
  await run('Settings Back cancels pending assets and late callbacks', async () => {
    await page(); await group('focus'); const before = await settingsSnapshot();
    const held = [], pattern = '**/*-field-frost.jpg';
    let releaseImages;
    const blocked = new Promise(resolve => { releaseImages = resolve; });
    await current.route(pattern, async route => { held.push(route.request().url()); await blocked; await route.continue(); });
    try {
      await choice('material', 'frost'); await current.waitForFunction(() => !!ShoreQA.state().pending);
      check('Pending choice keeps the committed Home and storage', same(await settingsSnapshot(), before));
      await nav('back'); await ready();
      check('Back cancels pending choice and restores category focus', same(await settingsSnapshot(), before) && (await state()).view === 'settings' && (await state()).focusAction === 'settings.group.focus');
      releaseImages();
      await current.waitForLoadState('networkidle');
      check('Late image completion cannot commit a cancelled choice', held.length > 0 && same(await settingsSnapshot(), before) && !(await state()).pending);
    } finally { releaseImages(); await current.unroute(pattern); }
  });
  await run('Settings Back cancels a delayed font choice', async () => {
    await page(); await group('typography'); const before = await settingsSnapshot();
    const held = [], pattern = '**/fonts/newsreader/*';
    let releaseFont;
    const blocked = new Promise(resolve => { releaseFont = resolve; });
    await current.route(pattern, async route => { held.push(route.request().url()); await blocked; await route.continue(); });
    try {
      await choice('font', 'newsreader'); await current.waitForFunction(() => !!ShoreQA.state().pending);
      check('Loading a font keeps applied typography and its checked choice', same(await settingsSnapshot(), before) && (await radios()).some(r => r.action === 'choice.font.manrope' && r.checked === 'true'));
      await nav('back'); await ready();
      check('Back cancels the font choice and restores Typography focus', same(await settingsSnapshot(), before) && (await state()).focusAction === 'settings.group.typography');
      releaseFont(); await current.waitForLoadState('networkidle');
      check('Late font completion cannot apply the cancelled choice', held.length > 0 && same(await settingsSnapshot(), before) && !(await state()).pending);
      await group('typography'); await choice('font', 'newsreader'); await ready();
      check('Cancelled font remains available for a fresh explicit apply', (await state()).look.font === 'newsreader' && (await state()).shown.font === 'newsreader' && (await state()).writes === before.writes + 1);
    } finally { releaseFont(); await current.unroute(pattern); }
  });
  await run('Settings choice failure and explicit retry', async () => {
    await page(); await group('focus'); const original = await settingsSnapshot();
    current.__expectedFailures.push('-field-frost.jpg');
    await current.route('**/*-field-frost.jpg', route => route.abort('failed'));
    await choice('material', 'frost'); await current.waitForFunction(() => !ShoreQA.state().pending);
    check('Failed image keeps the applied radio and Home', same(await settingsSnapshot(), original) && (await radios()).some(r => r.action === 'choice.material.soft' && r.checked === 'true'));
    check('Failed explicit choice exposes Retry', (await call('actions')).includes('settings.retry'));
    await current.unroute('**/*-field-frost.jpg'); await act('settings.retry'); await ready();
    check('Retry applies the same failed choice', (await state()).look.material === 'frost' && (await state()).shown.material === 'frost' && (await state()).writes === original.writes + 1);
    await group('background'); const before = await settingsSnapshot();
    await current.evaluate(() => { __failWrites = true; }); await choice('bg', 'light');
    await current.waitForFunction(() => !ShoreQA.state().pending);
    const failed = await settingsSnapshot();
    check('Failed choice write keeps the committed radio and preview', same(failed.committed, before.committed) && same(failed.shown, before.shown) && failed.stored === before.stored && failed.writes === before.writes && (await radios()).some(r => r.action === 'choice.bg.photo' && r.checked === 'true'));
    await current.evaluate(() => { __failWrites = false; }); await act('settings.retry'); await ready();
    check('Storage Retry applies once through the explicit choice', (await state()).look.bg === 'light' && (await state()).shown.bg === 'light' && (await state()).writes === before.writes + 1);
  });
  await run('Settings choices fit both target viewports', async () => {
    await page();
    for (const width of [1920, 1280]) {
      await current.setViewportSize({ width, height: width * 9 / 16 });
      await current.waitForFunction(w => Math.abs(document.getElementById('stage').getBoundingClientRect().width - w) < 1, width);
      for (const name of ['background', 'layout', 'typography', 'focus', 'android', 'rotation']) {
        await group(name === 'rotation' ? 'background' : name);
        if (name === 'rotation') await act('background.rotation');
        const geometry = await current.evaluate(() => {
          const stage = document.getElementById('stage').getBoundingClientRect();
          const actions = ShoreQA.actions();
          return [...document.querySelectorAll('#stage [data-action]')].filter(e => actions.includes(e.getAttribute('data-action')) && e.getClientRects().length).map(e => {
            const r = e.getBoundingClientRect();
            const parts = [...e.querySelectorAll('.setting-name, .setting-tick svg')].map(part => part.getBoundingClientRect());
            const partsFit = parts.every(p => p.x >= r.x - 1 && p.y >= r.y - 1 && p.right <= r.right + 1 && p.bottom <= r.bottom + 1);
            const name = e.querySelector('.setting-name'), tick = e.querySelector('.setting-tick svg');
            const noOverlap = !name || !tick || name.getBoundingClientRect().right <= tick.getBoundingClientRect().left + 1;
            return { action: e.getAttribute('data-action'), inside: r.x >= stage.x - 1 && r.y >= stage.y - 1 && r.right <= stage.right + 1 && r.bottom <= stage.bottom + 1, fits: e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1 && partsFit && noOverlap, width: r.width, height: r.height };
          });
        });
        check(name + ' choices fit ' + width + ' without clipping', geometry.length > 0 && geometry.every(g => g.inside && g.fits) && (await call('where')).focusCount === 1, geometry);
        await current.screenshot({ path: out + 'settings-' + name + '-' + width + '.jpg', quality: 90 });
      }
    }
    check('Settings retains pre-rendered materials without live blur', (await noLiveFilters()).length === 0, await noLiveFilters());
  });
  await run('Wallpaper failure, preview cancellation and lazy loading', async () => {
    await page();
    const resources = await current.evaluate(() => performance.getEntriesByType('resource').map(r => r.name));
    check('No wallpaper thumbnails loaded at startup', !resources.some(u => /-thumb\./.test(u)), resources.filter(u => /thumb/.test(u)));
    check('Built-in photos make no Bing photo requests', !resources.some(u => u.includes('/photos/')), resources.filter(u => u.includes('/photos/')));
    await wallpaper();
    const original = (await stored()).wallpaper;
    await nav('down'); await wallpaperSettled(walls[1].id);
    check('Preview leaves saved photo unchanged', (await stored()).wallpaper === original);
    await nav('back'); await ready(); check('Back restores committed photo', (await state()).shown.wall === original);
    check('Wallpaper Back returns to its Background row', (await state()).settingsGroup === 'background' && (await state()).focusAction === 'background.wallpaper');
    await scene('home'); const target = walls.find(w => w.id !== original && w.id !== walls[1].id).id;
    current.__expectedFailures.push('/' + target + '-');
    await current.route('**/*' + target + '-*.jpg', route => route.abort('failed'));
    const before = await stored(); await call('look', { wall: target });
    await current.waitForFunction(() => !ShoreQA.state().pending, null, { timeout: 15000 });
    check('Failed load keeps saved and displayed photo', same(await stored(), before) && (await state()).shown.wall === original);
    await current.unroute('**/*' + target + '-*.jpg'); await look({ wall: target });
    check('Material can recover after failure', (await state()).shown.wall === target);
  });
  await run('Wallpaper child keeps the Settings frame at both sizes', async () => {
    await page();
    for (const width of [1920, 1280]) for (const layout of ['list', 'dock']) {
      await scene('home'); await look({ layout });
      await current.setViewportSize({ width, height: width * 9 / 16 });
      await current.waitForFunction(w => Math.abs(document.getElementById('stage').getBoundingClientRect().width - w) < 1, width);
      await group('background'); const frame = await previewFrame(), before = await wallpaperSaved();
      await act('background.wallpaper');
      await current.waitForFunction(() => ShoreQA.state().view === 'wallpaper');
      const names = await wallpaperNames();
      check(layout + ' Wallpaper shows all fifteen named choices at ' + width, same(names, walls.map(w => w.name)), names);
      check('Wallpaper entry keeps the existing Home frame ' + layout + '/' + width, same(await previewFrame(), frame));
      const first = await wallpaperListGeometry();
      check('Wallpaper list shows about six rows with contained labels ' + layout + '/' + width, first.fullyVisible.length >= 5 && first.fullyVisible.length <= 6 && first.partlyVisible.length <= 7 && first.clippedParts.length === 0 && first.fullyVisible.includes(first.focus) && (await call('where')).focusCount === 1, first);
      await nav('down', 'down'); await wallpaperSettled(walls[2].id);
      check('Browsing preserves saved photo and Settings backdrop ' + layout + '/' + width, same(await wallpaperSaved(), before));
      check('Browsing stays in the same right Home frame ' + layout + '/' + width, same(await previewFrame(), frame));
      check('Applied tick stays separate from preview focus ' + layout + '/' + width, same(await wallpaperApplied(), ['wallpaper.choose.' + before.committed.wall]) && (await state()).focusAction === 'wallpaper.choose.' + walls[2].id && (await state()).shown.wall === walls[2].id && (await call('where')).focusCount === 1);
      await current.screenshot({ path: out + 'wallpaper-' + layout + '-' + width + '.jpg', quality: 90 });
      await nav('back'); await ready();
      check('Wallpaper Back restores its Background row ' + layout + '/' + width, (await state()).settingsGroup === 'background' && (await state()).focusAction === 'background.wallpaper' && (await state()).shown.wall === before.committed.wall && same(await previewFrame(), frame));
    }
  });
  await run('Wallpaper applies in place and Back keeps the latest applied photo', async () => {
    await page(); await wallpaper(); const before = await wallpaperSaved();
    check('Applied wallpaper omits the redundant Apply hint', !/apply.*photo/i.test(await current.locator('#appearanceDesc').innerText()));
    await nav('down'); await wallpaperSettled(walls[1].id);
    check('A browsed photo is not saved by focus', same(await wallpaperSaved(), before));
    check('Unsaved preview explains the OK action', /apply.*photo/i.test(await current.locator('#appearanceDesc').innerText()));
    await nav('ok'); await ready();
    const applied = await wallpaperSaved();
    check('OK applies once while staying inside Wallpaper', (await state()).view === 'wallpaper' && applied.committed.wall === walls[1].id && applied.writes === before.writes + 1 && applied.attempts === before.attempts + 1 && same(await wallpaperApplied(), ['wallpaper.choose.' + walls[1].id]));
    check('Successful apply clears its redundant Apply hint', !/apply.*photo/i.test(await current.locator('#appearanceDesc').innerText()));
    check('Applied photo updates the committed Settings backdrop', applied.backdrop.src.includes('/' + walls[1].id + '-panel.jpg'));
    await nav('ok'); await current.keyboard.down('Enter'); await current.keyboard.down('Enter'); await current.keyboard.up('Enter');
    check('Repeated OK on the applied photo is a no-op', same(await wallpaperSaved(), applied));
    await nav('down'); await wallpaperSettled(walls[2].id); await nav('back'); await ready();
    check('Back after apply restores the latest applied photo', (await state()).shown.wall === walls[1].id && same(await wallpaperSaved(), applied) && (await state()).focusAction === 'background.wallpaper');
    await act('background.wallpaper');
    check('Reopening starts at the applied photo', (await state()).focusAction === 'wallpaper.choose.' + walls[1].id && (await state()).wallpaperPicker.candidate === walls[1].id);
    await current.locator('[data-action="wallpaper.choose.' + walls[3].id + '"]').hover();
    check('Pointer hover does not apply or preview another photo', same(await wallpaperSaved(), applied) && (await state()).shown.wall === walls[1].id);
    await current.locator('[data-action="wallpaper.choose.' + walls[3].id + '"]').click(); await ready();
    check('A pointer row click applies that photo once', (await state()).committed.wall === walls[3].id && (await state()).writes === applied.writes + 1 && (await state()).view === 'wallpaper');
    await act('wallpaper.back'); await ready();
    check('On-screen Wallpaper Back restores Background focus', (await state()).settingsGroup === 'background' && (await state()).focusAction === 'background.wallpaper' && (await state()).shown.wall === walls[3].id);
  });
  await run('Wallpaper navigation is bounded and scrolls the catalogue', async () => {
    await page(); await wallpaper(); const before = await wallpaperSaved();
    await nav('up');
    check('Up from the first wallpaper reaches Back without wrapping', (await state()).focusAction === 'wallpaper.back' && (await state()).shown.wall === walls[0].id);
    check('Back still shows its return hint', /background|return/i.test(await current.locator('#appearanceDesc').innerText()));
    await nav('down');
    check('Down from Back restores the current candidate', (await state()).focusAction === 'wallpaper.choose.' + walls[0].id);
    await nav(...Array(walls.length - 1).fill('down')); await wallpaperSettled(walls.at(-1).id); await wallpaperRowVisible(walls.at(-1).id);
    const end = await wallpaperListGeometry();
    check('Last wallpaper scrolls fully into view', end.fullyVisible.includes('wallpaper.choose.' + walls.at(-1).id) && end.top > 0 && end.clippedParts.length === 0, end);
    await nav('down', 'down');
    check('Down at the catalogue end does not wrap', (await state()).focusAction === 'wallpaper.choose.' + walls.at(-1).id && same(await wallpaperSaved(), before));
    await nav('left'); check('Left from a scrolled row reaches Back', (await state()).focusAction === 'wallpaper.back');
    await nav('right'); check('Right from Back restores the scrolled candidate', (await state()).focusAction === 'wallpaper.choose.' + walls.at(-1).id);
    const top = (await state()).wallpaperPicker.top;
    await nav(...Array(walls.length - 1 - top).fill('up')); await wallpaperSettled(walls[top].id);
    await nav('up'); await wallpaperSettled(walls[top - 1].id);
    check('Up from a scrolled top row continues the catalogue', (await state()).focusAction === 'wallpaper.choose.' + walls[top - 1].id && (await state()).view === 'wallpaper');
    await nav(...Array(top - 1).fill('up')); await wallpaperSettled(walls[0].id); await wallpaperRowVisible(walls[0].id);
    const start = await wallpaperListGeometry();
    check('Returning to the first wallpaper resets scrolling', start.top === 0 && start.fullyVisible.includes('wallpaper.choose.' + walls[0].id), start);
    await nav('up', 'up');
    check('Repeated Up stops at Back with no preference writes', (await state()).focusAction === 'wallpaper.back' && same(await wallpaperSaved(), before));
  });
  await run('Wallpaper rapid browsing debounces work and OK is never lost', async () => {
    await page(); await wallpaper(); const before = await wallpaperSaved();
    const immediate = await current.evaluate(() => {
      const at = performance.now(); ShoreQA.nav('down', 'down', 'down');
      return { at, action: ShoreQA.state().focusAction, shown: ShoreQA.state().shown.wall };
    });
    check('Rapid browsing updates row focus before loading the preview', immediate.action === 'wallpaper.choose.' + walls[3].id && immediate.shown === walls[0].id, immediate);
    await wallpaperSettled(walls[3].id);
    const resources = await current.evaluate(() => performance.getEntriesByType('resource').map(r => ({ name: r.name, start: r.startTime })));
    const latest = resources.find(r => r.name.endsWith('/wallpapers/' + walls[3].id + '.jpg'));
    check('Preview work waits for focus to settle', latest && latest.start - immediate.at >= 100, { delay: latest && latest.start - immediate.at });
    check('Fast skipped rows do not load their full wallpaper bundles', !resources.some(r => [walls[1].id, walls[2].id].some(id => r.name.endsWith('/wallpapers/' + id + '.jpg') || r.name.includes('/materials/' + id + '-'))));
    check('Debounced preview never saves from focus', same(await wallpaperSaved(), before));
    await nav('down', 'ok');
    await current.waitForFunction(id => ShoreQA.state().committed.wall === id && !ShoreQA.state().pending, walls[4].id);
    check('OK during focus debounce applies the current candidate once', (await state()).writes === before.writes + 1 && (await state()).shown.wall === walls[4].id && (await state()).view === 'wallpaper');
  });
  await run('Wallpaper newer previews cancel older queued applies', async () => {
    await page(); await wallpaper(); const before = await wallpaperSaved();
    const first = walls[1].id, latest = walls[2].id, pattern = '**/wallpapers/' + first + '.jpg', held = [];
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    await current.route(pattern, async route => { held.push(route.request().url()); await blocked; await route.continue(); });
    try {
      await nav('down'); await current.waitForFunction(id => ShoreQA.state().pending && ShoreQA.state().pending.target.wall === id, first);
      await nav('ok'); check('OK while loading records one explicit apply request', !!(await state()).wallpaperPicker.applyPending && same(await wallpaperSaved(), before));
      await nav('down'); await wallpaperSettled(latest);
      check('Browsing away cancels the queued apply', !(await state()).wallpaperPicker.applyPending && same(await wallpaperSaved(), before));
      check('Latest preview installs a matching photo and material bundle', Object.values(await wallpaperBundle()).every(src => src.includes('/' + latest)), await wallpaperBundle());
      release(); await current.waitForLoadState('networkidle');
      check('Older completion cannot overwrite or apply the latest preview', held.length > 0 && (await state()).shown.wall === latest && Object.values(await wallpaperBundle()).every(src => src.includes('/' + latest)) && same(await wallpaperSaved(), before));
      await nav('back'); await ready();
      check('Back restores the complete committed bundle after rapid browsing', Object.values(await wallpaperBundle()).every(src => src.includes('/' + before.committed.wall)));
    } finally { release(); await current.unroute(pattern); }
  });
  await run('Wallpaper Back cancels loading and queued applies', async () => {
    await page(); await wallpaper();
    await current.locator('[data-action="wallpaper.choose.' + walls[1].id + '"]').click(); await ready();
    const applied = await wallpaperSaved();
    for (const [index, back] of [[2, 'remote'], [3, 'pointer']]) {
      if ((await state()).view !== 'wallpaper') await act('background.wallpaper');
      const target = walls[index].id, pattern = '**/wallpapers/' + target + '.jpg', held = [];
      let release;
      const blocked = new Promise(resolve => { release = resolve; });
      await current.route(pattern, async route => { held.push(route.request().url()); await blocked; await route.continue(); });
      try {
        await act('wallpaper.choose.' + target);
        await current.waitForFunction(() => !!ShoreQA.state().pending && !!ShoreQA.state().wallpaperPicker.applyPending);
        if (back === 'remote') await nav('back'); else await current.locator('[data-action="wallpaper.back"]').click();
        await ready();
        check(back + ' Back cancels pending apply and returns to Wallpaper row', (await state()).focusAction === 'background.wallpaper' && (await state()).shown.wall === applied.committed.wall && same(await wallpaperSaved(), applied));
        release(); await current.waitForLoadState('networkidle');
        check(back + ' Back ignores late completion and keeps latest applied photo', held.length > 0 && (await state()).shown.wall === applied.committed.wall && same(await wallpaperSaved(), applied));
      } finally { release(); await current.unroute(pattern); }
    }
  });
  await run('Wallpaper preview failure restores committed photo and retries preview only', async () => {
    await page(); await wallpaper(); const before = await wallpaperSaved();
    await nav('down'); await wallpaperSettled(walls[1].id);
    const target = walls[2].id, pattern = '**/wallpapers/' + target + '.jpg';
    current.__expectedFailures.push('/wallpapers/' + target + '.jpg');
    await current.route(pattern, route => route.abort('failed'));
    await nav('down'); await current.waitForFunction(() => ShoreQA.actions().includes('wallpaper.retry'));
    check('Failed browse restores the committed frame rather than another unsaved preview', (await state()).shown.wall === before.committed.wall && same(await wallpaperSaved(), before) && same(await wallpaperApplied(), ['wallpaper.choose.' + before.committed.wall]));
    check('Failed candidate remains identified for retry', (await state()).wallpaperPicker.candidate === target && /couldn.t|failed|try again/i.test(await current.locator('#appearance').innerText()));
    await current.unroute(pattern); await act('wallpaper.retry'); await wallpaperSettled(target);
    check('Retrying a failed browse does not authorise a save', same(await wallpaperSaved(), before) && !(await state()).wallpaperPicker.applyPending);
    check('Successful preview Retry returns focus to its candidate', (await state()).focusAction === 'wallpaper.choose.' + target);
    await nav('ok'); await ready();
    check('Explicit OK can apply the recovered preview', (await state()).committed.wall === target && (await state()).writes === before.writes + 1);
  });
  await run('Wallpaper explicit apply and storage failures preserve applied state', async () => {
    await page(); await wallpaper(); const before = await wallpaperSaved();
    const target = walls[2].id, pattern = '**/wallpapers/' + target + '.jpg';
    current.__expectedFailures.push('/wallpapers/' + target + '.jpg');
    await current.route(pattern, route => route.abort('failed'));
    await act('wallpaper.choose.' + target); await current.waitForFunction(() => ShoreQA.actions().includes('wallpaper.retry'));
    check('Failed explicit apply changes no committed photo, tick or storage', same(await wallpaperSaved(), before) && same(await wallpaperApplied(), ['wallpaper.choose.' + before.committed.wall]));
    await current.unroute(pattern); await act('wallpaper.retry'); await ready();
    check('Retry preserves explicit apply intent and stays in the picker', (await state()).committed.wall === target && (await state()).writes === before.writes + 1 && (await state()).view === 'wallpaper');
    const applied = await wallpaperSaved(), requests = [];
    current.on('request', request => { if (request.url().endsWith('/wallpapers/' + walls[3].id + '.jpg') || request.url().includes('/materials/' + walls[3].id + '-')) requests.push(request.url()); });
    await nav('down'); await wallpaperSettled(walls[3].id);
    const loadedRequests = requests.length;
    await current.evaluate(() => { __failWrites = true; }); await nav('ok');
    await current.waitForFunction(() => ShoreQA.actions().includes('wallpaper.retry'));
    const failed = await wallpaperSaved();
    check('Failed wallpaper save preserves applied photo, tick and backdrop', failed.stored === applied.stored && same(failed.committed, applied.committed) && same(failed.backdrop, applied.backdrop) && failed.writes === applied.writes && same(await wallpaperApplied(), ['wallpaper.choose.' + target]));
    check('Storage failure restores the committed frame and names the failed candidate', (await state()).shown.wall === target && Object.values(await wallpaperBundle()).every(src => src.includes('/' + target)) && (await state()).wallpaperPicker.candidate === walls[3].id && (await current.locator('#appearance').innerText()).includes(walls[3].name));
    await current.evaluate(() => { __failWrites = false; }); await act('wallpaper.retry'); await ready();
    check('Storage Retry applies the candidate exactly once', (await state()).committed.wall === walls[3].id && (await state()).writes === applied.writes + 1 && (await state()).view === 'wallpaper');
    check('Storage Retry reuses the already-loaded wallpaper bundle', loadedRequests > 0 && requests.length === loadedRequests, requests);
  });
  await run('Wallpaper thumbnails fail without breaking the list or full photo', async () => {
    await page(); const target = walls[5], pattern = '**/wallpapers/' + target.id + '-thumb.jpg';
    current.__expectedFailures.push('/wallpapers/' + target.id + '-thumb.jpg');
    await current.route(pattern, route => route.abort('failed'));
    await wallpaper();
    await current.waitForFunction(id => {
      const slot = document.querySelector('[data-action="wallpaper.choose.' + id + '"] .wallpaper-thumb');
      return slot && slot.classList.contains('is-missing');
    }, target.id);
    await nav(...Array(5).fill('down')); await wallpaperSettled(target.id);
    const fallback = await current.evaluate(id => {
      const row = document.querySelector('[data-action="wallpaper.choose.' + id + '"]'), slot = row.querySelector('.wallpaper-thumb'), img = slot.querySelector('img');
      const r = row.getBoundingClientRect(), b = slot.getBoundingClientRect();
      return { name: row.textContent, slotVisible: getComputedStyle(slot).display !== 'none' && b.width > 0 && b.height > 0,
        ratio: b.width / b.height, inside: b.left >= r.left && b.right <= r.right && b.top >= r.top && b.bottom <= r.bottom,
        imageHidden: !img || getComputedStyle(img).display === 'none' || getComputedStyle(img).visibility === 'hidden' };
    }, target.id);
    check('Broken thumbnail keeps its named 16:9 slot without a broken image glyph', fallback.name.includes(target.name) && fallback.slotVisible && fallback.inside && Math.abs(fallback.ratio - 16 / 9) < 0.05 && fallback.imageHidden, fallback);
    await nav('ok'); await ready();
    check('A missing thumbnail does not prevent applying its full photo', (await state()).committed.wall === target.id && Object.values(await wallpaperBundle()).every(src => src.includes('/' + target.id)));
  });
  await run('Photo source switches between built-in and Bing photos', async () => {
    await page(); await group('background');
    const sources = (await radios()).filter(r => r.action.startsWith('choice.source.'));
    check('Photo source offers Built-in and Bing with Built-in applied', same(sources.map(r => r.action), ['choice.source.builtin', 'choice.source.bing']) && sources[0].checked === 'true' && sources[1].checked === 'false', sources);
    await act('background.wallpaper');
    check('Built-in picker lists only the fifteen bundled photos', same(await wallpaperNames(), walls.map(w => w.name)), await wallpaperNames());
    await act('wallpaper.back'); await ready();
    const before = await state();
    await choice('source', 'bing'); await ready();
    let s = await state();
    check('Choosing Bing asks the TV for fresh photos', same(await calls(), [['refreshPhotos']]), await calls());
    check('Choosing Bing applies the newest Bing photo once', s.look.source === 'bing' && s.wallpaper === BING[0].id && s.shown.wall === BING[0].id && s.writes === before.writes + 1 && (await stored()).look.source === 'bing', s);
    check('The Bing photo and its materials load from its own path', Object.values(await wallpaperBundle()).every(src => src.includes('/photos/') && src.includes(BING[0].id)), await wallpaperBundle());
    check('Background names the applied Bing photo', (await current.locator('[data-action="background.wallpaper"]').innerText()).includes(BING[0].name));
    await act('background.wallpaper');
    check('Bing picker lists only the Bing photos', same(await wallpaperNames(), BING.map(p => p.name)), await wallpaperNames());
    check('Bing picker counts only the Bing photos', /1 of 2/.test(await current.locator('.wallpaper-count').innerText()));
    await nav('down'); await wallpaperSettled(BING[1].id); await nav('ok'); await ready();
    check('A Bing photo applies from the picker', (await state()).committed.wall === BING[1].id && (await stored()).wallpaper === BING[1].id);
    await nav('back'); await ready();
    await choice('source', 'builtin'); await ready();
    s = await state();
    check('Back to Built-in shows the first bundled photo', s.look.source === 'builtin' && s.wallpaper === walls[0].id && s.shown.wall === walls[0].id, s);
    check('Returning to Built-in asks the TV for nothing', (await calls()).length === 1, await calls());
    await act('background.wallpaper');
    check('Built-in picker again lists only the bundled photos', same(await wallpaperNames(), walls.map(w => w.name)));
    await act('wallpaper.back'); await ready();
    await current.evaluate(() => window.dispatchEvent(new Event('cleanframe:photos-updated')));
    check('New Bing photos leave a built-in Home unchanged', (await state()).wallpaper === walls[0].id && (await state()).writes === s.writes);
  });
  await run('Bing source before the first download and rotation within it', async () => {
    await page({ photos: [] }); await group('background'); await choice('source', 'bing'); await ready();
    let s = await state();
    check('Bing without photos keeps the built-in photo', s.look.source === 'bing' && s.wallpaper === walls[0].id && s.shown.wall === walls[0].id, s);
    check('The source row says when Bing photos appear', (await current.locator('.setting-reason:visible').allTextContents()).some(t => /first download/i.test(t)));
    await act('background.wallpaper');
    check('Until Bing photos arrive the picker keeps the bundled photos', same(await wallpaperNames(), walls.map(w => w.name)));
    await act('wallpaper.back'); await ready();
    await current.evaluate(photos => { __tv.photos = photos; window.dispatchEvent(new Event('cleanframe:photos-updated')); }, BING);
    await current.waitForFunction(id => ShoreQA.state().committed.wall === id && !ShoreQA.state().pending, BING[0].id);
    s = await state();
    check('Arriving Bing photos replace the fallback photo', s.shown.wall === BING[0].id && (await stored()).wallpaper === BING[0].id, s);
    check('The waiting note goes once photos arrive', !(await current.locator('.setting-reason:visible').allTextContents()).some(t => /first download/i.test(t)));
    await closePage();
    await page({ seed: baseline({ mode: 'open', look: { source: 'bing', wall: BING[0].id } }) });
    check('Open rotation stays within the Bing photos', (await state()).wallpaper === BING[1].id && (await state()).look.source === 'bing');
    await current.reload(); await ready();
    check('Open rotation wraps within the Bing photos', (await state()).wallpaper === BING[0].id);
  });
  await run('Photo mode', async () => {
    await page();
    for (const layout of ['dock', 'list']) {
      await look({ layout }); await scene('home');
      check(layout + ' Home starts outside Photo mode', !(await photoMode()).on);
      await nav(layout === 'dock' ? 'up' : 'right');
      const before = await call('where');
      check(layout + ' Photo mode is the first Home control', before.focusAction === 'util.photo', before);
      await nav('ok'); await photoHidden();
      const inside = await photoMode();
      check(layout + ' OK enters Photo mode', inside.on && (await call('where')).view === 'home', inside);
      check(layout + ' Photo mode hides apps and controls but keeps the photo and clock', inside.utils === 0 && inside.dock === 0 && inside.list === 0 && inside.photo > 0 && inside.caption > 0 && /^\d{1,2}:\d{2}$/.test(inside.clock), inside);
      check(layout + ' Built-in photos have no caption in Photo mode', inside.photoCaption === '');
      await current.screenshot({ path: out + 'photo-mode-' + layout + '.jpg', quality: 90 });
      await nav(layout === 'dock' ? 'down' : 'left');
      check(layout + ' A key leaves Photo mode without acting on it', !(await photoMode()).on && same(await call('where'), before), { before, after: await call('where') });
      await nav('ok'); await nav('ok');
      check(layout + ' OK in Photo mode only leaves it', !(await photoMode()).on && same(await call('where'), before), await call('where'));
      await nav('ok'); await nav('back');
      check(layout + ' Back in Photo mode only leaves it', !(await photoMode()).on && same(await call('where'), before));
    }
    await nav('ok'); await current.keyboard.down('Enter'); await current.waitForTimeout(800); await current.keyboard.up('Enter');
    check('Held OK in Photo mode only leaves it', !(await photoMode()).on && (await calls()).length === 0 && (await call('where')).focusAction === 'util.photo');
    await nav('ok'); await current.keyboard.press('ArrowLeft');
    check('A physical arrow leaves Photo mode with focus kept', !(await photoMode()).on && (await call('where')).focusAction === 'util.photo');
    await nav('ok'); await current.evaluate(() => window.CleanFrameBack());
    check('The remote Back key from the shell only leaves Photo mode', !(await photoMode()).on && (await call('where')).view === 'home' && (await call('where')).focusAction === 'util.photo');
    await nav('ok'); await current.evaluate(() => window.CleanFrameHome());
    check('The Home button leaves Photo mode', !(await photoMode()).on && (await call('where')).view === 'home' && (await call('where')).focusCount === 1);
    check('Photo mode calls no bridge action', (await calls()).length === 0, await calls());
    await closePage();
    await page({ seed: baseline({ look: { source: 'bing', wall: BING[0].id } }) });
    await act('util.photo'); await photoHidden();
    await current.waitForFunction(() => Number(getComputedStyle(document.getElementById('photoCaption')).opacity) > 0.5);
    const bing = await photoMode();
    check('Bing photos show their caption in Photo mode', bing.on && bing.photoCaption === BING[0].caption && bing.photoCaptionOpacity > 0, bing);
    await nav('down');
    check('Leaving Photo mode removes the caption', !(await photoMode()).on && (await photoMode()).photoCaption === '');
  });
  await run('Back and Home on the launcher', async () => {
    await page(); const before = await call('where');
    await nav('back'); await current.keyboard.press('Escape');
    check('Back on Home stays on the selected app', same(await call('where'), before) && (await calls()).length === 0, await call('where'));
    check('Back on Home shows no message', !(await call('actions')).some(a => a.startsWith('message.')));
    await nav('up'); await nav('back');
    check('Back from the Home controls returns to the selected app', same(await call('where'), before));
    await group('layout'); await current.evaluate(() => window.CleanFrameBack());
    check('The remote Back key from the shell closes one layer', (await state()).view === 'settings' && (await state()).focusAction === 'settings.group.layout');
    await act('settings.editor'); await current.evaluate(() => window.CleanFrameHome());
    check('The Home button closes every panel and returns to the selected app', (await call('where')).view === 'home' && (await state()).focusAction === before.focusAction && (await call('where')).focusCount === 1);
  });
  await run('Hold OK to close an app', async () => {
    await page();
    check('Home starts on the remembered app', (await state()).focusAction === 'home.app.netflix');
    await current.keyboard.down('Enter'); await current.waitForTimeout(150);
    check('OK going down on an app does not act yet', (await calls()).length === 0);
    await current.keyboard.up('Enter');
    check('A short OK opens the app when released', same(await calls(), [['launch', PACKAGE.netflix]]), await calls());
    await current.keyboard.down('Enter'); await current.waitForTimeout(450); await current.keyboard.up('Enter');
    check('Releasing OK before 650 ms still opens the app', same(await calls(), [['launch', PACKAGE.netflix], ['launch', PACKAGE.netflix]]), await calls());
    await current.keyboard.down('Enter'); await current.keyboard.down('Enter'); await current.waitForTimeout(400);
    check('No close before 650 ms', (await calls()).length === 2);
    await current.waitForFunction(() => __tv.calls.length === 3, null, { timeout: 2000 });
    check('Holding OK closes the app through the bridge', same(await lastCall(), ['closeApp', PACKAGE.netflix]));
    await current.waitForTimeout(400);
    check('A held key repeat closes only once', (await calls()).length === 3);
    let status = await focusStatus();
    check('Closing flashes "Closed Netflix." under the app', status.on && status.text === 'Closed Netflix.', status);
    await current.keyboard.up('Enter');
    check('Releasing after a close does not open the app', (await calls()).length === 3 && (await state()).view === 'home');
    await nav('right');
    status = await focusStatus();
    check('The close note goes when focus moves', !status.on || status.text !== 'Closed Netflix.', status);
    await nav('left');
    status = await focusStatus();
    check('The close note does not come back when focus returns', !status.on || status.text !== 'Closed Netflix.', status);
    await current.keyboard.down('Enter'); await current.waitForTimeout(200); await current.keyboard.press('ArrowRight'); await current.waitForTimeout(700); await current.keyboard.up('Enter');
    check('Another key during a hold cancels it', (await calls()).length === 3 && (await state()).focusAction === 'home.app.jellyfin', { calls: await calls(), focus: (await state()).focusAction });
    await look({ layout: 'list' }); await scene('home');
    await current.keyboard.down('Enter'); await current.waitForFunction(() => __tv.calls.length === 4, null, { timeout: 2000 }); await current.keyboard.up('Enter');
    status = await focusStatus();
    check('List Home closes the focused app too', same(await lastCall(), ['closeApp', PACKAGE.jellyfin]) && status.on && status.text === 'Closed Jellyfin.', status);
    await look({ layout: 'dock' }); await library(); await nav('right', 'right');
    await current.keyboard.down('Enter'); await current.waitForFunction(() => __tv.calls.length === 5, null, { timeout: 2000 }); await current.keyboard.up('Enter');
    status = await focusStatus();
    check('All apps closes the focused app', same(await lastCall(), ['closeApp', KODI]) && status.on && status.text === 'Closed Kodi.' && (await call('where')).view === 'apps', status);
    await nav('down', 'left', 'left');
    check('All apps focus reaches an input', (await state()).focusAction === 'apps.open.' + PC, (await state()).focusAction);
    await current.keyboard.down('Enter'); await current.waitForFunction(() => __tv.calls.length === 6, null, { timeout: 2000 }); await current.keyboard.up('Enter');
    status = await focusStatus();
    check('Holding OK on an input shows the bridge refusal', same(await lastCall(), ['closeApp', PC]) && status.on && status.text === 'Inputs can’t be closed.', status);
    await current.keyboard.press('Enter');
    check('A short OK opens the input', same(await lastCall(), ['launch', PC]));
    await scene('home'); await nav('up', 'right', 'right');
    check('Remote focus reaches the Settings control', (await state()).focusAction === 'util.settings');
    const count = (await calls()).length;
    await current.keyboard.down('Enter');
    check('Other controls act when OK goes down', (await call('where')).view === 'settings');
    await current.waitForTimeout(800); await current.keyboard.up('Enter');
    check('Holding OK on a control closes nothing', (await calls()).length === count && (await call('where')).view === 'settings');
  });
  await run('ADB configuration at start', async () => {
    const config = { home: ['netflix', PC, 'primevideo'], layout: 'list', clock: '12', source: 'bing', wall: BING[1].id, mode: '15' };
    await page({ seed: undefined, config: JSON.stringify(config) });
    let s = await state();
    check('Configuration sets Home order and selects its first app', same(s.dock, config.home) && s.selected === 'netflix' && s.focusAction === 'home.app.netflix', s);
    check('Configuration sets layout, clock, photo source, photo and rotation', s.look.layout === 'list' && s.look.clock === '12' && s.look.source === 'bing' && s.wallpaper === BING[1].id && s.shown.wall === BING[1].id && s.mode === '15', s);
    check('Configuration is stored at once', same((await stored()).dock, config.home) && (await stored()).look.source === 'bing');
    check('Configuration is taken from the bridge once', (await current.evaluate(() => __tv.reads.config)) === 1);
    await look({ layout: 'dock' }); await current.reload(); await ready();
    s = await state();
    check('A consumed configuration is not applied again', s.look.layout === 'dock' && same(s.dock, config.home), s.look);
    await closePage();
    await page({ seed: baseline({ look: { controls: 'text', bg: 'photo', clock: '24' } }), config: JSON.stringify({ clock: '12', home: [PC, 'youtube'] }) });
    s = await state();
    check('Configuration changes only the settings it names', s.look.clock === '12' && s.look.controls === 'text' && same(s.dock, [PC, 'youtube']) && s.wallpaper === walls[0].id, s);
    await closePage();
    await page({ config: '{oops' });
    s = await state();
    check('A malformed configuration is ignored', same(s.dock, HOME) && s.look.layout === 'dock' && s.look.clock === '24', s);
  });
  await run('Clock format follows the TV and the Layout setting', async () => {
    const time = { timezoneId: 'UTC', systemTime: '2026-10-20T15:07:10Z' };
    await page(time);
    check('24-hour TV default shows 15:07', (await state()).look.clock === '24' && (await clockText()) === '15:07', await clockText());
    await group('layout'); await choice('clock', '12'); await ready();
    check('12-hour choice shows 3:07 without AM/PM', (await clockText()) === '3:07' && (await stored()).look.clock === '12', await clockText());
    check('Clock choice marks only 12-hour', same((await radios()).filter(r => r.action.startsWith('choice.clock.') && r.checked === 'true').map(r => r.action), ['choice.clock.12']));
    await current.reload(); await ready();
    check('Clock format survives reload', (await state()).look.clock === '12' && (await clockText()) === '3:07');
    await closePage();
    await page({ ...time, is24: false });
    check('12-hour TV default is used when no clock is saved', (await state()).look.clock === '12' && (await clockText()) === '3:07', await clockText());
    await closePage();
    await page({ ...time, is24: false, seed: baseline({ look: { clock: '24' } }) });
    check('A saved clock format wins over the TV default', (await state()).look.clock === '24' && (await clockText()) === '15:07');
    await closePage();
    await page({ timezoneId: 'UTC', systemTime: '2026-10-20T00:05:10Z', is24: false });
    check('12-hour midnight shows 12:05', (await clockText()) === '12:05', await clockText());
    await look({ clock: '24' });
    check('24-hour midnight shows 0:05', (await clockText()) === '0:05', await clockText());
    await look({ layout: 'list' });
    check('List layout shows the same clock', (await clockText()) === '0:05');
  });
  await run('Physical-key repeats and Back hierarchy', async () => {
    await page(); await editor(); await remove('netflix');
    await current.keyboard.down('Enter'); await current.keyboard.down('Enter');
    check('Held OK restores once without removing again', (await state()).dock.includes('netflix') && (await state()).dock.length === 9);
    await current.keyboard.up('Enter');
    await current.keyboard.down('Escape'); await current.keyboard.down('Escape');
    check('Held Back closes one layer only', (await call('where')).view === 'settings' && (await state()).focusAction === 'settings.editor');
    await current.keyboard.up('Escape'); await current.keyboard.press('Escape');
    check('Released Back reaches Home', (await call('where')).view === 'home');
  });
  await run('Rotation pauses and warm return', async () => {
    await page({ minuteMs: 120 });
    await group('background'); await act('background.rotation'); await act('rotation.5'); await scene('home');
    const first = (await state()).wallpaper;
    await current.waitForFunction(id => ShoreQA.state().wallpaper !== id, first, { timeout: 4000 });
    check('Timed rotation advances on photo Home', (await state()).mode === '5');
    await scene('settings'); const paused = (await state()).wallpaper; await current.waitForTimeout(850);
    check('Rotation pauses in settings', (await state()).wallpaper === paused);
    await scene('home'); await current.evaluate(() => __setHidden(true)); const hidden = (await state()).wallpaper; await current.waitForTimeout(850);
    check('Rotation pauses when hidden', (await state()).wallpaper === hidden);
    await current.evaluate(() => __setHidden(false));
    await current.waitForFunction(id => ShoreQA.state().wallpaper !== id, hidden, { timeout: 4000 });
    await look({ bg: 'dark' }); const flat = (await state()).wallpaper; await current.waitForTimeout(850);
    check('Flat background retains photo without rotation', (await state()).wallpaper === flat);
    await look({ bg: 'photo', layout: 'list' }); const photoList = (await state()).wallpaper;
    await current.waitForFunction(id => ShoreQA.state().wallpaper !== id, photoList, { timeout: 4000 });
    check('Photo List rotates too', (await state()).look.layout === 'list');
    await current.evaluate(() => { __setHidden(true); document.getElementById('stage').blur(); __setHidden(false); window.dispatchEvent(new Event('focus')); });
    const focus = (await state()).focusAction; await current.keyboard.press('ArrowDown');
    check('Warm return restores remote focus', (await state()).focusAction !== focus && (await call('where')).focusCount === 1);
    const clock = await current.locator('#caption .clock').textContent();
    check('Live clock has no AM/PM or seconds', /^\s*\d{1,2}:\d{2}\s*$/.test(clock), clock);
  });
  await run('Open rotation and browser fallback', async () => {
    await page({ seed: baseline({ mode: 'open' }) }); check('Open mode advances at cold start', (await state()).wallpaper === walls[1].id);
    const first = (await state()).wallpaper;
    await current.evaluate(() => { __setHidden(true); __setHidden(false); window.dispatchEvent(new Event('focus')); });
    check('Warm return does not repeat open rotation', (await state()).wallpaper === first);
    await current.reload(); await ready(); check('Next cold start advances again', (await state()).wallpaper === walls[2].id);
    await closePage();
    await page({ mock: false }); await act('home.app.netflix'); await current.waitForFunction(() => ShoreQA.where().view === 'message');
    check('Browser launch honestly requires TV', /needs the TV/.test(await current.locator('#stage').innerText()));
    await nav('back'); await library();
    const names = await libraryNames();
    check('Browser All apps shows the fixed preview catalogue', names.includes('RaiPlay') && names.includes('PC') && !names.includes(UNSAFE_NAME), names);
    await nav('right');
    await current.keyboard.down('Enter'); await current.waitForTimeout(800); await current.keyboard.up('Enter');
    const status = await focusStatus();
    check('Browser hold-to-close honestly requires TV', status.on && /needs the TV/.test(status.text) && (await call('where')).view === 'apps', status);
    await group('android'); await act('android.settings'); await current.waitForFunction(() => ShoreQA.where().view === 'message');
    check('Browser TV settings honestly requires TV', /needs the TV/.test(await current.locator('#stage').innerText()));
  });
  section = 'Run integrity';
  report.sourceAfter = hashes();
  check('No unexpected browser/resource failures', report.pageErrors.length === 0, report.pageErrors);
  check('Sources stayed stable during run', same(report.sourceBefore, report.sourceAfter));
} catch (error) { report.failures.push({ section, error: error.stack }); }
finally {
  await closePage();
  if (preview) await preview.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(out + 'checks.json', JSON.stringify(report, null, 2) + '\n');
}
console.log(report.checks.filter(c => c.passed).length + ' checks passed; ' + report.failures.length + ' failure(s). Report: .local/qa/checks.json');
if (report.failures.length) process.exitCode = 1;
