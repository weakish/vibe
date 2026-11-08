import { applyOp } from '../shared/transcript.js';
import { conversationLogFilename, formatConversationLog } from '../shared/export.js';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../shared/limits.js';
import { flagMarkup } from './flags.js';
import { LOCALES, localeDir, nextRadioIndex, resolveLocale, splitMarked, t, translateError } from './i18n.js';
import { memberHue } from './member-color.js';
import { SIZES, THEME_COLORS, THEMES, resolveSize, resolveTheme, resolvedScheme } from './theme.js';
import { renderMarkdown } from './markdown.js';
import { createJoinPasskey, createPasskey, getPasskey, JoinDeclinedError, supportsPasskey } from './passkey.js';
import { readWithStallTimeout } from './stream.js';

const SESSION_KEY = 'boffin.session';
const CREDENTIALS_KEY = 'boffin.credentials';
const LOCALE_KEY = 'boffin.locale';
const STATIC_ASSET_MODES = ['dev', 'release'];
const STATIC_ASSET_LABELS = { dev: 'staticAssetsDevelopment', release: 'staticAssetsRelease' };
const RADIO_NAV_KEYS = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];
const THEME_KEY = 'boffin.theme';
const SIZE_KEY = 'boffin.size';
const THEME_LABELS = {
  light: 'themeLight',
  dark: 'themeDark',
  system: 'themeSystem',
};
const SIZE_LABELS = {
  default: 'sizeDefault',
  large: 'sizeLarge',
};
const LEGACY_TOKEN_KEY = 'boffin.accessToken';
const POLL_INTERVAL_MS = 1500;
const RETRY_INTERVAL_MS = 4000;
const STREAM_STALL_MS = 45000;
const NEAR_BOTTOM_PX = 160;
const DEMO_MODEL = 'composer-2.5';
const DEMO_MEMBERS = [
  { id: 'demo-ryu', name: 'Ryu', owner: false },
  { id: 'demo-ken', name: 'Ken', owner: false },
];
const DEMO_ALUMNI = [{ id: 'demo-bea', name: 'Bea', owner: false }];
const DEMO_SPEC_KEEP = 'use the same ';
const DEMO_SPEC_DELETE_WORD = 'color';
const DEMO_SPEC_TYPE_WORD = 'background color';
const DEMO_SPEC_PHRASE = `${DEMO_SPEC_KEEP}${DEMO_SPEC_DELETE_WORD}`;
const DEMO_SPEC_FILL_PHRASE = `${DEMO_SPEC_KEEP}${DEMO_SPEC_TYPE_WORD}`;
const DEMO_SPEC_DELETE_MS = 95;
const DEMO_SPEC_TYPE_MS = 110;
const DEMO_SPEC_SETTLE_MS = 280;
const DEMO_GAP_MS = 520;
const DEMO_TYPING_MS = 640;
const DEMO_STREAM_MS = 14;
const DEMO_REFRESH_MS = 720;
const DEMO_REFRESH_MID_MS = 320;
const DEMO_SPEC = `This is just a demo of the spec page, defining the spec of the assistant.

# Conversation

The page lists the people in the active conversation. A user message shows the name of the person who sent it, and that person's messages use their own color. The people list and the names in the header ${DEMO_SPEC_PHRASE}.

More specifications omitted.
`;
const coarsePointer = window.matchMedia('(pointer: coarse)');

const el = {
  app: document.getElementById('app'),
  status: document.getElementById('status'),
  exportLog: document.getElementById('export-log'),
  invite: document.getElementById('invite'),
  people: document.getElementById('people'),
  passkeys: document.getElementById('passkeys'),
  passkeysDialog: document.getElementById('passkeys-dialog'),
  passkeysTitle: document.getElementById('passkeys-title'),
  passkeyEntries: document.getElementById('passkey-entries'),
  passkeysStatus: document.getElementById('passkeys-status'),
  passkeyAdd: document.getElementById('passkey-add'),
  passkeyLabel: document.getElementById('passkey-label'),
  passkeysClose: document.getElementById('passkeys-close'),
  logOut: document.getElementById('log-out'),
  peopleLine: document.getElementById('people-line'),
  peopleDialog: document.getElementById('people-dialog'),
  peopleTitle: document.getElementById('people-title'),
  peopleMembers: document.getElementById('people-members'),
  previousTitle: document.getElementById('previous-title'),
  previousPeople: document.getElementById('previous-people'),
  pendingTitle: document.getElementById('pending-title'),
  pendingInvites: document.getElementById('pending-invites'),
  peopleStatus: document.getElementById('people-status'),
  peopleClose: document.getElementById('people-close'),
  conversationList: document.getElementById('conversation-list'),
  conversationListTitle: document.getElementById('conversation-list-title'),
  conversationEntries: document.getElementById('conversation-entries'),
  specLink: document.getElementById('spec-link'),
  newChat: document.getElementById('new-chat'),
  settings: document.getElementById('settings'),
  settingsPanel: document.getElementById('settings-panel'),
  locale: document.getElementById('locale'),
  localeLabel: document.getElementById('locale-label'),
  staticAssetsField: document.getElementById('static-assets-field'),
  staticAssets: document.getElementById('static-assets'),
  staticAssetsLabel: document.getElementById('static-assets-label'),
  staticAssetsStatus: document.getElementById('static-assets-status'),
  theme: document.getElementById('theme'),
  themeLabel: document.getElementById('theme-label'),
  size: document.getElementById('size'),
  sizeLabel: document.getElementById('size-label'),
  empty: document.getElementById('empty'),
  emptyTitle: document.getElementById('empty-title'),
  messages: document.getElementById('messages'),
  transcript: document.getElementById('transcript'),
  typing: document.getElementById('typing'),
  input: document.getElementById('input'),
  pending: document.getElementById('pending'),
  attach: document.getElementById('attach'),
  files: document.getElementById('files'),
  send: document.getElementById('send'),
  landing: document.getElementById('landing'),
  landingDemo: document.getElementById('landing-demo'),
  landingSettings: document.getElementById('landing-settings'),
  landingSettingsPanel: document.getElementById('landing-settings-panel'),
  landingStatus: document.getElementById('landing-status'),
  landingTheme: document.getElementById('landing-theme'),
  landingThemeLabel: document.getElementById('landing-theme-label'),
  landingSize: document.getElementById('landing-size'),
  landingSizeLabel: document.getElementById('landing-size-label'),
  landingLocale: document.getElementById('landing-locale'),
  landingLocaleLabel: document.getElementById('landing-locale-label'),
  landingTagline: document.getElementById('landing-tagline'),
  landingSignIn: document.getElementById('landing-signin'),
  landingInvite: document.getElementById('landing-invite'),
  demoSettings: document.getElementById('demo-settings'),
  demoSettingsPanel: document.getElementById('demo-settings-panel'),
  demoTheme: document.getElementById('demo-theme'),
  demoThemeLabel: document.getElementById('demo-theme-label'),
  demoSize: document.getElementById('demo-size'),
  demoSizeLabel: document.getElementById('demo-size-label'),
  demoLocale: document.getElementById('demo-locale'),
  demoLocaleLabel: document.getElementById('demo-locale-label'),
  demoExport: document.getElementById('demo-export'),
  demoMembers: document.getElementById('demo-members'),
  demoPasskeys: document.getElementById('demo-passkeys'),
  demoPasskeysDialog: document.getElementById('demo-passkeys-dialog'),
  demoPasskeysTitle: document.getElementById('demo-passkeys-title'),
  demoPasskeysBody: document.getElementById('demo-passkeys-body'),
  demoPasskeysClose: document.getElementById('demo-passkeys-close'),
  demoAttachDialog: document.getElementById('demo-attach-dialog'),
  demoAttachTitle: document.getElementById('demo-attach-title'),
  demoAttachBody: document.getElementById('demo-attach-body'),
  demoAttachClose: document.getElementById('demo-attach-close'),
  demoInviteDialog: document.getElementById('demo-invite-dialog'),
  demoInviteTitle: document.getElementById('demo-invite-title'),
  demoInviteBody: document.getElementById('demo-invite-body'),
  demoInviteClose: document.getElementById('demo-invite-close'),
  demoLogOut: document.getElementById('demo-log-out'),
  demoLogOutDialog: document.getElementById('demo-log-out-dialog'),
  demoLogOutTitle: document.getElementById('demo-log-out-title'),
  demoLogOutBody: document.getElementById('demo-log-out-body'),
  demoLogOutClose: document.getElementById('demo-log-out-close'),
  demoSpec: document.getElementById('demo-spec'),
  demoSpecBack: document.getElementById('demo-spec-back'),
  demoSpecEdit: document.getElementById('demo-spec-edit'),
  demoSpecView: document.getElementById('demo-spec-view'),
  demoSpecStatus: document.getElementById('demo-spec-status'),
  demoSpecRendered: document.getElementById('demo-spec-rendered'),
  demoTitle: document.getElementById('demo-title'),
  demoPeople: document.getElementById('demo-people'),
  demoMessages: document.getElementById('demo-messages'),
  demoTranscript: document.getElementById('demo-transcript'),
  demoTyping: document.getElementById('demo-typing'),
  demoComposer: document.getElementById('demo-composer'),
  demoAttach: document.getElementById('demo-attach'),
  demoInput: document.getElementById('demo-input'),
  demoSend: document.getElementById('demo-send'),
  login: document.getElementById('login'),
  loginForm: document.getElementById('login-form'),
  loginTitle: document.getElementById('login-title'),
  loginHint: document.getElementById('login-hint'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  loginSubmit: document.getElementById('login-submit'),
  loginJoin: document.getElementById('login-join'),
  loginClose: document.getElementById('login-close'),
  loginError: document.getElementById('login-error'),
  loginInviteOnly: document.getElementById('login-invite-only'),
  newChatDialog: document.getElementById('new-chat-dialog'),
  newChatTitle: document.getElementById('new-chat-title'),
  newChatBody: document.getElementById('new-chat-body'),
  newChatExport: document.getElementById('new-chat-export'),
  newChatClear: document.getElementById('new-chat-clear'),
  newChatCancel: document.getElementById('new-chat-cancel'),
  joinWarningDialog: document.getElementById('join-warning-dialog'),
  joinWarningTitle: document.getElementById('join-warning-title'),
  joinWarningText: document.getElementById('join-warning-text'),
  joinWarningContinue: document.getElementById('join-warning-continue'),
  joinWarningCancel: document.getElementById('join-warning-cancel'),
  passkeyWarningDialog: document.getElementById('passkey-warning-dialog'),
  passkeyWarningTitle: document.getElementById('passkey-warning-title'),
  passkeyWarningText: document.getElementById('passkey-warning-text'),
  passkeyWarningContinue: document.getElementById('passkey-warning-continue'),
  passkeyWarningCancel: document.getElementById('passkey-warning-cancel'),
};

const pending = [];
const mediaUrls = new Map();
const mediaLoads = new Map();
let mediaEpoch = 0;

const state = {
  items: [],
  nodes: new Map(),
  model: '',
  you: null,
  canManage: false,
  people: [],
  alumni: [],
  invites: [],
  listing: false,
  busy: false,
  streaming: false,
  following: false,
  stopping: false,
  exporting: false,
  forceScroll: false,
  renderQueued: false,
};

class AuthError extends Error {}

class SessionEndedError extends Error {}

class RequestError extends Error {
  constructor(raw, status) {
    super(raw || `Request failed (${status}).`);
    this.name = 'RequestError';
    this.raw = raw;
    this.status = status;
  }
}

let sessionToken = readSession();
let joinId = new URLSearchParams(location.search).get('join');
let locale = readStoredLocale();
let staticAssetsMode = 'dev';
let staticAssetsStale = false;
let staticAssetsBundling = false;
let staticAssetsBusy = false;
let staticAssetsRefresh = null;
let staticAssetsGeneration = 0;
// False until the server has confirmed the mode, so the picker never shows a guess.
let staticAssetsLoaded = false;
let theme = readStoredTheme();
let size = readStoredSize();
let demoLocale = locale;
let demoTheme = theme;
let demoSize = size;
let demoShowingSpec = false;
let demoSpecText = DEMO_SPEC;
let demoNamesFilled = false;
let demoSpecAnimating = false;
let demoSpecEditRun = 0;
let demoPeople = DEMO_MEMBERS.map((person) => ({ ...person }));
let demoAlumni = DEMO_ALUMNI.map((person) => ({ ...person }));
let peopleDialogDemo = false;
let demoUserTurns = [];
let demoPlayRun = 0;
let demoScriptShown = 0;
let demoPartialText = null;
let demoTyping = false;
let demoExportMoved = false;
const demoNodes = new Map();
let sessionRequest = 0;
// Bumped when a session starts or ends so in-flight work cannot act on the next one.
let chatEpoch = 0;
let renderStatus = () => '';
let renderLoginError = () => '';
let renderPeopleStatus = () => '';
let peopleStatusError = false;
let lastLoginMode = 'password';
let authGate = { started: false, invite: null };
let pendingRegistration = null;

function msg(key, vars) {
  return t(locale, key, vars);
}

function demoMsg(key, vars) {
  return t(demoLocale, key, vars);
}

function readStoredLocale() {
  let stored = '';
  try {
    stored = localStorage.getItem(LOCALE_KEY) ?? '';
  } catch {
    stored = '';
  }
  const requested = [stored, ...(navigator.languages ?? []), navigator.language];
  return resolveLocale(requested);
}

function storeLocale(next) {
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

function storeTheme(next) {
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

function storeSize(next) {
  size = resolveSize(next);
  try {
    localStorage.setItem(SIZE_KEY, size);
  } catch {
    // Storage can be unavailable; the choice then lasts for this page only.
  }
}

function applySize() {
  if (size === 'large') {
    document.documentElement.dataset.size = 'large';
    return;
  }
  document.documentElement.removeAttribute('data-size');
}

function prefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme() {
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

function fillThemePicker(group) {
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

function syncThemePicker(group, selected = theme, translate = msg) {
  for (const option of group.querySelectorAll('.theme-option')) {
    option.textContent = translate(THEME_LABELS[option.dataset.theme]);
    const on = option.dataset.theme === selected;
    option.setAttribute('aria-checked', on ? 'true' : 'false');
    option.tabIndex = on ? 0 : -1;
  }
}

function onThemeClick(event) {
  const option = event.target.closest('.theme-option');
  if (!option) {
    return;
  }
  storeTheme(option.dataset.theme);
  applyChrome();
}

function fillSizePicker(group) {
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

function syncSizePicker(group, selected = size, translate = msg) {
  for (const option of group.querySelectorAll('.theme-option')) {
    option.textContent = translate(SIZE_LABELS[option.dataset.size]);
    const on = option.dataset.size === selected;
    option.setAttribute('aria-checked', on ? 'true' : 'false');
    option.tabIndex = on ? 0 : -1;
  }
}

function onSizeClick(event) {
  const option = event.target.closest('.theme-option');
  if (!option) {
    return;
  }
  storeSize(option.dataset.size);
  applyChrome();
}

function onSizeKey(event) {
  if (!RADIO_NAV_KEYS.includes(event.key)) {
    return;
  }
  const options = [...event.currentTarget.querySelectorAll('.theme-option')];
  const index = options.findIndex((option) => option.dataset.size === size);
  const next = nextRadioIndex(event.key, index, options.length, localeDir(locale));
  event.preventDefault();
  options[next].focus();
  storeSize(options[next].dataset.size);
  applyChrome();
}

function onThemeKey(event) {
  if (!RADIO_NAV_KEYS.includes(event.key)) {
    return;
  }
  const options = [...event.currentTarget.querySelectorAll('.theme-option')];
  const index = options.findIndex((option) => option.dataset.theme === theme);
  const next = nextRadioIndex(event.key, index, options.length, localeDir(locale));
  event.preventDefault();
  options[next].focus();
  storeTheme(options[next].dataset.theme);
  applyChrome();
}

let flagSerial = 0;

function createFlag(localeId) {
  const host = document.createElement('span');
  host.innerHTML = flagMarkup(localeId).replaceAll('{id}', `flag-${flagSerial++}`);
  const svg = host.firstElementChild;
  svg.classList.add('flag');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

function fillLocalePicker(group) {
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
  syncLocalePicker(group);
}

function syncLocalePicker(group, selected = locale) {
  for (const option of group.querySelectorAll('.lang-option')) {
    const on = option.dataset.locale === selected;
    option.setAttribute('aria-checked', on ? 'true' : 'false');
    option.tabIndex = on ? 0 : -1;
  }
}

function applyChrome() {
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDir(locale);
  el.settings.setAttribute('aria-label', msg('settings'));
  el.landingSettings.setAttribute('aria-label', msg('settings'));
  el.themeLabel.textContent = msg('theme');
  el.landingThemeLabel.textContent = msg('theme');
  el.sizeLabel.textContent = msg('size');
  el.landingSizeLabel.textContent = msg('size');
  applyTheme();
  applySize();
  syncThemePicker(el.theme);
  syncThemePicker(el.landingTheme);
  syncSizePicker(el.size);
  syncSizePicker(el.landingSize);
  el.localeLabel.textContent = msg('language');
  el.landingLocaleLabel.textContent = msg('language');
  el.staticAssetsLabel.textContent = msg('staticAssets');
  syncLocalePicker(el.locale);
  syncLocalePicker(el.landingLocale);
  syncStaticAssetsPicker();
  paintStaticAssetsStatus();
  el.landingTagline.textContent = msg('landingTagline');
  el.landingSignIn.textContent = msg('landingSignIn');
  applyLandingGate();
  el.loginInviteOnly.textContent = msg('inviteOnly');
  el.exportLog.textContent = msg('exportLog');
  el.invite.textContent = msg('invite');
  el.people.textContent = msg('people');
  el.passkeys.textContent = msg('passkeys');
  el.passkeysTitle.textContent = msg('passkeys');
  el.passkeyAdd.textContent = msg('addPasskey');
  el.passkeyLabel.placeholder = msg('passkeyLabel');
  el.passkeyLabel.setAttribute('aria-label', msg('passkeyLabel'));
  el.passkeysClose.textContent = msg('cancel');
  el.logOut.textContent = msg('logOut');
  el.specLink.textContent = msg('spec');
  el.newChat.textContent = msg('newChat');
  el.loginJoin.textContent = msg('joinAction');
  el.loginClose.textContent = msg('cancel');
  el.peopleTitle.textContent = msg('people');
  el.previousTitle.textContent = msg('previousPeople');
  el.pendingTitle.textContent = msg('pendingInvites');
  el.peopleClose.textContent = msg('cancel');
  el.conversationListTitle.textContent = msg('conversationList');
  el.emptyTitle.textContent = msg('emptyGreeting');
  el.typing.setAttribute('aria-label', msg('typing'));
  el.input.placeholder = msg('messagePlaceholder');
  el.input.setAttribute('aria-label', msg('messageAria'));
  el.attach.setAttribute('aria-label', msg('attach'));
  renderPending();
  el.loginUsername.placeholder = msg('username');
  el.loginUsername.setAttribute('aria-label', msg('username'));
  for (const when of el.passkeyEntries.querySelectorAll('.passkey-when')) {
    when.textContent = when.dataset.time ? msg('passkeyAddedAt', { time: when.dataset.time }) : '';
  }
  el.loginPassword.placeholder = msg('password');
  el.loginSubmit.textContent = msg('unlock');
  applyLoginMode();
  el.newChatTitle.textContent = msg('newChat');
  el.newChatBody.textContent = msg('confirmNewChat');
  el.newChatExport.textContent = msg('newChatExport');
  el.newChatClear.textContent = msg('newChatClear');
  el.newChatCancel.textContent = msg('cancel');
  el.joinWarningTitle.textContent = msg('joinTitle');
  el.joinWarningText.textContent = msg('joinSameDeviceWarning');
  el.joinWarningContinue.textContent = msg('continueAction');
  el.joinWarningCancel.textContent = msg('cancel');
  el.passkeyWarningTitle.textContent = msg('passkeys');
  el.passkeyWarningText.textContent = msg('manyPasskeysWarning');
  el.passkeyWarningContinue.textContent = msg('continueAction');
  el.passkeyWarningCancel.textContent = msg('cancel');
  el.loginError.textContent = renderLoginError();
  applyStatus();
  applyPeopleStatus();
  updateComposer();
}

function fillMarked(element, template) {
  element.replaceChildren();
  for (const part of splitMarked(template)) {
    if (Object.hasOwn(part, 'code')) {
      const code = document.createElement('code');
      code.dir = 'ltr';
      code.textContent = part.code;
      element.append(code);
      continue;
    }
    element.append(part.text);
  }
}

function applyDemoChrome() {
  el.landingDemo.lang = demoLocale;
  el.landingDemo.dir = localeDir(demoLocale);
  if (demoTheme === 'system') {
    el.landingDemo.removeAttribute('data-theme');
  } else {
    el.landingDemo.dataset.theme = demoTheme;
  }
  if (demoSize === 'large') {
    el.landingDemo.dataset.size = 'large';
  } else {
    el.landingDemo.removeAttribute('data-size');
  }
  el.demoSettings.setAttribute('aria-label', demoMsg('settings'));
  el.demoThemeLabel.textContent = demoMsg('theme');
  el.demoSizeLabel.textContent = demoMsg('size');
  syncThemePicker(el.demoTheme, demoTheme, demoMsg);
  syncSizePicker(el.demoSize, demoSize, demoMsg);
  el.demoLocaleLabel.textContent = demoMsg('language');
  syncLocalePicker(el.demoLocale, demoLocale);
  paintDemoExport();
  el.demoMembers.textContent = demoMsg('people');
  el.demoPasskeys.textContent = demoMsg('passkeys');
  paintDemoSheet(el.demoPasskeysDialog, el.demoPasskeysTitle, el.demoPasskeysBody, el.demoPasskeysClose, 'passkeys', 'demoPasskeysBody');
  paintDemoSheet(el.demoAttachDialog, el.demoAttachTitle, el.demoAttachBody, el.demoAttachClose, 'attach', 'demoAttachBody');
  paintDemoSheet(el.demoInviteDialog, el.demoInviteTitle, el.demoInviteBody, el.demoInviteClose, 'invite', 'demoInviteBody');
  el.demoLogOut.textContent = demoMsg('logOut');
  paintDemoSheet(el.demoLogOutDialog, el.demoLogOutTitle, el.demoLogOutBody, el.demoLogOutClose, 'logOut', 'demoLogOutBody');
  el.demoSpec.textContent = demoMsg('spec');
  el.demoAttach.setAttribute('aria-label', demoMsg('attach'));
  el.demoInput.placeholder = demoMsg('messagePlaceholder');
  el.demoInput.setAttribute('aria-label', demoMsg('messageAria'));
  el.demoSend.setAttribute('aria-label', demoMsg('send'));
  updateDemoComposer();
  renderDemo();
}

function syncDemoView() {
  el.demoSpecBack.hidden = !demoShowingSpec;
  el.demoSpecBack.textContent = demoMsg('specBack');
  el.demoSpecEdit.hidden = !demoShowingSpec;
  el.demoSpecEdit.disabled = demoNamesFilled || demoSpecAnimating;
  el.demoSpecEdit.textContent = demoMsg('specEdit');
  el.landingDemo.classList.toggle('demo-name-fill', demoNamesFilled);
  el.demoMessages.hidden = demoShowingSpec;
  el.demoSpecView.hidden = !demoShowingSpec;
  el.demoComposer.hidden = demoShowingSpec;
  if (!demoShowingSpec) {
    el.demoTitle.textContent = 'Boffin';
    fillPeopleLine(
      el.demoPeople,
      demoPeople.map((person) => person.name),
    );
    return;
  }
  el.demoTitle.textContent = demoMsg('spec');
  el.demoPeople.hidden = true;
}

function paintDemoSpec() {
  el.demoSpecRendered.innerHTML = renderMarkdown(demoSpecText ?? '');
  el.demoSpecStatus.hidden = true;
}

function openDemoSpec() {
  setDemoSettingsOpen(false);
  el.landingDemo.classList.remove('is-refreshing');
  if (demoSpecAnimating) {
    return;
  }
  demoShowingSpec = true;
  syncDemoView();
  paintDemoSpec();
}

function wrapDemoSpecPhrase() {
  const walker = document.createTreeWalker(el.demoSpecRendered, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const phraseIndex = node.textContent.indexOf(DEMO_SPEC_PHRASE);
    if (phraseIndex === -1) {
      node = walker.nextNode();
      continue;
    }
    const index = phraseIndex + DEMO_SPEC_KEEP.length;
    const phraseNode = node.splitText(index);
    phraseNode.splitText(DEMO_SPEC_DELETE_WORD.length);
    const wrap = document.createElement('span');
    wrap.className = 'demo-spec-phrase';
    phraseNode.parentNode.insertBefore(wrap, phraseNode);
    wrap.append(phraseNode);
    return wrap;
  }
  return null;
}

function showDemoCaret(host, before, after, caret) {
  host.replaceChildren();
  if (before) {
    host.append(before);
  }
  host.append(caret);
  if (after) {
    host.append(after);
  }
}

function revealDemoSpecPhrase(wrap) {
  const view = el.demoSpecView;
  const phrase = wrap.getBoundingClientRect();
  const frame = view.getBoundingClientRect();
  view.scrollTop += phrase.top - frame.top - (view.clientHeight - phrase.height) / 2;
}

function finishDemoSpecEdit() {
  demoSpecEditRun += 1;
  demoSpecAnimating = false;
  if (demoSpecText.includes(DEMO_SPEC_PHRASE)) {
    demoSpecText = demoSpecText.replaceAll(DEMO_SPEC_PHRASE, DEMO_SPEC_FILL_PHRASE);
  }
  demoNamesFilled = true;
  paintDemoSpec();
  syncDemoView();
}

async function playDemoSpecEdit(run) {
  paintDemoSpec();
  const wrap = wrapDemoSpecPhrase();
  if (!wrap) {
    finishDemoSpecEdit();
    return;
  }
  revealDemoSpecPhrase(wrap);
  const caret = document.createElement('span');
  caret.className = 'demo-caret';
  caret.setAttribute('aria-hidden', 'true');
  const still = () => run === demoSpecEditRun && demoShowingSpec && demoSpecAnimating;

  for (let index = DEMO_SPEC_DELETE_WORD.length; index >= 0; index -= 1) {
    if (!still()) {
      return;
    }
    showDemoCaret(wrap, DEMO_SPEC_DELETE_WORD.slice(0, index), '', caret);
    await sleep(DEMO_SPEC_DELETE_MS);
  }
  if (!still()) {
    return;
  }
  for (let index = 1; index <= DEMO_SPEC_TYPE_WORD.length; index += 1) {
    if (!still()) {
      return;
    }
    showDemoCaret(wrap, DEMO_SPEC_TYPE_WORD.slice(0, index), '', caret);
    await sleep(DEMO_SPEC_TYPE_MS);
  }
  if (!still()) {
    return;
  }
  await sleep(DEMO_SPEC_SETTLE_MS);
  if (!still()) {
    return;
  }
  focusDemoSpecBackIfIdle();
  finishDemoSpecEdit();
}

function editDemoSpec() {
  if (demoNamesFilled || demoSpecAnimating || !demoSpecText.includes(DEMO_SPEC_PHRASE)) {
    return;
  }
  demoSpecAnimating = true;
  const run = demoSpecEditRun + 1;
  demoSpecEditRun = run;
  el.demoSpecEdit.disabled = true;
  playDemoSpecEdit(run).catch(() => {
    if (demoSpecAnimating && demoSpecEditRun === run) {
      finishDemoSpecEdit();
    }
  });
}

function focusDemoSpecBackIfIdle() {
  const active = document.activeElement;
  const idle = active === el.demoSpecEdit || active === document.body || active === document.documentElement;
  if (idle && !document.getSelection()?.toString()) {
    el.demoSpecBack.focus();
  }
}

function closeDemoSpec() {
  if (demoSpecAnimating) {
    finishDemoSpecEdit();
  }
  demoShowingSpec = false;
  syncDemoView();
}

function onDemoThemeClick(event) {
  const option = event.target.closest('.theme-option');
  if (!option) {
    return;
  }
  demoTheme = resolveTheme(option.dataset.theme);
  applyDemoChrome();
}

function onDemoSizeClick(event) {
  const option = event.target.closest('.theme-option');
  if (!option) {
    return;
  }
  demoSize = resolveSize(option.dataset.size);
  applyDemoChrome();
}

function onDemoSizeKey(event) {
  if (!RADIO_NAV_KEYS.includes(event.key)) {
    return;
  }
  const options = [...event.currentTarget.querySelectorAll('.theme-option')];
  const index = options.findIndex((option) => option.dataset.size === demoSize);
  const next = nextRadioIndex(event.key, index, options.length, localeDir(demoLocale));
  event.preventDefault();
  options[next].focus();
  demoSize = resolveSize(options[next].dataset.size);
  applyDemoChrome();
}

function onDemoThemeKey(event) {
  if (!RADIO_NAV_KEYS.includes(event.key)) {
    return;
  }
  const options = [...event.currentTarget.querySelectorAll('.theme-option')];
  const index = options.findIndex((option) => option.dataset.theme === demoTheme);
  const next = nextRadioIndex(event.key, index, options.length, localeDir(demoLocale));
  event.preventDefault();
  options[next].focus();
  demoTheme = resolveTheme(options[next].dataset.theme);
  applyDemoChrome();
}

function onDemoLocaleClick(event) {
  const option = event.target.closest('.lang-option');
  if (!option) {
    return;
  }
  demoLocale = resolveLocale([option.dataset.locale]);
  applyDemoChrome();
  startDemoConversation();
}

function onDemoLocaleKey(event) {
  if (!RADIO_NAV_KEYS.includes(event.key)) {
    return;
  }
  const options = [...event.currentTarget.querySelectorAll('.lang-option')];
  const index = options.findIndex((option) => option.dataset.locale === demoLocale);
  const next = nextRadioIndex(event.key, index, options.length, localeDir(demoLocale));
  event.preventDefault();
  options[next].focus();
  demoLocale = resolveLocale([options[next].dataset.locale]);
  applyDemoChrome();
  startDemoConversation();
}

function onLocaleClick(event) {
  const option = event.target.closest('.lang-option');
  if (!option) {
    return;
  }
  storeLocale(resolveLocale([option.dataset.locale]));
  applyChrome();
}

function fillStaticAssetsPicker() {
  el.staticAssets.replaceChildren();
  for (const id of STATIC_ASSET_MODES) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'theme-option';
    option.role = 'radio';
    option.dataset.staticAssets = id;
    option.textContent = msg(STATIC_ASSET_LABELS[id]);
    el.staticAssets.append(option);
  }
  syncStaticAssetsPicker();
}

function syncStaticAssetsPicker() {
  for (const option of el.staticAssets.querySelectorAll('.theme-option')) {
    const id = option.dataset.staticAssets;
    option.textContent = msg(STATIC_ASSET_LABELS[id]);
    const on = id === staticAssetsMode;
    option.setAttribute('aria-checked', on ? 'true' : 'false');
    option.tabIndex = on ? 0 : -1;
    option.disabled = staticAssetsBusy || staticAssetsBundling || !staticAssetsLoaded;
  }
}

function paintStaticAssetsStatus() {
  if (!state.canManage || !staticAssetsLoaded) {
    el.staticAssetsStatus.hidden = true;
    return;
  }
  let text = '';
  if (staticAssetsBundling) {
    text = msg('staticAssetsBundling');
  } else if (staticAssetsStale) {
    text = msg('staticAssetsStale');
  } else {
    text = msg(staticAssetsMode === 'release' ? 'staticAssetsReleaseHint' : 'staticAssetsDevelopmentHint');
  }
  el.staticAssetsStatus.textContent = text;
  el.staticAssetsStatus.hidden = !text;
}

function resetStaticAssets() {
  staticAssetsGeneration += 1;
  staticAssetsRefresh = null;
  staticAssetsMode = 'dev';
  staticAssetsStale = false;
  staticAssetsBundling = false;
  staticAssetsBusy = false;
  staticAssetsLoaded = false;
  el.staticAssetsField.hidden = true;
  syncStaticAssetsPicker();
  paintStaticAssetsStatus();
}

function refreshStaticAssets({ fresh = false } = {}) {
  if (fresh) {
    staticAssetsGeneration += 1;
  }
  if (!fresh && staticAssetsRefresh) {
    return { request: staticAssetsRefresh, created: false };
  }
  const generation = staticAssetsGeneration;
  const quiet = staticAssetsLoaded;
  const request = fetchStaticAssets(generation, quiet).finally(() => {
    if (staticAssetsRefresh === request) {
      staticAssetsRefresh = null;
    }
  });
  staticAssetsRefresh = request;
  return { request, created: true };
}

// ifMissing skips a refetch once the server has answered. Session polls use that
// so the picker does not blank on every snapshot. Opening Settings always refetches.
function requestStaticAssets({ ifMissing = false } = {}) {
  if (!state.canManage || staticAssetsBusy) {
    return;
  }
  // Keep polling while another tab holds the lock so the picker unlocks when it finishes.
  if (ifMissing && staticAssetsLoaded && !staticAssetsBundling) {
    return;
  }
  const { request, created } = refreshStaticAssets();
  if (created) {
    request.catch(handleFailure);
  }
}

async function fetchStaticAssets(generation, quiet) {
  if (!quiet) {
    staticAssetsLoaded = false;
    syncStaticAssetsPicker();
    paintStaticAssetsStatus();
  }
  try {
    const response = await api('/api/static-assets');
    if (generation !== staticAssetsGeneration) {
      response.body?.cancel()?.catch(() => {});
      return;
    }
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    const body = await response.json();
    if (generation !== staticAssetsGeneration) {
      return;
    }
    staticAssetsMode = body.mode === 'release' ? 'release' : 'dev';
    staticAssetsStale = Boolean(body.stale);
    staticAssetsBundling = Boolean(body.bundling);
    staticAssetsLoaded = true;
    syncStaticAssetsPicker();
    paintStaticAssetsStatus();
  } catch (error) {
    if (generation !== staticAssetsGeneration) {
      return;
    }
    throw error;
  }
}

async function setStaticAssetsMode(next) {
  // Choosing Release while the bundle is stale rebuilds it.
  const rebuild = next === 'release' && staticAssetsStale;
  if (staticAssetsBusy || staticAssetsBundling || !staticAssetsLoaded || (next === staticAssetsMode && !rebuild)) {
    return;
  }
  staticAssetsGeneration += 1;
  staticAssetsBusy = true;
  staticAssetsBundling = next === 'release';
  syncStaticAssetsPicker();
  paintStaticAssetsStatus();
  let response;
  try {
    response = await api('/api/static-assets', { method: 'PUT', body: { mode: next } });
  } catch (error) {
    staticAssetsBusy = false;
    staticAssetsBundling = false;
    syncStaticAssetsPicker();
    paintStaticAssetsStatus();
    if (error instanceof AuthError || error instanceof SessionEndedError) {
      throw error;
    }
    setStatus(() => msg('cannotReach'));
    return;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 409) {
      // This tab is not the in-flight bundler. Drop this tab's busy flag, then refresh.
      // A successful GET keeps server bundling. A failed refresh keeps the last mode.
      staticAssetsBusy = false;
      try {
        await refreshStaticAssets({ fresh: true }).request;
        syncStaticAssetsPicker();
        paintStaticAssetsStatus();
        return;
      } catch (error) {
        if (error instanceof AuthError || error instanceof SessionEndedError) {
          throw error;
        }
        staticAssetsLoaded = true;
        staticAssetsBundling = false;
        syncStaticAssetsPicker();
        paintStaticAssetsStatus();
        setStatus(() => translateError(locale, body.error) || msg('bundleFailed'));
        return;
      }
    }
    staticAssetsBusy = false;
    staticAssetsBundling = false;
    syncStaticAssetsPicker();
    paintStaticAssetsStatus();
    setStatus(() => translateError(locale, body.error) || msg('bundleFailed'));
    return;
  }
  staticAssetsBusy = false;
  staticAssetsBundling = false;
  staticAssetsMode = body.mode === 'release' ? 'release' : 'dev';
  staticAssetsStale = Boolean(body.stale);
  window.location.reload();
}

function onStaticAssetsClick(event) {
  const option = event.target.closest('.theme-option');
  if (!option || option.disabled) {
    return;
  }
  setStaticAssetsMode(option.dataset.staticAssets).catch(handleFailure);
}

function onStaticAssetsKey(event) {
  if (!RADIO_NAV_KEYS.includes(event.key)) {
    return;
  }
  const options = [...el.staticAssets.querySelectorAll('.theme-option')];
  const index = options.findIndex((option) => option.dataset.staticAssets === staticAssetsMode);
  const next = nextRadioIndex(event.key, index, options.length, localeDir(locale));
  event.preventDefault();
  if (next === index || !options[next] || options[next].disabled) {
    return;
  }
  setStaticAssetsMode(options[next].dataset.staticAssets).catch(handleFailure);
}

function onLocaleKey(event) {
  if (!RADIO_NAV_KEYS.includes(event.key)) {
    return;
  }
  const options = [...event.currentTarget.querySelectorAll('.lang-option')];
  const index = options.findIndex((option) => option.dataset.locale === locale);
  const next = nextRadioIndex(event.key, index, options.length, localeDir(locale));
  event.preventDefault();
  options[next].focus();
  storeLocale(resolveLocale([options[next].dataset.locale]));
  applyChrome();
}

function setLandingSettingsOpen(open) {
  el.landingSettingsPanel.hidden = !open;
  el.landingSettings.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setDemoSettingsOpen(open) {
  el.demoSettingsPanel.hidden = !open;
  el.demoSettings.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setSettingsOpen(open) {
  el.settingsPanel.hidden = !open;
  el.settings.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (!open) {
    setLandingSettingsOpen(false);
    setDemoSettingsOpen(false);
  }
}

function isSettingsTarget(node) {
  return Boolean(node) && (el.settings.contains(node) || el.settingsPanel.contains(node));
}

function isLandingSettingsTarget(node) {
  return Boolean(node) && (el.landingSettings.contains(node) || el.landingSettingsPanel.contains(node));
}

function isDemoSettingsTarget(node) {
  return Boolean(node) && (el.demoSettings.contains(node) || el.demoSettingsPanel.contains(node));
}

function onSettingsClick() {
  const opening = el.settingsPanel.hidden;
  setSettingsOpen(opening);
  if (opening) {
    requestStaticAssets();
  }
}

function onDocumentPointerDown(event) {
  if (!el.settingsPanel.hidden && !isSettingsTarget(event.target)) {
    setSettingsOpen(false);
  }
  if (!el.landingSettingsPanel.hidden && !isLandingSettingsTarget(event.target)) {
    setLandingSettingsOpen(false);
  }
  if (!el.demoSettingsPanel.hidden && !isDemoSettingsTarget(event.target)) {
    setDemoSettingsOpen(false);
  }
}

function onDocumentFocusIn(event) {
  if (!el.settingsPanel.hidden && !isSettingsTarget(event.target)) {
    setSettingsOpen(false);
  }
  if (!el.landingSettingsPanel.hidden && !isLandingSettingsTarget(event.target)) {
    setLandingSettingsOpen(false);
  }
  if (!el.demoSettingsPanel.hidden && !isDemoSettingsTarget(event.target)) {
    setDemoSettingsOpen(false);
  }
}

function onDocumentKeyDown(event) {
  // While any dialog is open it handles Escape, so the settings panels are left alone.
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) {
    return;
  }
  if (!el.landingSettingsPanel.hidden) {
    setLandingSettingsOpen(false);
    el.landingSettings.focus();
  }
  if (!el.demoSettingsPanel.hidden) {
    setDemoSettingsOpen(false);
    el.demoSettings.focus();
  }
  if (!el.settingsPanel.hidden) {
    setSettingsOpen(false);
    el.settings.focus();
  }
}

function readSession() {
  removeLegacyAccessToken();
  try {
    localStorage.removeItem(CREDENTIALS_KEY);
  } catch {
    // The password is not kept. A missing store still leaves the page signed out.
  }
  try {
    return localStorage.getItem(SESSION_KEY) || null;
  } catch {
    return null;
  }
}

function storeSession(token) {
  sessionToken = token;
  chatEpoch += 1;
  try {
    localStorage.setItem(SESSION_KEY, token);
    localStorage.removeItem(CREDENTIALS_KEY);
  } catch {
    // Storage can be unavailable (private mode); the session then lasts for this page only.
  }
  removeLegacyAccessToken();
}

function forgetSession() {
  sessionToken = null;
  sessionRequest += 1;
  chatEpoch += 1;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
  removeLegacyAccessToken();
  resetStaticAssets();
}

function removeLegacyAccessToken() {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Storage can be unavailable; the old token then stays until a later visit.
  }
}

async function api(path, { method = 'GET', body, auth = true, withSession = false } = {}) {
  const epoch = chatEpoch;
  if (auth && !sessionToken) {
    throw epoch === chatEpoch ? new AuthError('Credentials rejected.') : new SessionEndedError();
  }
  const headers = {};
  // withSession lets a request say who is asking without requiring a session.
  if (auth || (withSession && sessionToken)) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }
  const init = { method, headers, cache: 'no-store' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (auth && epoch !== chatEpoch) {
    await response.body?.cancel()?.catch(() => {});
    throw new SessionEndedError();
  }
  if (response.status === 401 && !auth) {
    return response;
  }
  if (response.status === 401) {
    const errorText = await readServerError(response);
    if (isCredentialRejection(errorText)) {
      throw new AuthError('Credentials rejected.');
    }
    throw new RequestError(errorText, 401);
  }
  return response;
}

async function readServerError(response) {
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

function responseStatusText(raw, status) {
  return () => (raw ? translateError(locale, raw) : msg('requestFailed', { status }));
}

async function loadSession() {
  const request = ++sessionRequest;
  let response;
  try {
    response = await api('/api/session');
  } catch (error) {
    if (request !== sessionRequest) {
      return null;
    }
    throw error;
  }
  if (request !== sessionRequest) {
    response.body?.cancel()?.catch(() => {});
    return null;
  }
  if (!response.ok) {
    throw new RequestError(await readServerError(response), response.status);
  }
  const session = await response.json();
  if (request !== sessionRequest) {
    return null;
  }
  if (session.token) {
    storeSession(session.token);
  }
  applySessionIdentity(session);
  if (session.home === 'list') {
    showConversationList(session.conversations ?? []);
    return session;
  }
  showChat(session);
  return session;
}

function applySessionIdentity(session) {
  state.you = session.you ?? null;
  state.canManage = Boolean(session.canManage);
  el.staticAssetsField.hidden = !state.canManage;
  requestStaticAssets({ ifMissing: true });
}

function tintMember(node, name) {
  if (name) {
    node.classList.add('member-tint');
    node.style.setProperty('--member', String(memberHue(name)));
    return;
  }
  node.classList.remove('member-tint');
  node.style.removeProperty('--member');
}

function fillPeopleLine(container, names) {
  const key = JSON.stringify(names);
  if (container.dataset.people === key) {
    container.hidden = names.length === 0;
    return;
  }
  container.dataset.people = key;
  container.hidden = names.length === 0;
  container.replaceChildren();
  names.forEach((name, index) => {
    if (index > 0) {
      container.append(' · ');
    }
    const label = document.createElement('span');
    label.textContent = name;
    tintMember(label, name);
    container.append(label);
  });
}

function renderPeopleLine() {
  fillPeopleLine(
    el.peopleLine,
    state.people.map((person) => person.name).filter(Boolean),
  );
}

function demoScript() {
  return [
    { id: 'demo-ryu', role: 'user', author: 'Ryu', text: demoMsg('demoAsk') },
    { id: 'demo-reply', role: 'assistant', text: demoMsg('demoReply') },
    { id: 'demo-tool', role: 'tool', name: 'Edit', status: 'done', summary: 'public/index.html' },
    { id: 'demo-ken', role: 'user', author: 'Ken', text: demoMsg('demoBack') },
    { id: 'demo-stays', role: 'assistant', text: demoMsg('demoStays') },
  ];
}

function appendDemoUserTurns(items) {
  demoUserTurns.forEach((text, index) => {
    items.push({ id: `demo-you-${index}`, role: 'user', text });
    if (index === 0) {
      items.push({ id: 'demo-live-reply', role: 'assistant', text: demoMsg('demoLiveReply') });
    }
  });
  return items;
}

function demoItems() {
  const items = demoScript().slice(0, demoScriptShown).map((item) => ({ ...item }));
  const last = items[items.length - 1];
  if (demoPartialText !== null && last?.role === 'assistant') {
    items[items.length - 1] = { ...last, text: demoPartialText };
  }
  return appendDemoUserTurns(items);
}

function demoExportIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 4v11M7.5 11.5 12 16l4.5-4.5M6 19h12');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function paintDemoExport() {
  el.demoExport.setAttribute('aria-label', demoMsg('exportLog'));
  if (demoExportMoved) {
    el.demoSettings.parentElement.before(el.demoExport);
    el.demoExport.className = 'icon-button';
    el.demoExport.replaceChildren(demoExportIcon());
    return;
  }
  el.demoMembers.before(el.demoExport);
  el.demoExport.className = 'menu-action';
  el.demoExport.textContent = demoMsg('exportLog');
}

function stillDemoPlay(run) {
  return run === demoPlayRun;
}

function startDemoConversation() {
  demoPlayRun += 1;
  const run = demoPlayRun;
  demoScriptShown = 0;
  demoPartialText = null;
  demoTyping = false;
  demoExportMoved = false;
  el.landingDemo.classList.remove('is-refreshing');
  paintDemoExport();
  renderDemo();
  playDemoConversation(run).catch(() => {
    if (stillDemoPlay(run)) {
      finishDemoConversation();
    }
  });
}

function finishDemoConversation() {
  demoTyping = false;
  demoPartialText = null;
  demoScriptShown = demoScript().length;
  demoExportMoved = true;
  el.landingDemo.classList.remove('is-refreshing');
  paintDemoExport();
  renderDemo();
}

async function playDemoConversation(run) {
  const script = demoScript();
  for (const [index, item] of script.entries()) {
    if (!stillDemoPlay(run)) {
      return;
    }
    if (item.role === 'assistant') {
      demoTyping = true;
      renderDemo();
      await sleep(DEMO_TYPING_MS);
      if (!stillDemoPlay(run)) {
        return;
      }
      demoTyping = false;
      demoScriptShown = index + 1;
      demoPartialText = '';
      renderDemo();
      for (let count = 1; count <= item.text.length; count += 1) {
        if (!stillDemoPlay(run)) {
          return;
        }
        demoPartialText = item.text.slice(0, count);
        renderDemo();
        await sleep(DEMO_STREAM_MS);
      }
      demoPartialText = null;
      renderDemo();
      continue;
    }
    if (index > 0) {
      await sleep(DEMO_GAP_MS);
      if (!stillDemoPlay(run)) {
        return;
      }
    }
    demoScriptShown = index + 1;
    renderDemo();
  }
  await sleep(DEMO_GAP_MS);
  if (!stillDemoPlay(run)) {
    return;
  }
  if (!demoShowingSpec) {
    el.landingDemo.classList.add('is-refreshing');
  }
  await sleep(DEMO_REFRESH_MID_MS);
  if (!stillDemoPlay(run)) {
    return;
  }
  demoExportMoved = true;
  setDemoSettingsOpen(false);
  paintDemoExport();
  await sleep(DEMO_REFRESH_MS - DEMO_REFRESH_MID_MS);
  if (!stillDemoPlay(run)) {
    return;
  }
  el.landingDemo.classList.remove('is-refreshing');
}

function updateDemoComposer() {
  el.demoSend.disabled = el.demoInput.value.trim() === '';
}

function sendDemoMessage() {
  const text = el.demoInput.value.trim();
  if (!text || demoShowingSpec) {
    return;
  }
  el.demoInput.value = '';
  autoGrow(el.demoInput);
  demoUserTurns.push(text);
  updateDemoComposer();
  renderDemo();
  el.demoMessages.scrollTop = el.demoMessages.scrollHeight;
}

function renderDemo() {
  const stick = isNearBottom(el.demoMessages, 24);
  reconcileTranscript(el.demoTranscript, demoNodes, demoItems());
  el.demoTyping.hidden = !demoTyping;
  el.demoTyping.setAttribute('aria-label', demoMsg('typing'));
  syncDemoView();
  if (stick) {
    el.demoMessages.scrollTop = el.demoMessages.scrollHeight;
  }
}

async function exportDemo() {
  if (state.exporting) {
    return;
  }
  state.exporting = true;
  el.demoExport.disabled = true;
  setDemoSettingsOpen(false);
  try {
    await exportConversationLog(appendDemoUserTurns(demoScript()), { model: DEMO_MODEL });
  } catch (error) {
    if (error?.name !== 'AbortError') {
      setStatus(() => error.message || msg('exportFailed'));
    }
  } finally {
    state.exporting = false;
    el.demoExport.disabled = false;
  }
}

function showChat(session) {
  state.listing = false;
  el.conversationList.hidden = true;
  el.messages.hidden = false;
  el.input.closest('.composer').hidden = false;
  applySessionIdentity(session);
  state.model = session.model ?? '';
  state.busy = Boolean(session.busy);
  state.items = session.items ?? [];
  state.people = session.people ?? [];
  state.alumni = session.alumni ?? [];
  state.invites = session.invites ?? [];
  renderPeopleLine();
  el.newChat.hidden = !state.canManage;
  el.people.hidden = !state.canManage;
  el.passkeys.hidden = false;
  rebindInviteNames(el.transcript, false);
  scheduleRender();
  updateComposer();
}

function showConversationList(conversations) {
  state.listing = true;
  state.items = [];
  state.busy = false;
  el.messages.hidden = true;
  el.input.closest('.composer').hidden = true;
  el.conversationList.hidden = false;
  el.peopleLine.hidden = true;
  el.newChat.hidden = true;
  el.people.hidden = true;
  el.passkeys.hidden = false;
  el.staticAssetsField.hidden = true;
  el.conversationListTitle.textContent = msg('conversationList');
  el.conversationEntries.replaceChildren();
  for (const conversation of conversations) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-action';
    button.textContent = conversation.active ? msg('currentConversation') : msg('endedConversation', { time: conversation.at });
    button.addEventListener('click', () => openConversation(conversation).catch(handleFailure));
    el.conversationEntries.append(button);
  }
  updateComposer();
}

async function openConversation(conversation) {
  if (!conversation.active) {
    const response = await api(`/api/logs/${conversation.id}`);
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    const body = await response.json();
    downloadTextFile(body.filename, body.text);
    return;
  }
  const response = await api('/api/session?open=active');
  if (!response.ok) {
    throw new RequestError(await readServerError(response), response.status);
  }
  const session = await response.json();
  showChat(session);
  hideLogin();
  followIfBusy(session);
}

async function followUntilIdle() {
  if (state.following) {
    return;
  }
  const epoch = chatEpoch;
  state.following = true;
  try {
    for (;;) {
      if (epoch !== chatEpoch) {
        return;
      }
      await sleep(POLL_INTERVAL_MS);
      if (epoch !== chatEpoch) {
        return;
      }
      try {
        const session = await loadSession();
        if (epoch !== chatEpoch) {
          return;
        }
        if (session && !session.busy) {
          break;
        }
      } catch (error) {
        if (error instanceof SessionEndedError || epoch !== chatEpoch) {
          return;
        }
        if (error instanceof AuthError) {
          throw error;
        }
        setStatus(() => msg('reconnecting'));
      }
    }
    setStatus('');
  } catch (error) {
    if (!(error instanceof SessionEndedError) && epoch === chatEpoch) {
      handleFailure(error);
    }
  } finally {
    if (epoch === chatEpoch) {
      state.following = false;
      updateComposer();
    }
  }
}

function followIfBusy(session) {
  if (session?.busy) {
    followUntilIdle();
  }
}

function isCredentialRejection(raw) {
  return !raw || raw === 'Invalid or missing username or password.';
}

async function sendMessage() {
  const epoch = chatEpoch;
  const text = el.input.value.trim();
  const files = pending.slice();
  if ((!text && files.length === 0) || state.busy) {
    return;
  }

  el.input.value = '';
  pending.length = 0;
  renderPending();
  autoGrow();
  state.busy = true;
  state.forceScroll = true;
  setStatus('');
  updateComposer();

  let response;
  try {
    const attachments = await Promise.all(files.map(encodeFile));
    const body = attachments.length > 0 ? { text, attachments } : { text };
    response = await api('/api/messages', { method: 'POST', body });
  } catch (error) {
    if (error instanceof SessionEndedError || epoch !== chatEpoch) {
      return;
    }
    restoreDraft(text, files);
    state.busy = false;
    updateComposer();
    handleFailure(error);
    return;
  }

  if (epoch !== chatEpoch) {
    await response.body?.cancel()?.catch(() => {});
    return;
  }

  if (response.status === 409) {
    await response.body?.cancel()?.catch(() => {});
    restoreDraft(text, files);
    setStatus(() => msg('agentBusy'));
    await followUntilIdle();
    return;
  }
  if (!response.ok) {
    restoreDraft(text, files);
    state.busy = false;
    updateComposer();
    setStatus(responseStatusText(await readServerError(response), response.status));
    return;
  }

  for (const entry of files) {
    revokePreview(entry);
  }

  state.streaming = true;
  try {
    await consumeStream(response.body, epoch);
    state.streaming = false;
    if (epoch !== chatEpoch) {
      return;
    }
    await loadSession();
  } catch (error) {
    state.streaming = false;
    if (error instanceof SessionEndedError || epoch !== chatEpoch) {
      return;
    }
    if (error instanceof AuthError) {
      handleFailure(error);
    } else {
      setStatus(() => msg('connectionInterrupted'));
      await followUntilIdle();
    }
  } finally {
    if (epoch === chatEpoch) {
      state.streaming = false;
      updateComposer();
    }
  }
}

async function consumeStream(body, epoch) {
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    let pendingText = '';
    for (;;) {
      if (epoch !== chatEpoch) {
        return;
      }
      const { value, done } = await readWithStallTimeout(reader, STREAM_STALL_MS);
      if (epoch !== chatEpoch) {
        return;
      }
      pendingText += decoder.decode(value, { stream: !done });
      let newline = pendingText.indexOf('\n');
      while (newline !== -1) {
        applyLine(pendingText.slice(0, newline));
        pendingText = pendingText.slice(newline + 1);
        newline = pendingText.indexOf('\n');
      }
      scheduleRender();
      if (done) {
        break;
      }
    }
    applyLine(pendingText);
    scheduleRender();
  } finally {
    // Settle an in-flight read before dropping the lock. releaseLock() throws
    // in some browsers while a read is still pending, and that throw would hide
    // the stream error. A failed cancel must not replace it either.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function applyLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  let op;
  try {
    op = JSON.parse(trimmed);
  } catch (error) {
    // Same rule as the server: one bad line must not drop the events after it.
    setStatus(() => msg('streamLineFailed', { detail: error.message }));
    return;
  }
  applyOp(state.items, op);
}

async function stopRun() {
  if (!state.busy || state.stopping) {
    return;
  }
  const epoch = chatEpoch;
  state.stopping = true;
  updateComposer();
  try {
    const response = await api('/api/cancel', { method: 'POST' });
    if (epoch !== chatEpoch) {
      return;
    }
    if (!response.ok) {
      state.stopping = false;
      setStatus(responseStatusText(await readServerError(response), response.status));
    } else {
      const result = await response.json();
      // Nothing was running yet (for example the POST is still being read).
      // Clear the latch so Stop can be tried again once the run starts.
      if (!result.stopping) {
        state.stopping = false;
      } else if (!state.streaming) {
        followUntilIdle();
      }
    }
  } catch (error) {
    if (error instanceof SessionEndedError || epoch !== chatEpoch) {
      return;
    }
    state.stopping = false;
    handleFailure(error);
  }
  if (epoch === chatEpoch) {
    updateComposer();
  }
}

async function newChat() {
  if (state.busy || el.newChatDialog.open) {
    return;
  }
  const epoch = chatEpoch;
  setSettingsOpen(false);
  const action = await chooseNewChatAction();
  if (epoch !== chatEpoch) {
    return;
  }
  el.newChat.focus();
  if (action !== 'export' && action !== 'clear') {
    return;
  }
  if (action === 'export') {
    try {
      await exportConversationLog(state.items, { model: state.model });
    } catch (error) {
      // Cancelling the share sheet must not wipe the chat; that is what "start
      // without exporting" is for.
      if (error?.name === 'AbortError') {
        return;
      }
      setStatus(() => error.message || msg('exportFailed'));
      return;
    }
  }
  try {
    const response = await api('/api/new', { method: 'POST' });
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    // Drop the local transcript before reloading. A failed reload must not keep
    // showing a chat the server has already cleared.
    forgetMediaUrls();
    state.items = [];
    scheduleRender();
    await loadSession();
    if (epoch !== chatEpoch) {
      return;
    }
    setStatus('');
  } catch (error) {
    if (error instanceof SessionEndedError || epoch !== chatEpoch) {
      return;
    }
    handleFailure(error);
  }
}

let settleNewChatChoice = null;

function chooseNewChatAction() {
  const hasLog = state.items.length > 0;
  el.newChatExport.hidden = !hasLog;
  el.newChatClear.textContent = msg(hasLog ? 'newChatClear' : 'newChat');
  el.newChatClear.classList.toggle('primary-button', !hasLog);
  el.newChatClear.classList.toggle('secondary-button', hasLog);
  return new Promise((resolve) => {
    settleNewChatChoice = (action) => {
      settleNewChatChoice = null;
      if (el.newChatDialog.open) {
        el.newChatDialog.close();
      }
      resolve(action);
    };
    el.newChatDialog.showModal();
  });
}

function onNewChatDialogClick(event) {
  const button = event.target.closest('[data-action]');
  if (button) {
    settleNewChatChoice?.(button.dataset.action);
    return;
  }
  if (event.target === el.newChatDialog) {
    settleNewChatChoice?.('cancel');
  }
}

function onNewChatDialogCancel(event) {
  event.preventDefault();
  settleNewChatChoice?.('cancel');
}

async function exportLog() {
  if (state.items.length === 0 || state.exporting) {
    return;
  }
  state.exporting = true;
  el.exportLog.disabled = true;
  try {
    await exportConversationLog(state.items, { model: state.model });
  } catch (error) {
    if (error?.name !== 'AbortError') {
      setStatus(() => error.message || msg('exportFailed'));
    }
  } finally {
    state.exporting = false;
    el.exportLog.disabled = state.items.length === 0;
  }
}

async function exportConversationLog(items, { model }) {
  const exportedAt = new Date();
  const text = formatConversationLog(items, { model, exportedAt: exportedAt.toISOString() });
  const filename = conversationLogFilename(exportedAt);
  const file = new File([text], filename, { type: 'application/json;charset=utf-8' });
  if (typeof navigator.share === 'function') {
    // iOS Save to Files writes title as a second .txt whose body is that string.
    const payload = navigator.canShare?.({ files: [file] }) ? { files: [file] } : { title: filename, text };
    if (!navigator.canShare || navigator.canShare(payload)) {
      try {
        await navigator.share(payload);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
      }
    }
  }
  downloadTextFile(filename, text);
}

function downloadTextFile(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function restoreDraft(text, files = []) {
  if (!el.input.value) {
    el.input.value = text;
  }
  const room = MAX_ATTACHMENTS - pending.length;
  const kept = [];
  for (const file of files) {
    if (kept.length >= room) {
      revokePreview(file);
    } else {
      kept.push(file);
    }
  }
  pending.unshift(...kept);
  renderPending();
  autoGrow();
  updateComposer();
}

let preparing = 0;

async function ingestFiles(fileList) {
  preparing += 1;
  updateComposer();
  const prepared = [];
  try {
    for (const file of fileList) {
      prepared.push(await prepareAttachment(file));
    }
  } finally {
    // Clear only after the bytes are copied. Doing it earlier drops the photo on iOS.
    el.files.value = '';
    preparing -= 1;
  }
  addPrepared(prepared);
}

function addPrepared(entries) {
  let rejected = '';
  let overCount = false;
  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    if (entry.rejected) {
      rejected = entry.rejected;
      continue;
    }
    if (pending.length >= MAX_ATTACHMENTS) {
      overCount = true;
      revokePreview(entry);
      continue;
    }
    pending.push(entry);
  }
  renderPending();
  updateComposer();
  if (overCount) {
    setStatus(() => msg('tooManyFiles', { limit: MAX_ATTACHMENTS }));
  } else if (rejected === 'size') {
    setStatus(() => msg('fileTooLarge', { limit: MAX_ATTACHMENT_BYTES / (1024 * 1024) }));
  } else if (entries.length > 0) {
    setStatus('');
  }
}

const IMAGE_NAME = /\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)$/i;

function sniffImageBytes(bytes) {
  if (!bytes || bytes.length < 12) {
    return '';
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF' &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return '';
}

// Phone libraries hand back HEIC, or a JPEG with an empty MIME type. The server
// only displays PNG, JPEG, GIF, and WebP, so decode anything the browser can draw.
async function prepareAttachment(file) {
  let raw;
  try {
    raw = new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
  if (raw.length === 0) {
    return null;
  }
  const mime = sniffImageBytes(raw);
  const namedImage = file.type.startsWith('image/') || IMAGE_NAME.test(file.name || '');
  if (mime && raw.length <= MAX_ATTACHMENT_BYTES) {
    return attachmentEntry(file.name || 'image', raw, mime);
  }
  if (namedImage || mime) {
    const jpeg = await transcodeImage(file);
    if (jpeg && jpeg.length > 0 && jpeg.length <= MAX_ATTACHMENT_BYTES) {
      const base = (file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
      return attachmentEntry(`${base}.jpg`, jpeg, 'image/jpeg');
    }
  }
  if (raw.length > MAX_ATTACHMENT_BYTES) {
    return { rejected: 'size' };
  }
  return attachmentEntry(file.name || 'file', raw, mime);
}

function attachmentEntry(name, bytes, mime) {
  const previewUrl = mime ? URL.createObjectURL(new Blob([bytes], { type: mime })) : '';
  return { key: crypto.randomUUID(), name, bytes, previewUrl };
}

async function transcodeImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('undecodable'));
      img.src = url;
    });
    const maxEdge = 2048;
    const edge = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const scale = Math.min(1, maxEdge / edge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderPending() {
  el.pending.replaceChildren();
  el.pending.hidden = pending.length === 0;
  for (const entry of pending) {
    const item = document.createElement('div');
    item.className = 'pending-item';
    if (entry.previewUrl) {
      const img = document.createElement('img');
      img.src = entry.previewUrl;
      img.alt = entry.name;
      item.append(img);
    } else {
      const chip = document.createElement('span');
      chip.className = 'file-chip';
      chip.textContent = entry.name;
      item.append(chip);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'pending-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', msg('removeFile', { name: entry.name }));
    remove.addEventListener('click', () => {
      const index = pending.indexOf(entry);
      if (index !== -1) {
        revokePreview(pending[index]);
        pending.splice(index, 1);
        renderPending();
        updateComposer();
      }
    });
    item.append(remove);
    el.pending.append(item);
  }
}

function revokePreview(entry) {
  if (entry.previewUrl) {
    URL.revokeObjectURL(entry.previewUrl);
  }
}

function encodeFile(entry) {
  const bytes = entry.bytes ?? new Uint8Array();
  return Promise.resolve({
    name: entry.name,
    data: bytesToBase64(bytes),
  });
}

function bytesToBase64(bytes) {
  // Spreading a large chunk into String.fromCharCode overflows the stack on iOS.
  let binary = '';
  const chunk = 0x1000;
  for (let index = 0; index < bytes.length; index += chunk) {
    let part = '';
    const end = Math.min(index + chunk, bytes.length);
    for (let cursor = index; cursor < end; cursor += 1) {
      part += String.fromCharCode(bytes[cursor]);
    }
    binary += part;
  }
  return btoa(binary);
}

function failureMessage(error) {
  if (error instanceof RequestError) {
    return responseStatusText(error.raw, error.status)();
  }
  if (error instanceof TypeError) {
    return msg('cannotReachCheck');
  }
  return translateError(locale, error.message) || msg('somethingWentWrong');
}

function handleFailure(error) {
  if (error instanceof SessionEndedError) {
    return;
  }
  if (error instanceof AuthError) {
    const hadSession = sessionToken !== null;
    forgetSession();
    if (!hadSession) {
      showLanding();
      return;
    }
    showLogin(
      () => msg('credentialsRejected'),
      gateLoginMode(),
    );
    refreshAuthGate()
      .then(() => {
        if (!el.login.open) {
          return;
        }
        const mode = gateLoginMode();
        if (mode === lastLoginMode) {
          return;
        }
        lastLoginMode = mode;
        applyLoginMode();
      })
      .catch((statusError) => {
        setStatus(() => retryDetail(statusError));
      });
    return;
  }
  setStatus(() => failureMessage(error));
}

function scheduleRender() {
  if (state.renderQueued) {
    return;
  }
  state.renderQueued = true;
  requestAnimationFrame(render);
}

function render() {
  state.renderQueued = false;
  const stick = state.forceScroll || isNearBottom();
  state.forceScroll = false;
  reconcileTranscript(el.transcript, state.nodes, state.items);

  el.empty.hidden = state.items.length > 0;
  el.exportLog.disabled = state.items.length === 0 || state.exporting;
  if (stick) {
    el.messages.scrollTop = el.messages.scrollHeight;
  }
}

// Reuses one DOM node per transcript item and only rewrites nodes whose content changed,
// so streaming updates do not disturb text selection or scroll position elsewhere.
function reconcileTranscript(container, nodes, items) {
  const live = new Set();
  let cursor = container.firstChild;
  for (const item of items) {
    live.add(item.id);
    let entry = nodes.get(item.id);
    if (!entry) {
      entry = { node: createNode(item), signature: '' };
      nodes.set(item.id, entry);
    }
    const signature = signatureOf(item);
    if (signature !== entry.signature) {
      updateNode(entry.node, item);
      entry.signature = signature;
    }
    if (entry.node === cursor) {
      cursor = cursor.nextSibling;
    } else {
      container.insertBefore(entry.node, cursor);
    }
  }
  for (const [id, entry] of nodes) {
    if (!live.has(id)) {
      entry.node.remove();
      nodes.delete(id);
    }
  }
}

function createNode(item) {
  const node = document.createElement('div');
  switch (item.role) {
    case 'user':
      node.className = 'msg msg-user';
      node.innerHTML = '<div class="who" hidden></div><div class="bubble" dir="auto"><div class="media"></div><div class="text"></div></div>';
      break;
    case 'assistant':
      node.className = 'msg msg-assistant';
      node.innerHTML = '<div class="stack"><div class="media"></div><div class="bubble md" dir="auto"></div></div>';
      break;
    case 'tool':
      node.className = 'tool-block';
      node.dir = 'auto';
      node.innerHTML =
        '<div class="activity"><span class="dot" aria-hidden="true"></span><span class="name"></span><span class="summary"></span></div><div class="media"></div>';
      break;
    default:
      node.className = 'notice';
      node.dir = 'auto';
  }
  return node;
}

function updateNode(node, item) {
  switch (item.role) {
    case 'user': {
      const who = node.querySelector('.who');
      who.hidden = !item.author;
      who.textContent = item.author ?? '';
      tintMember(node, item.author);
      bindInviteName(who, item.author, Boolean(node.closest('#demo-transcript')));
      fillText(node.querySelector('.text'), item.text);
      syncMedia(node, item.attachments);
      break;
    }
    case 'assistant':
      node.hidden = !item.text && !(item.images && item.images.length);
      node.querySelector('.bubble').hidden = !item.text;
      node.querySelector('.bubble').innerHTML = item.text ? renderMarkdown(item.text) : '';
      syncMedia(node, item.images);
      break;
    case 'tool': {
      const activity = node.querySelector('.activity');
      activity.dataset.status = item.status;
      activity.children[1].textContent = item.name;
      activity.children[2].textContent = item.summary ?? '';
      syncMedia(node, item.images);
      break;
    }
    case 'notice':
      node.dataset.level = item.level ?? 'info';
      node.textContent = item.text;
      break;
    default:
      break;
  }
}

function fillText(node, text) {
  node.textContent = text ?? '';
  node.hidden = !text;
}

function syncMedia(node, files) {
  const key = JSON.stringify(files ?? []);
  if (node.dataset.media === key) {
    return;
  }
  node.dataset.media = key;
  fillMedia(node.querySelector('.media'), files);
}

function fillMedia(container, files) {
  container.replaceChildren();
  for (const file of files ?? []) {
    if (file?.id && typeof file.mime === 'string' && file.mime.startsWith('image/')) {
      const img = document.createElement('img');
      img.className = 'shot';
      img.alt = file.name || msg('image');
      container.append(img);
      showMedia(img, file.id);
      continue;
    }
    if (file?.name) {
      const chip = document.createElement('span');
      chip.className = 'file-chip';
      chip.textContent = file.name;
      container.append(chip);
    }
  }
}

function showMedia(img, id) {
  const cached = mediaUrls.get(id);
  if (cached) {
    img.src = cached;
    return;
  }
  let load = mediaLoads.get(id);
  if (!load) {
    const started = mediaEpoch;
    load = api(`/api/media/${id}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('missing');
        }
        const url = URL.createObjectURL(await response.blob());
        if (started !== mediaEpoch) {
          URL.revokeObjectURL(url);
          return '';
        }
        mediaUrls.set(id, url);
        return url;
      })
      .finally(() => mediaLoads.delete(id));
    mediaLoads.set(id, load);
  }
  load
    .then((url) => {
      if (url && img.isConnected) {
        img.src = url;
      }
    })
    .catch((error) => {
      if (error instanceof SessionEndedError) {
        return;
      }
      if (error instanceof AuthError) {
        handleFailure(error);
        return;
      }
      if (img.isConnected) {
        img.alt = msg('imageUnavailable');
      }
    });
}

function forgetMediaUrls() {
  mediaEpoch += 1;
  for (const url of mediaUrls.values()) {
    URL.revokeObjectURL(url);
  }
  mediaUrls.clear();
  mediaLoads.clear();
}

function signatureOf(item) {
  return JSON.stringify([item.role, item.author, item.text, item.status, item.name, item.summary, item.level, item.attachments, item.images]);
}

function updateComposer() {
  if (!state.busy) {
    state.stopping = false;
  }
  el.send.classList.toggle('is-stop', state.busy);
  el.send.setAttribute('aria-label', state.busy ? msg('stop') : msg('send'));
  const hasDraft = el.input.value.trim() !== '' || pending.length > 0;
  el.send.disabled = state.busy ? state.stopping : preparing > 0 || !hasDraft;
  el.typing.hidden = !state.busy;
  el.newChat.disabled = state.busy;
}

function autoGrow(field = el.input) {
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight}px`;
}

function isNearBottom(container = el.messages, slop = NEAR_BOTTOM_PX) {
  const { scrollTop, scrollHeight, clientHeight } = container;
  return scrollHeight - scrollTop - clientHeight < slop;
}

function setStatus(message) {
  renderStatus = typeof message === 'function' ? message : () => message;
  applyStatus();
}

function setPeopleStatus(message, { error = false } = {}) {
  renderPeopleStatus = typeof message === 'function' ? message : () => message || '';
  peopleStatusError = error;
  applyPeopleStatus();
}

function applyPeopleStatus() {
  const message = renderPeopleStatus() || '';
  el.peopleStatus.textContent = message;
  el.peopleStatus.hidden = !message;
  el.peopleStatus.classList.toggle('is-error', Boolean(message) && peopleStatusError);
}

function applyStatus() {
  const message = renderStatus();
  el.status.textContent = message;
  el.status.hidden = !message;
  el.landingStatus.textContent = message;
  el.landingStatus.hidden = !message;
}

function setLoginError(message) {
  renderLoginError = typeof message === 'function' ? message : () => message;
  el.loginError.textContent = renderLoginError();
}

function gateLoginMode() {
  if (authGate.invite) {
    return 'join';
  }
  return authGate.started ? 'username' : 'password';
}

function applyLandingGate() {
  const invite = authGate.invite;
  el.landingSignIn.hidden = Boolean(invite);
  el.landingSignIn.disabled = false;
  el.landingInvite.hidden = !invite;
  if (invite) {
    el.landingInvite.textContent = msg('landingInvite', { name: invite.ownerName });
  }
}

function closeDialog(dialog) {
  if (dialog.open) {
    dialog.close();
  }
}

function showLanding() {
  setSettingsOpen(false);
  el.landing.hidden = false;
  el.app.inert = true;
  closeDialog(el.login);
}

async function logOut() {
  setSettingsOpen(false);
  closeDialog(el.peopleDialog);
  closeDialog(el.passkeysDialog);
  closeDialog(el.newChatDialog);
  const token = sessionToken;
  settleNewChatChoice?.('cancel');
  forgetSession();
  state.following = false;
  state.streaming = false;
  state.busy = false;
  state.stopping = false;
  state.listing = false;
  state.items = [];
  state.nodes.clear();
  state.you = null;
  state.canManage = false;
  state.people = [];
  state.alumni = [];
  state.invites = [];
  renderPeopleLine();
  el.transcript.replaceChildren();
  el.input.value = '';
  for (const entry of pending) {
    revokePreview(entry);
  }
  pending.length = 0;
  renderPending();
  autoGrow();
  forgetMediaUrls();
  setStatus('');
  setPeopleStatus('');
  updateComposer();
  showLanding();
  const revokeError = await revokeServerSession(token);
  await refreshLoggedOutGate(revokeError);
}

async function revokeServerSession(token) {
  if (!token) {
    return null;
  }
  try {
    const response = await fetch('/api/session', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (response.status === 401) {
      await response.body?.cancel()?.catch(() => {});
      return null;
    }
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    await response.body?.cancel()?.catch(() => {});
    return null;
  } catch (error) {
    return error;
  }
}

async function refreshLoggedOutGate(revokeError) {
  if (sessionToken) {
    return;
  }
  el.landingSignIn.disabled = true;
  try {
    await refreshAuthGate();
  } catch (error) {
    if (sessionToken) {
      return;
    }
    setStatus(() =>
      revokeError ? failureMessage(revokeError) : msg('retrying', { detail: retryDetail(error) }),
    );
    setTimeout(() => refreshLoggedOutGate(revokeError), RETRY_INTERVAL_MS);
    return;
  }
  if (sessionToken) {
    return;
  }
  el.landingSignIn.disabled = false;
  if (revokeError) {
    setStatus(() => failureMessage(revokeError));
  } else {
    setStatus('');
  }
}

function hideGate() {
  el.landing.hidden = true;
  el.app.inert = false;
  if (el.passkeys) {
    el.passkeys.hidden = false;
  }
  closeDialog(el.login);
  pendingRegistration = null;
  setLoginError('');
}

function applyLoginMode() {
  const joining = lastLoginMode === 'join';
  const registering = lastLoginMode === 'register';
  const password = lastLoginMode === 'password';
  const named = lastLoginMode === 'username';
  el.loginTitle.textContent = joining ? msg('joinTitle') : msg('signInTitle');
  el.loginHint.hidden = named;
  if (named) {
    el.login.removeAttribute('aria-describedby');
  } else {
    el.login.setAttribute('aria-describedby', 'login-hint');
    if (joining) {
      el.loginHint.textContent = msg('joinHint');
    } else if (registering) {
      el.loginHint.textContent = msg('passkeyRequired');
    } else {
      fillMarked(el.loginHint, msg('signInHint'));
    }
  }
  el.loginUsername.hidden = !(password || named || joining);
  if (joining) {
    el.loginUsername.maxLength = 40;
  } else {
    el.loginUsername.removeAttribute('maxlength');
  }
  el.loginPassword.hidden = !password;
  el.loginSubmit.hidden = !(password || named || registering);
  el.loginSubmit.textContent = registering ? msg('addPasskey') : named ? msg('continueAction') : msg('unlock');
  el.loginJoin.hidden = !joining;
  el.loginInviteOnly.hidden = !password;
}

async function beginSignIn() {
  el.landingSignIn.disabled = true;
  try {
    await refreshAuthGate();
    if (!sessionToken) {
      showLogin('', gateLoginMode());
    }
  } finally {
    if (!sessionToken) {
      el.landingSignIn.disabled = false;
    }
  }
}

function showLogin(message = '', mode = lastLoginMode) {
  lastLoginMode = mode;
  if (mode !== 'register') {
    pendingRegistration = null;
  }
  setSettingsOpen(false);
  el.passkeys.hidden = true;
  el.landing.hidden = false;
  el.app.inert = true;
  setLoginError(message);
  applyLoginMode();
  if (!el.login.open) {
    el.login.showModal();
  }
  if (lastLoginMode === 'password') {
    el.loginPassword.value = '';
    (el.loginUsername.value ? el.loginPassword : el.loginUsername).focus();
  } else if (lastLoginMode === 'username' || lastLoginMode === 'join') {
    el.loginUsername.focus();
  } else if (lastLoginMode === 'register') {
    el.loginSubmit.focus();
  }
}

function hideLogin() {
  hideGate();
}

function onLoginDialogClose() {
  if (!sessionToken || el.landing.hidden) {
    return;
  }
  clearJoinParam();
  hideGate();
}

async function onLogin(event) {
  event.preventDefault();
  if (lastLoginMode === 'join') {
    await onJoin();
    return;
  }
  if (lastLoginMode === 'register') {
    await onRegisterPasskey();
    return;
  }
  if (lastLoginMode === 'username') {
    await onUsernameLogin();
    return;
  }
  const username = el.loginUsername.value.trim();
  const password = el.loginPassword.value;
  if (!username && !password) {
    setLoginError(() => msg('needBoth'));
    return;
  }
  if (!username) {
    setLoginError(() => msg('needUsername'));
    return;
  }
  if (!password) {
    setLoginError(() => msg('needPassword'));
    return;
  }
  try {
    const response = await api('/api/auth/password', { method: 'POST', body: { username, password }, auth: false });
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    pendingRegistration = await response.json();
    el.loginPassword.value = '';
    setLoginError('');
    lastLoginMode = 'register';
    applyLoginMode();
    el.loginSubmit.focus();
  } catch (error) {
    showLoginFailure(error, () => msg('badCredentials'));
  }
}

async function onRegisterPasskey() {
  if (!pendingRegistration) {
    lastLoginMode = 'password';
    applyLoginMode();
    return;
  }
  await runPasskeyStep(async () => {
    const credential = await createPasskey(pendingRegistration.options);
    const registered = await api('/api/auth/register', {
      method: 'POST',
      body: { challengeId: pendingRegistration.challengeId, credential },
      auth: false,
    });
    if (!registered.ok) {
      throw new RequestError(await readServerError(registered), registered.status);
    }
    return registered.json();
  });
}

async function onUsernameLogin() {
  const username = el.loginUsername.value.trim();
  if (!username) {
    setLoginError(() => msg('needUsername'));
    return;
  }
  await runPasskeyStep(async () => {
    const response = await api('/api/auth/options', { method: 'POST', body: { username }, auth: false });
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    const body = await response.json();
    const credential = await getPasskey(body.options);
    const signedIn = await api('/api/auth/login', {
      method: 'POST',
      body: { challengeId: body.challengeId, credential },
      auth: false,
    });
    if (!signedIn.ok) {
      throw new RequestError(await readServerError(signedIn), signedIn.status);
    }
    return signedIn.json();
  });
}

let settleSameDeviceJoin = null;
// One join at a time. Without this, a second submit overwrites the first warning's settle
// callback, and the first attempt waits forever.
let joinInFlight = false;

let settlePasskeyWarning = null;

// Warns before a passkey is added beyond the sign-in list size. Resolves true to continue
// and false to cancel.
function confirmManyPasskeys() {
  return new Promise((resolve) => {
    settlePasskeyWarning = (proceed) => {
      settlePasskeyWarning = null;
      if (el.passkeyWarningDialog.open) {
        el.passkeyWarningDialog.close();
      }
      resolve(proceed);
    };
    el.passkeyWarningDialog.showModal();
  });
}

// Asks before a second passkey is made on a device that already holds one of the people in
// the conversation. Resolves true to continue and false to cancel.
function confirmSameDeviceJoin() {
  return new Promise((resolve) => {
    settleSameDeviceJoin = (proceed) => {
      settleSameDeviceJoin = null;
      if (el.joinWarningDialog.open) {
        el.joinWarningDialog.close();
      }
      resolve(proceed);
    };
    el.joinWarningDialog.showModal();
  });
}

async function onJoin() {
  if (joinInFlight) {
    return;
  }
  const name = el.loginUsername.value.trim();
  if (!name) {
    setLoginError(() => msg('needUsername'));
    return;
  }
  joinInFlight = true;
  try {
    await runPasskeyStep(async () => {
      const response = await api('/api/join', {
        method: 'POST',
        body: { inviteId: joinId, name },
        auth: false,
        withSession: true,
      });
      if (!response.ok) {
        throw new RequestError(await readServerError(response), response.status);
      }
      const body = await response.json();
      const credential = await createJoinPasskey(body.options, { confirmSameDevice: confirmSameDeviceJoin });
      const joined = await api('/api/join/finish', {
        method: 'POST',
        body: { challengeId: body.challengeId, credential },
        auth: false,
      });
      if (!joined.ok) {
        throw new RequestError(await readServerError(joined), joined.status);
      }
      return joined.json();
    });
  } finally {
    joinInFlight = false;
  }
}

async function runPasskeyStep(action) {
  if (!supportsPasskey()) {
    setLoginError(() => msg('passkeyUnavailable'));
    return;
  }
  try {
    const session = await action();
    if (session?.token) {
      storeSession(session.token);
    }
    clearJoinParam();
    hideLogin();
    if (session) {
      applySessionIdentity(session);
    }
    if (session?.home === 'list') {
      showConversationList(session.conversations ?? []);
      return;
    }
    showChat(session);
    if (session?.busy) {
      followUntilIdle();
    }
  } catch (error) {
    if (error instanceof JoinDeclinedError) {
      // Cancelled at the warning: offer the sign-in form, since an invite link hides Start.
      clearJoinParam();
      showLogin('', 'username');
      return;
    }
    showLoginFailure(error, () => msg('passkeyFailed'));
  }
}

function showLoginFailure(error, unauthorized) {
  if (error instanceof AuthError) {
    setLoginError(unauthorized);
  } else if (error instanceof RequestError && error.status === 401 && isCredentialRejection(error.raw)) {
    setLoginError(unauthorized);
  } else if (error instanceof TypeError) {
    setLoginError(() => msg('cannotReachTryAgain'));
  } else if (error instanceof RequestError) {
    setLoginError(responseStatusText(error.raw, error.status));
  } else {
    setLoginError(() => translateError(locale, error.message) || unauthorized());
  }
}

async function bootstrap() {
  if (sessionToken) {
    try {
      const session = await loadSession();
      if (!session) {
        return;
      }
      if (joinId && session.you?.inConversation) {
        // Someone already in the conversation has nothing to join, so the link does nothing.
        clearJoinParam();
      } else if (joinId) {
        showLogin('', 'join');
        return;
      }
      hideGate();
      setStatus('');
      if (session.busy) {
        followUntilIdle();
      }
      return;
    } catch (error) {
      if (!(error instanceof AuthError)) {
        setStatus(() => msg('retrying', { detail: retryDetail(error) }));
        setTimeout(bootstrap, RETRY_INTERVAL_MS);
        return;
      }
      forgetSession();
    }
  }
  try {
    await refreshAuthGate();
  } catch (error) {
    setStatus(() => msg('retrying', { detail: retryDetail(error) }));
    setTimeout(bootstrap, RETRY_INTERVAL_MS);
    return;
  }
  applyLandingGate();
  if (joinId && !authGate.invite) {
    setStatus(() => msg('inviteUsed'));
  }
  showLanding();
}

async function refreshAuthGate() {
  const path = joinId ? `/api/auth/status?join=${encodeURIComponent(joinId)}` : '/api/auth/status';
  const response = await api(path, { auth: false });
  if (!response.ok) {
    throw new RequestError(await readServerError(response), response.status);
  }
  authGate = await response.json();
  applyLandingGate();
}

function clearJoinParam() {
  if (!joinId) {
    return;
  }
  joinId = null;
  const url = new URL(location.href);
  url.searchParams.delete('join');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

let creatingInvite = false;

async function createInvite() {
  if (creatingInvite) {
    return;
  }
  const epoch = chatEpoch;
  creatingInvite = true;
  el.invite.disabled = true;
  setPeopleStatus('');
  try {
    const response = await api('/api/invites', { method: 'POST', body: {} });
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    const body = await response.json();
    const link = new URL(body.path, location.origin).href;
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
      copied = false;
    }
    if (epoch !== chatEpoch) {
      return;
    }
    const session = await loadSession();
    if (epoch !== chatEpoch) {
      return;
    }
    followIfBusy(session);
    if (session && el.peopleDialog.open) {
      paintPeopleDialog(state.people, state.invites, livePeopleDialogOptions());
    }
    if (copied) {
      setPeopleStatus(() => msg('inviteCopied'));
      setStatus(() => msg('inviteCopied'));
    } else {
      setPeopleStatus(link);
      setStatus(link);
    }
  } finally {
    creatingInvite = false;
    if (epoch === chatEpoch) {
      el.invite.disabled = false;
    }
  }
}

function handlePasskeysDialogFailure(error) {
  if (error instanceof SessionEndedError) {
    return;
  }
  if (error instanceof AuthError) {
    closeDialog(el.passkeysDialog);
    handleFailure(error);
    return;
  }
  setPasskeyStatus(error);
}

function setPasskeyStatus(error) {
  const text = error instanceof RequestError
    ? responseStatusText(error.raw, error.status)()
    : translateError(locale, error?.message) || msg('passkeyFailed');
  el.passkeysStatus.classList.add('login-error');
  el.passkeysStatus.textContent = text;
}

async function openPasskeys() {
  const epoch = chatEpoch;
  setSettingsOpen(false);
  el.passkeysStatus.textContent = '';
  const response = await api('/api/passkeys');
  if (epoch !== chatEpoch) {
    return;
  }
  if (!response.ok) {
    throw new RequestError(await readServerError(response), response.status);
  }
  renderPasskeys((await response.json()).passkeys ?? []);
  if (epoch !== chatEpoch) {
    return;
  }
  if (!el.passkeysDialog.open) {
    el.passkeysDialog.showModal();
  }
}

function renderPasskeys(passkeys) {
  el.passkeyEntries.replaceChildren();
  for (const passkey of passkeys) {
    const item = document.createElement('li');
    const entry = document.createElement('div');
    entry.className = 'passkey-entry';
    if (passkey.label) {
      const name = document.createElement('span');
      name.className = 'passkey-name';
      name.textContent = passkey.label;
      entry.append(name);
    }
    const when = document.createElement('span');
    when.className = 'passkey-when';
    when.dataset.time = passkey.createdAt || '';
    when.textContent = passkey.createdAt ? msg('passkeyAddedAt', { time: passkey.createdAt }) : '';
    entry.append(when);
    item.append(entry);
    if (passkeys.length > 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost-button';
      button.textContent = msg('removePasskey');
      button.addEventListener('click', () => {
        deletePasskey(passkey.id).catch(handlePasskeysDialogFailure);
      });
      item.append(button);
    }
    el.passkeyEntries.append(item);
  }
}

async function addPasskey() {
  if (!supportsPasskey()) {
    setPasskeyStatus(new Error(msg('passkeyUnavailable')));
    return;
  }
  if (el.passkeyAdd.disabled) {
    return;
  }
  const epoch = chatEpoch;
  const label = el.passkeyLabel.value;
  el.passkeysStatus.textContent = '';
  el.passkeyAdd.disabled = true;
  el.passkeyLabel.disabled = true;
  try {
    const response = await api('/api/passkeys', { method: 'POST', body: { label } });
    if (epoch !== chatEpoch) {
      return;
    }
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    const body = await response.json();
    if (body.warnBeforeAdd && !(await confirmManyPasskeys())) {
      return;
    }
    if (epoch !== chatEpoch) {
      return;
    }
    const credential = await createPasskey(body.options);
    if (epoch !== chatEpoch) {
      return;
    }
    const finished = await api('/api/passkeys/finish', {
      method: 'POST',
      body: { challengeId: body.challengeId, credential },
    });
    if (epoch !== chatEpoch) {
      return;
    }
    if (!finished.ok) {
      throw new RequestError(await readServerError(finished), finished.status);
    }
    renderPasskeys((await finished.json()).passkeys ?? []);
    el.passkeyLabel.value = '';
    el.passkeysStatus.textContent = msg('passkeyAdded');
    el.passkeysStatus.classList.remove('login-error');
  } finally {
    el.passkeyAdd.disabled = false;
    el.passkeyLabel.disabled = false;
  }
}

async function deletePasskey(passkeyId) {
  el.passkeysStatus.textContent = '';
  const response = await api(`/api/passkeys/${passkeyId}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new RequestError(await readServerError(response), response.status);
  }
  renderPasskeys((await response.json()).passkeys ?? []);
}

function handlePeopleDialogFailure(error) {
  if (error instanceof SessionEndedError) {
    return;
  }
  if (el.peopleDialog.open && !(error instanceof AuthError)) {
    setPeopleStatus(() => failureMessage(error), { error: true });
    return;
  }
  closeDialog(el.peopleDialog);
  handleFailure(error);
}

function livePeopleDialogOptions() {
  return {
    translate: msg,
    alumni: state.alumni,
    onAdd: (personId) => {
      addKnownPerson(personId).catch(handlePeopleDialogFailure);
    },
    onRemove: (personId) => {
      removeMember(personId).catch(handlePeopleDialogFailure);
    },
    onCancelInvite: (inviteId) => {
      cancelInvite(inviteId).catch(handlePeopleDialogFailure);
    },
    showInvite: true,
  };
}

function inviteablePerson(name, alumni) {
  if (!name) {
    return null;
  }
  const matches = alumni.filter((person) => person.name === name);
  return matches.length === 1 ? matches[0] : null;
}

function bindInviteName(node, name, inDemo) {
  const alumni = inDemo ? demoAlumni : state.alumni;
  const person = (inDemo || state.canManage) ? inviteablePerson(name, alumni) : null;
  if (person) {
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    const add = () => {
      if (inDemo) {
        addDemoMember(person.id);
        return;
      }
      addKnownPerson(person.id).catch(handleFailure);
    };
    node.onclick = add;
    node.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        add();
      }
    };
    return;
  }
  node.removeAttribute('role');
  node.removeAttribute('tabindex');
  node.onclick = null;
  node.onkeydown = null;
}

function rebindInviteNames(root, inDemo) {
  for (const who of root.querySelectorAll('.who')) {
    bindInviteName(who, who.textContent, inDemo);
  }
}

function paintPeopleDialog(people, invites, { translate, onRemove, onCancelInvite, onAdd, alumni = [], showInvite = false, fillNames = false }) {
  el.peopleTitle.textContent = translate('people');
  el.peopleClose.textContent = translate('cancel');
  el.invite.textContent = translate('invite');
  el.invite.hidden = !showInvite;
  el.previousTitle.textContent = translate('previousPeople');
  el.pendingTitle.textContent = translate('pendingInvites');
  el.peopleMembers.replaceChildren();
  for (const person of people) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = person.name;
    tintMember(label, person.name);
    label.classList.toggle('member-fill', fillNames);
    item.append(label);
    if (!person.owner) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost-button';
      button.textContent = translate('removePerson');
      button.addEventListener('click', () => onRemove(person.id));
      item.append(button);
    }
    el.peopleMembers.append(item);
  }
  const showAlumni = typeof onAdd === 'function';
  el.previousTitle.hidden = !showAlumni || alumni.length === 0;
  el.previousPeople.hidden = !showAlumni || alumni.length === 0;
  el.previousPeople.replaceChildren();
  if (showAlumni) {
    for (const person of alumni) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'name-action';
      button.textContent = person.name;
      tintMember(button, person.name);
      button.classList.toggle('member-fill', fillNames);
      button.addEventListener('click', () => onAdd(person.id));
      item.append(button);
      el.previousPeople.append(item);
    }
  }
  const showInvites = typeof onCancelInvite === 'function';
  el.pendingTitle.hidden = !showInvites;
  el.pendingInvites.hidden = !showInvites;
  el.pendingInvites.replaceChildren();
  if (!showInvites) {
    return;
  }
  for (const invite of invites) {
    const item = document.createElement('li');
    item.textContent = invite.createdAt;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost-button';
    button.textContent = translate('cancelInvite');
    button.addEventListener('click', () => onCancelInvite(invite.id));
    item.append(button);
    el.pendingInvites.append(item);
  }
}

function paintDialogTheme(dialog, theme, dialogSize) {
  if (theme === 'light' || theme === 'dark') {
    dialog.dataset.theme = theme;
  } else {
    dialog.removeAttribute('data-theme');
  }
  if (dialogSize === 'large' || dialogSize === 'default') {
    dialog.dataset.size = dialogSize;
    return;
  }
  dialog.removeAttribute('data-size');
}

function openPeople() {
  setSettingsOpen(false);
  setPeopleStatus('');
  peopleDialogDemo = false;
  paintDialogTheme(el.peopleDialog, null);
  el.peopleDialog.lang = locale;
  el.peopleDialog.dir = localeDir(locale);
  paintPeopleDialog(state.people, state.invites, livePeopleDialogOptions());
  el.peopleDialog.showModal();
}

function paintDemoSheet(dialog, titleEl, bodyEl, closeEl, titleKey, bodyKey) {
  paintDialogTheme(dialog, resolvedScheme(demoTheme, prefersDark()), demoSize);
  dialog.lang = demoLocale;
  dialog.dir = localeDir(demoLocale);
  titleEl.textContent = demoMsg(titleKey);
  bodyEl.textContent = demoMsg(bodyKey);
  closeEl.textContent = demoMsg('cancel');
}

function openDemoSheet(dialog) {
  setDemoSettingsOpen(false);
  if (!dialog.open) {
    dialog.showModal();
  }
}

function openDemoPeople() {
  setDemoSettingsOpen(false);
  setPeopleStatus('');
  peopleDialogDemo = true;
  paintDialogTheme(el.peopleDialog, resolvedScheme(demoTheme, prefersDark()), demoSize);
  el.peopleDialog.lang = demoLocale;
  el.peopleDialog.dir = localeDir(demoLocale);
  paintPeopleDialog(demoPeople, [], {
    translate: demoMsg,
    alumni: demoAlumni,
    onAdd: addDemoMember,
    onRemove: removeDemoMember,
    fillNames: demoNamesFilled,
    showInvite: true,
  });
  el.peopleDialog.showModal();
}

function removeDemoMember(personId) {
  const person = demoPeople.find((entry) => entry.id === personId);
  demoPeople = demoPeople.filter((entry) => entry.id !== personId);
  if (person && !demoAlumni.some((entry) => entry.id === personId)) {
    demoAlumni = [...demoAlumni, person];
  }
  el.peopleDialog.close();
  renderDemo();
}

function addDemoMember(personId) {
  const person = demoAlumni.find((entry) => entry.id === personId);
  if (!person || demoPeople.some((entry) => entry.id === personId)) {
    return;
  }
  demoAlumni = demoAlumni.filter((entry) => entry.id !== personId);
  demoPeople = [...demoPeople, person];
  if (el.peopleDialog.open && peopleDialogDemo) {
    paintPeopleDialog(demoPeople, [], {
      translate: demoMsg,
      alumni: demoAlumni,
      onAdd: addDemoMember,
      onRemove: removeDemoMember,
      fillNames: demoNamesFilled,
      showInvite: true,
    });
  }
  renderDemo();
}

const addingMembers = new Set();

async function addKnownPerson(personId) {
  if (addingMembers.has(personId)) {
    return;
  }
  addingMembers.add(personId);
  setPeopleStatus('');
  try {
    const response = await api(`/api/members/${personId}`, { method: 'POST', body: {} });
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    const session = await loadSession();
    followIfBusy(session);
    if (session && el.peopleDialog.open) {
      paintPeopleDialog(state.people, state.invites, livePeopleDialogOptions());
    }
  } finally {
    addingMembers.delete(personId);
  }
}

async function removeMember(personId) {
  setPeopleStatus('');
  const response = await api(`/api/members/${personId}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new RequestError(await readServerError(response), response.status);
  }
  el.peopleDialog.close();
  followIfBusy(await loadSession());
}

async function cancelInvite(inviteId) {
  setPeopleStatus('');
  const response = await api(`/api/invites/${inviteId}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new RequestError(await readServerError(response), response.status);
  }
  el.peopleDialog.close();
  followIfBusy(await loadSession());
}

function retryDetail(error) {
  if (error instanceof TypeError) {
    return msg('cannotReach');
  }
  if (error instanceof RequestError) {
    return responseStatusText(error.raw, error.status)();
  }
  return translateError(locale, error.message) || msg('somethingWentWrong');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

el.files.addEventListener('change', () => {
  // Copy first. The FileList is live, and clearing the input empties it.
  // iOS also invalidates those File blobs once the input is cleared, so the
  // bytes are read before that happens.
  const files = [...el.files.files];
  void ingestFiles(files);
});

el.input.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.size > 0);
  if (files.length === 0) {
    return;
  }
  event.preventDefault();
  void ingestFiles(files);
});

el.input.addEventListener('input', () => {
  autoGrow();
  updateComposer();
});

el.input.addEventListener('keydown', (event) => {
  // While a run is active the draft is still editable, so Enter must insert a
  // newline instead of being swallowed. Phones use the button to send.
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || coarsePointer.matches || state.busy) {
    return;
  }
  event.preventDefault();
  sendMessage();
});

el.send.addEventListener('click', () => {
  if (state.busy) {
    stopRun();
  } else {
    sendMessage();
  }
});

el.exportLog.addEventListener('click', () => {
  setSettingsOpen(false);
  exportLog();
});
el.settings.addEventListener('click', onSettingsClick);
document.addEventListener('pointerdown', onDocumentPointerDown);
document.addEventListener('focusin', onDocumentFocusIn);
document.addEventListener('keydown', onDocumentKeyDown);
el.newChat.addEventListener('click', newChat);
el.newChatDialog.addEventListener('click', onNewChatDialogClick);
el.newChatDialog.addEventListener('cancel', onNewChatDialogCancel);
el.joinWarningContinue.addEventListener('click', () => settleSameDeviceJoin?.(true));
el.joinWarningCancel.addEventListener('click', () => settleSameDeviceJoin?.(false));
el.joinWarningDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  settleSameDeviceJoin?.(false);
});
el.passkeyWarningContinue.addEventListener('click', () => settlePasskeyWarning?.(true));
el.passkeyWarningCancel.addEventListener('click', () => settlePasskeyWarning?.(false));
el.passkeyWarningDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  settlePasskeyWarning?.(false);
});
el.loginForm.addEventListener('submit', onLogin);
el.loginJoin.addEventListener('click', () => {
  onJoin().catch(handleFailure);
});
el.loginClose.addEventListener('click', () => closeDialog(el.login));
el.login.addEventListener('close', onLoginDialogClose);
el.landingSettings.addEventListener('click', () => {
  const open = el.landingSettingsPanel.hidden;
  setLandingSettingsOpen(open);
  if (open) {
    setDemoSettingsOpen(false);
  }
});
el.demoSettings.addEventListener('click', () => {
  const open = el.demoSettingsPanel.hidden;
  setDemoSettingsOpen(open);
  if (open) {
    setLandingSettingsOpen(false);
  }
});
el.demoExport.addEventListener('click', () => {
  exportDemo();
});
el.demoMembers.addEventListener('click', () => {
  openDemoPeople();
});
el.demoPasskeys.addEventListener('click', () => {
  openDemoSheet(el.demoPasskeysDialog);
});
el.demoLogOut.addEventListener('click', () => {
  openDemoSheet(el.demoLogOutDialog);
});
el.demoAttach.addEventListener('click', () => {
  openDemoSheet(el.demoAttachDialog);
});
el.demoInput.addEventListener('input', () => {
  autoGrow(el.demoInput);
  updateDemoComposer();
});
el.demoInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || coarsePointer.matches) {
    return;
  }
  event.preventDefault();
  sendDemoMessage();
});
el.demoSend.addEventListener('click', () => {
  sendDemoMessage();
});
el.demoPasskeysClose.addEventListener('click', () => el.demoPasskeysDialog.close());
el.demoAttachClose.addEventListener('click', () => el.demoAttachDialog.close());
el.demoInviteClose.addEventListener('click', () => el.demoInviteDialog.close());
el.demoLogOutClose.addEventListener('click', () => el.demoLogOutDialog.close());
el.demoSpec.addEventListener('click', () => {
  openDemoSpec();
});
el.demoSpecEdit.addEventListener('click', () => {
  editDemoSpec();
});
el.demoSpecBack.addEventListener('click', () => {
  closeDemoSpec();
});
el.landingSignIn.addEventListener('click', () => {
  beginSignIn().catch((error) => {
    setStatus(() => msg('retrying', { detail: retryDetail(error) }));
  });
});
el.landingInvite.addEventListener('click', () => {
  showLogin('', 'join');
});
el.invite.addEventListener('click', () => {
  if (peopleDialogDemo) {
    el.peopleDialog.close();
    openDemoSheet(el.demoInviteDialog);
    return;
  }
  createInvite().catch(handlePeopleDialogFailure);
});
el.people.addEventListener('click', openPeople);
el.peopleClose.addEventListener('click', () => el.peopleDialog.close());
el.peopleDialog.addEventListener('close', () => {
  peopleDialogDemo = false;
  paintDialogTheme(el.peopleDialog, null);
  setPeopleStatus('');
});
el.passkeys.addEventListener('click', () => {
  openPasskeys().catch(handleFailure);
});
el.passkeyAdd.addEventListener('click', () => {
  addPasskey().catch(handlePasskeysDialogFailure);
});
el.passkeyLabel.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  addPasskey().catch(handlePasskeysDialogFailure);
});
el.passkeysClose.addEventListener('click', () => el.passkeysDialog.close());
el.logOut.addEventListener('click', () => {
  logOut().catch(handleFailure);
});
el.staticAssets.addEventListener('click', onStaticAssetsClick);
el.staticAssets.addEventListener('keydown', onStaticAssetsKey);
el.locale.addEventListener('click', onLocaleClick);
el.landingLocale.addEventListener('click', onLocaleClick);
el.demoLocale.addEventListener('click', onDemoLocaleClick);
el.locale.addEventListener('keydown', onLocaleKey);
el.landingLocale.addEventListener('keydown', onLocaleKey);
el.demoLocale.addEventListener('keydown', onDemoLocaleKey);
el.theme.addEventListener('click', onThemeClick);
el.landingTheme.addEventListener('click', onThemeClick);
el.demoTheme.addEventListener('click', onDemoThemeClick);
el.size.addEventListener('click', onSizeClick);
el.landingSize.addEventListener('click', onSizeClick);
el.demoSize.addEventListener('click', onDemoSizeClick);
el.theme.addEventListener('keydown', onThemeKey);
el.landingTheme.addEventListener('keydown', onThemeKey);
el.demoTheme.addEventListener('keydown', onDemoThemeKey);
el.size.addEventListener('keydown', onSizeKey);
el.landingSize.addEventListener('keydown', onSizeKey);
el.demoSize.addEventListener('keydown', onDemoSizeKey);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme === 'system') {
    applyTheme();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !sessionToken || state.streaming || state.following) {
    return;
  }
  loadSession()
    .then((session) => {
      if (session?.busy && !state.listing) {
        followUntilIdle();
      }
    })
    .catch(handleFailure);
});

// The layout viewport stays full height when the on-screen keyboard is open.
// Track the visual viewport so the composer stays on screen.
function syncAppToVisualViewport() {
  const viewport = window.visualViewport;
  if (!viewport) {
    return;
  }
  document.documentElement.style.setProperty('--app-height', `${viewport.height}px`);
  document.documentElement.style.setProperty('--app-offset', `${viewport.offsetTop}px`);
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncAppToVisualViewport);
  window.visualViewport.addEventListener('scroll', syncAppToVisualViewport);
  syncAppToVisualViewport();
}

fillStaticAssetsPicker();
fillLocalePicker(el.locale);
fillLocalePicker(el.landingLocale);
fillLocalePicker(el.demoLocale);
fillThemePicker(el.theme);
fillThemePicker(el.landingTheme);
fillThemePicker(el.demoTheme);
fillSizePicker(el.size);
fillSizePicker(el.landingSize);
fillSizePicker(el.demoSize);
applyChrome();
applyDemoChrome();
startDemoConversation();
bootstrap();
