import { LOCALES, ensureLocale, loadAllLocales, localeDir, nextRadioIndex, resolveLocale, t } from './i18n.js';
import { invitationFromHref } from './join-link.js';
import { SIZES, THEME_COLORS, THEMES, resolveSize, resolveTheme, resolvedScheme } from './theme.js';

export const SESSION_KEY = 'boffin.session';
export const CREDENTIALS_KEY = 'boffin.credentials';
export const LEGACY_TOKEN_KEY = 'boffin.accessToken';
export const LOCALE_KEY = 'boffin.locale';
export const THEME_KEY = 'boffin.theme';
export const SIZE_KEY = 'boffin.size';
export const RADIO_NAV_KEYS = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];
export const THEME_LABELS = {
  light: 'themeLight',
  dark: 'themeDark',
  system: 'themeSystem',
};
export const SIZE_LABELS = {
  default: 'sizeDefault',
  large: 'sizeLarge',
};

export const landingEl = {
  root: document.getElementById('landing'),
  demo: document.getElementById('landing-demo'),
  play: document.getElementById('demo-play'),
  language: document.getElementById('landing-language'),
  languageFlag: document.getElementById('landing-language-flag'),
  languagePanel: document.getElementById('landing-language-panel'),
  settings: document.getElementById('landing-settings'),
  settingsPanel: document.getElementById('landing-settings-panel'),
  status: document.getElementById('landing-status'),
  theme: document.getElementById('landing-theme'),
  themeLabel: document.getElementById('landing-theme-label'),
  size: document.getElementById('landing-size'),
  sizeLabel: document.getElementById('landing-size-label'),
  locale: document.getElementById('landing-locale'),
  localeLabel: document.getElementById('landing-locale-label'),
  tagline: document.getElementById('landing-tagline'),
  signIn: document.getElementById('landing-signin'),
  invite: document.getElementById('landing-invite'),
};

function readJoinId() {
  const { joinId, path } = invitationFromHref(location.href);
  if (path !== null) {
    history.replaceState(null, '', path);
  }
  return joinId;
}

export const authGate = { started: false, invite: null };
export let joinId = readJoinId();
export let locale = readStoredLocale();
export let theme = readStoredTheme();
export let size = readStoredSize();

try {
  await ensureLocale(locale);
} catch {
  locale = 'en';
  await ensureLocale(locale);
}

const extraLocaleGroups = new Map();
const localeTriggerHosts = new Map();
let flagSerial = 0;
let flagMarkup = null;
let localePickersPromise = null;
let localeCatalogsPromise = null;
let localeChangeGeneration = 0;
let paintChrome = applyLandingChrome;
let afterLandingSettingsToggle = () => {};
let onChromeError = () => {};
let landingStatus = () => '';
let landingStatusAlert = false;

export function paintStatusMessage(node, text, alert) {
  if (!node) {
    return;
  }
  const message = text || '';
  const isAlert = Boolean(message) && Boolean(alert);
  node.classList.toggle('is-alert', isAlert);
  const role = isAlert ? 'alert' : 'status';
  if (node.getAttribute('role') !== role) {
    node.setAttribute('role', role);
  }
  node.hidden = !message;
  if (node.textContent !== message) {
    node.textContent = message;
  }
}

export function msg(key, vars) {
  return t(locale, key, vars);
}

export function setPaintChrome(fn) {
  paintChrome = fn;
}

export function setAfterLandingSettingsToggle(fn) {
  afterLandingSettingsToggle = fn;
}

export function setOnChromeError(fn) {
  onChromeError = fn;
}

export function setLandingStatus(message, { alert = false } = {}) {
  landingStatus = typeof message === 'function' ? message : () => message || '';
  landingStatusAlert = Boolean(alert);
  paintLandingStatus();
}

export function currentLandingStatus() {
  return landingStatus;
}

export function currentLandingStatusAlert() {
  return landingStatusAlert;
}

function paintLandingStatus() {
  paintStatusMessage(landingEl.status, landingStatus() || '', landingStatusAlert);
}

function storedSession() {
  try {
    return localStorage.getItem(SESSION_KEY) || null;
  } catch {
    return null;
  }
}

export function peekSession() {
  // The password and the pre-session token are not kept, including on a visit that never loads the app.
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Storage can be unavailable; the old token then stays until a later visit.
  }
  try {
    localStorage.removeItem(CREDENTIALS_KEY);
  } catch {
    // A missing store still leaves the page signed out.
  }
  return storedSession();
}

function readStoredLocale() {
  let stored = '';
  try {
    stored = localStorage.getItem(LOCALE_KEY) ?? '';
  } catch {
    stored = '';
  }
  return resolveLocale([stored, ...(navigator.languages ?? []), navigator.language]);
}

export function storeLocale(next) {
  locale = next;
  try {
    localStorage.setItem(LOCALE_KEY, next);
  } catch {
    // Storage can be unavailable; the choice then lasts for this page only.
  }
}

function readStoredTheme() {
  let stored = '';
  try {
    stored = localStorage.getItem(THEME_KEY) ?? '';
  } catch {
    stored = '';
  }
  return resolveTheme(stored);
}

export function storeTheme(next) {
  theme = resolveTheme(next);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage can be unavailable; the choice then lasts for this page only.
  }
}

function readStoredSize() {
  let stored = '';
  try {
    stored = localStorage.getItem(SIZE_KEY) ?? '';
  } catch {
    stored = '';
  }
  return resolveSize(stored);
}

export function storeSize(next) {
  size = resolveSize(next);
  try {
    localStorage.setItem(SIZE_KEY, size);
  } catch {
    // Storage can be unavailable; the choice then lasts for this page only.
  }
}

export function applySize() {
  if (size === 'large') {
    document.documentElement.dataset.size = 'large';
    return;
  }
  document.documentElement.removeAttribute('data-size');
}

export function prefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme() {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.dataset.theme = theme;
  }
  const scheme = resolvedScheme(theme, prefersDark());
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  if (theme === 'system') {
    const [light, dark] = metas;
    if (light) {
      light.media = '(prefers-color-scheme: light)';
      light.content = THEME_COLORS.light;
    }
    if (dark) {
      dark.media = '(prefers-color-scheme: dark)';
      dark.content = THEME_COLORS.dark;
    }
    return;
  }
  for (const meta of metas) {
    meta.removeAttribute('media');
    meta.content = THEME_COLORS[scheme];
  }
}

export function fillThemePicker(group) {
  group.replaceChildren();
  for (const id of THEMES) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'theme-option';
    option.role = 'radio';
    option.dataset.theme = id;
    option.textContent = msg(THEME_LABELS[id]);
    group.append(option);
  }
  syncThemePicker(group);
}

export function syncThemePicker(group, selected = theme, translate = msg) {
  for (const option of group.querySelectorAll('.theme-option')) {
    option.textContent = translate(THEME_LABELS[option.dataset.theme]);
    const on = option.dataset.theme === selected;
    option.setAttribute('aria-checked', on ? 'true' : 'false');
    option.tabIndex = on ? 0 : -1;
  }
}

export function onThemeClick(event) {
  const option = event.target.closest('.theme-option');
  if (!option) {
    return;
  }
  storeTheme(option.dataset.theme);
  paintChrome();
}

export function fillSizePicker(group) {
  group.replaceChildren();
  for (const id of SIZES) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'theme-option';
    option.role = 'radio';
    option.dataset.size = id;
    option.textContent = msg(SIZE_LABELS[id]);
    group.append(option);
  }
  syncSizePicker(group);
}

export function syncSizePicker(group, selected = size, translate = msg) {
  for (const option of group.querySelectorAll('.theme-option')) {
    option.textContent = translate(SIZE_LABELS[option.dataset.size]);
    const on = option.dataset.size === selected;
    option.setAttribute('aria-checked', on ? 'true' : 'false');
    option.tabIndex = on ? 0 : -1;
  }
}

export function onSizeClick(event) {
  const option = event.target.closest('.theme-option');
  if (!option) {
    return;
  }
  storeSize(option.dataset.size);
  paintChrome();
}

export function onSizeKey(event) {
  if (!RADIO_NAV_KEYS.includes(event.key)) {
    return;
  }
  const options = [...event.currentTarget.querySelectorAll('.theme-option')];
  const index = options.findIndex((option) => option.dataset.size === size);
  const next = nextRadioIndex(event.key, index, options.length, localeDir(locale));
  event.preventDefault();
  options[next].focus();
  storeSize(options[next].dataset.size);
  paintChrome();
}

export function onThemeKey(event) {
  if (!RADIO_NAV_KEYS.includes(event.key)) {
    return;
  }
  const options = [...event.currentTarget.querySelectorAll('.theme-option')];
  const index = options.findIndex((option) => option.dataset.theme === theme);
  const next = nextRadioIndex(event.key, index, options.length, localeDir(locale));
  event.preventDefault();
  options[next].focus();
  storeTheme(options[next].dataset.theme);
  paintChrome();
}

function createFlag(localeId) {
  const host = document.createElement('span');
  host.innerHTML = flagMarkup(localeId).replaceAll('{id}', `flag-${flagSerial++}`);
  const svg = host.firstElementChild;
  svg.classList.add('flag');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

function loadFlagMarkup() {
  if (!localePickersPromise) {
    localePickersPromise = import('./flags.js')
      .then((module) => {
        flagMarkup = module.flagMarkup;
      })
      .catch((error) => {
        localePickersPromise = null;
        throw error;
      });
  }
  return localePickersPromise;
}

export function registerLocaleTrigger(host, getSelected = () => locale) {
  if (!host) {
    return;
  }
  localeTriggerHosts.set(host, getSelected);
  paintLocaleTrigger(host, getSelected());
  // The button is only the flag, so load that artwork without the other catalogs.
  loadFlagMarkup()
    .then(() => paintLocaleTrigger(host, getSelected()))
    .catch((error) => onChromeError(error));
}

export function paintLocaleTrigger(host, selected = locale) {
  if (!host || !flagMarkup) {
    return;
  }
  host.replaceChildren(createFlag(selected));
}

export function paintLocaleTriggers() {
  for (const [host, getSelected] of localeTriggerHosts) {
    paintLocaleTrigger(host, getSelected());
  }
}

function paintLocalePickers() {
  fillLocalePicker(landingEl.locale);
  for (const [group, getSelected] of extraLocaleGroups) {
    fillLocalePicker(group, getSelected());
  }
  paintLocaleTriggers();
}

export function registerLocaleGroup(group, getSelected = () => locale) {
  extraLocaleGroups.set(group, getSelected);
  fillLocalePicker(group, getSelected());
}

export function ensureLocalePickers() {
  if (!localeCatalogsPromise) {
    localeCatalogsPromise = loadAllLocales().catch((error) => {
      localeCatalogsPromise = null;
      throw error;
    });
  }
  // Paint from the flags. A failed catalog prefetch retries on the next open.
  return Promise.all([
    loadFlagMarkup().then(paintLocalePickers),
    localeCatalogsPromise,
  ]);
}

export function fillLocalePicker(group, selected = locale) {
  if (!group || !flagMarkup) {
    return;
  }
  group.replaceChildren();
  for (const item of LOCALES) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'lang-option';
    option.role = 'radio';
    option.dataset.locale = item.id;
    option.lang = item.id;
    option.append(createFlag(item.id), document.createTextNode(item.label));
    group.append(option);
  }
  syncLocalePicker(group, selected);
}

export function syncLocalePicker(group, selected = locale) {
  if (!group) {
    return;
  }
  for (const option of group.querySelectorAll('.lang-option')) {
    const on = option.dataset.locale === selected;
    option.setAttribute('aria-checked', on ? 'true' : 'false');
    option.tabIndex = on ? 0 : -1;
  }
}

export function onLocaleClick(event) {
  const option = event.target.closest('.lang-option');
  if (!option) {
    return;
  }
  changeLocale(option.dataset.locale).catch(onChromeError);
}

export function onLocaleKey(event) {
  if (!RADIO_NAV_KEYS.includes(event.key)) {
    return;
  }
  const options = [...event.currentTarget.querySelectorAll('.lang-option')];
  const index = options.findIndex((option) => option.dataset.locale === locale);
  const next = nextRadioIndex(event.key, index, options.length, localeDir(locale));
  event.preventDefault();
  options[next].focus();
  changeLocale(options[next].dataset.locale).catch(onChromeError);
}

export async function changeLocale(next) {
  const id = resolveLocale([next]);
  const generation = ++localeChangeGeneration;
  await ensureLocale(id);
  if (generation !== localeChangeGeneration) {
    return;
  }
  storeLocale(id);
  paintLocaleTriggers();
  paintChrome();
}

export function applyLandingChrome() {
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDir(locale);
  landingEl.language?.setAttribute('aria-label', msg('language'));
  landingEl.settings.setAttribute('aria-label', msg('settings'));
  landingEl.themeLabel.textContent = msg('theme');
  landingEl.sizeLabel.textContent = msg('size');
  applyTheme();
  applySize();
  syncThemePicker(landingEl.theme);
  syncSizePicker(landingEl.size);
  landingEl.localeLabel.textContent = msg('language');
  syncLocalePicker(landingEl.locale);
  landingEl.tagline.textContent = msg('landingTagline');
  landingEl.signIn.textContent = msg('landingSignIn');
  if (landingEl.play?.isConnected) {
    landingEl.play.setAttribute('aria-label', msg('demoPlay'));
  }
  applyLandingGate();
  paintLandingStatus();
}

export function applyLandingGate() {
  const invite = authGate.invite;
  landingEl.signIn.hidden = Boolean(invite);
  // A stored session is still booting the app; Start would race bootstrap.
  landingEl.signIn.disabled = Boolean(storedSession());
  landingEl.invite.hidden = !invite;
  if (invite) {
    landingEl.invite.textContent = msg('landingInvite', { name: invite.ownerName });
  }
}

export function setLandingLanguageOpen(open) {
  if (!landingEl.languagePanel) {
    return;
  }
  landingEl.languagePanel.hidden = !open;
  landingEl.language?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    setLandingSettingsOpen(false);
    ensureLocalePickers().catch((error) => onChromeError(error));
    afterLandingSettingsToggle();
  }
}

export function setLandingSettingsOpen(open) {
  landingEl.settingsPanel.hidden = !open;
  landingEl.settings.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    setLandingLanguageOpen(false);
    afterLandingSettingsToggle();
  }
}

export function isLandingLanguageTarget(node) {
  return Boolean(node) && (landingEl.language?.contains(node) || landingEl.languagePanel?.contains(node));
}

export function isLandingSettingsTarget(node) {
  return Boolean(node) && (landingEl.settings.contains(node) || landingEl.settingsPanel.contains(node));
}

export function isLandingChromeMenuTarget(node) {
  return isLandingLanguageTarget(node) || isLandingSettingsTarget(node);
}

export async function refreshAuthGate() {
  const response = joinId
    ? await fetch('/api/auth/status', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ join: joinId }),
      })
    : await fetch('/api/auth/status', { cache: 'no-store' });
  if (!response.ok) {
    const raw = await readErrorText(response);
    const error = new Error(raw || `Request failed (${response.status}).`);
    error.status = response.status;
    error.raw = raw;
    throw error;
  }
  const body = await response.json();
  authGate.started = Boolean(body.started);
  authGate.invite = body.invite ?? null;
  applyLandingGate();
}

async function readErrorText(response) {
  try {
    const data = await response.json();
    if (data && typeof data.error === 'string') {
      return data.error;
    }
  } catch {
    // A non-JSON body still needs a status line.
  }
  return '';
}

export function clearJoinParam() {
  if (!joinId) {
    return;
  }
  joinId = null;
  const url = new URL(location.href);
  url.searchParams.delete('join');
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const hashParams = new URLSearchParams(hash);
  if (hashParams.has('join')) {
    hashParams.delete('join');
    const nextHash = hashParams.toString();
    url.hash = nextHash ? `#${nextHash}` : '';
  }
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export function bindLandingChromeEvents() {
  registerLocaleTrigger(landingEl.languageFlag);
  landingEl.language?.addEventListener('click', () => {
    const open = landingEl.languagePanel.hidden;
    setLandingLanguageOpen(open);
  });
  landingEl.settings.addEventListener('click', () => {
    const open = landingEl.settingsPanel.hidden;
    setLandingSettingsOpen(open);
  });
  landingEl.locale.addEventListener('click', onLocaleClick);
  landingEl.locale.addEventListener('keydown', onLocaleKey);
  landingEl.theme.addEventListener('click', onThemeClick);
  landingEl.size.addEventListener('click', onSizeClick);
  landingEl.theme.addEventListener('keydown', onThemeKey);
  landingEl.size.addEventListener('keydown', onSizeKey);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme === 'system') {
      applyTheme();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!isLandingChromeMenuTarget(event.target)) {
      setLandingLanguageOpen(false);
      setLandingSettingsOpen(false);
    }
  });
  document.addEventListener('focusin', (event) => {
    if (!isLandingChromeMenuTarget(event.target)) {
      setLandingLanguageOpen(false);
      setLandingSettingsOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) {
      return;
    }
    if (!landingEl.languagePanel.hidden) {
      setLandingLanguageOpen(false);
      landingEl.language?.focus();
      return;
    }
    if (!landingEl.settingsPanel.hidden) {
      setLandingSettingsOpen(false);
      landingEl.settings.focus();
    }
  });
}
