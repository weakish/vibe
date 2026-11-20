import { applyOp } from '../shared/transcript.js';
import {
  buildConversationEpub,
  buildPrintHtmlDocument,
  conversationEpubFilename,
  conversationLogFilename,
  conversationMarkdownFilename,
  conversationPrintFilename,
  formatConversationLog,
  formatConversationLogMarkdown,
  mediaIdsInItems,
} from '../shared/export.js';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../shared/limits.js';
import {
  CREDENTIALS_KEY,
  LEGACY_TOKEN_KEY,
  RADIO_NAV_KEYS,
  SESSION_KEY,
  applyLandingChrome,
  applyLandingGate,
  authGate,
  clearJoinParam,
  currentLandingStatus,
  currentLandingStatusAlert,
  ensureLocalePickers,
  fillSizePicker,
  fillThemePicker,
  joinId,
  locale,
  msg,
  onLocaleClick,
  onLocaleKey,
  onSizeClick,
  onSizeKey,
  onThemeClick,
  onThemeKey,
  prefersDark,
  refreshAuthGate,
  paintLocaleTriggers,
  paintStatusMessage,
  registerLocaleGroup,
  registerLocaleTrigger,
  setAfterLandingSettingsToggle,
  setLandingLanguageOpen,
  setLandingSettingsOpen,
  setLandingStatus,
  setOnChromeError,
  setPaintChrome,
  size,
  syncLocalePicker,
  syncSizePicker,
  syncThemePicker,
  theme,
} from './chrome.js';
import { ensureLocale, localeDir, nextRadioIndex, resolveLocale, splitMarked, t, translateError } from './i18n.js';
import { memberHue } from './member-color.js';
import { resolveSize, resolveTheme, resolvedScheme } from './theme.js';
import { renderMarkdown } from './markdown.js';
import { createJoinPasskey, createPasskey, getPasskey, JoinDeclinedError, supportsPasskey } from './passkey.js';
import { readWithStallTimeout } from './stream.js';

const STATIC_ASSET_MODES = ['dev', 'release'];
const STATIC_ASSET_LABELS = { dev: 'staticAssetsDevelopment', release: 'staticAssetsRelease' };
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
  exportLabel: document.getElementById('export-label'),
  exportJson: document.getElementById('export-json'),
  exportMarkdown: document.getElementById('export-markdown'),
  exportEpub: document.getElementById('export-epub'),
  exportPrint: document.getElementById('export-print'),
  exportDialog: document.getElementById('export-dialog'),
  exportDialogTitle: document.getElementById('export-dialog-title'),
  exportDialogCancel: document.getElementById('export-dialog-cancel'),
  viewMenuHost: document.getElementById('view-menu-host'),
  viewOpen: document.getElementById('view-open'),
  viewPanel: document.getElementById('view-panel'),
  viewChat: document.getElementById('view-chat'),
  viewShopping: document.getElementById('view-shopping'),
  viewFiles: document.getElementById('view-files'),
  viewOverview: document.getElementById('view-overview'),
  filesView: document.getElementById('files-view'),
  filesTitle: document.getElementById('files-title'),
  filesStatus: document.getElementById('files-status'),
  filesConversationHeading: document.getElementById('files-conversation-heading'),
  filesConversationList: document.getElementById('files-conversation-list'),
  filesConversationEmpty: document.getElementById('files-conversation-empty'),
  filesWorkdirSection: document.getElementById('files-workdir-section'),
  filesWorkdirHeading: document.getElementById('files-workdir-heading'),
  filesWorkdirList: document.getElementById('files-workdir-list'),
  filesWorkdirEmpty: document.getElementById('files-workdir-empty'),
  overviewView: document.getElementById('overview-view'),
  overviewTitle: document.getElementById('overview-title'),
  overviewStatus: document.getElementById('overview-status'),
  overviewEmpty: document.getElementById('overview-empty'),
  overviewStory: document.getElementById('overview-story'),
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
  usageLine: document.getElementById('usage-line'),
  usageBar: document.getElementById('usage-bar'),
  usageFill: document.getElementById('usage-bar-fill'),
  usageTip: document.getElementById('usage-tip'),
  usageField: document.getElementById('usage-field'),
  usageRefreshStatus: document.getElementById('usage-refresh-status'),
  usageRefresh: document.getElementById('usage-refresh'),
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
  shopping: document.getElementById('shopping'),
  shoppingStatus: document.getElementById('shopping-status'),
  shoppingWantedHeading: document.getElementById('shopping-wanted-heading'),
  shoppingWantedList: document.getElementById('shopping-wanted-list'),
  shoppingEmpty: document.getElementById('shopping-empty'),
  shoppingBoughtSection: document.getElementById('shopping-bought-section'),
  shoppingBoughtHeading: document.getElementById('shopping-bought-heading'),
  shoppingBoughtList: document.getElementById('shopping-bought-list'),
  newChat: document.getElementById('new-chat'),
  language: document.getElementById('language'),
  languageFlag: document.getElementById('language-flag'),
  languagePanel: document.getElementById('language-panel'),
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
  demoPlay: document.getElementById('demo-play'),
  landingStatus: document.getElementById('landing-status'),
  landingSignIn: document.getElementById('landing-signin'),
  demoLanguage: document.getElementById('demo-language'),
  demoLanguageFlag: document.getElementById('demo-language-flag'),
  demoLanguagePanel: document.getElementById('demo-language-panel'),
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
  newChatAgentField: document.getElementById('new-chat-agent-field'),
  newChatAgentLabel: document.getElementById('new-chat-agent-label'),
  newChatAgent: document.getElementById('new-chat-agent'),
  newChatModelField: document.getElementById('new-chat-model-field'),
  newChatModelLabel: document.getElementById('new-chat-model-label'),
  newChatModel: document.getElementById('new-chat-model'),
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
let pendingKeptLogId = null;

const state = {
  items: [],
  nodes: new Map(),
  agent: '',
  model: '',
  agents: [],
  draftAgent: '',
  draftModel: '',
  you: null,
  canManage: false,
  people: [],
  alumni: [],
  invites: [],
  listing: false,
  shopping: false,
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
let staticAssetsMode = 'dev';
let staticAssetsStale = false;
let staticAssetsBundling = false;
let staticAssetsBusy = false;
let staticAssetsRefresh = null;
let staticAssetsGeneration = 0;
// False until the server has confirmed the mode, so the picker never shows a guess.
let staticAssetsLoaded = false;
let grokUsage = null;
let grokUsageLoaded = false;
let grokUsageRefresh = null;
let grokUsageGeneration = 0;
let grokUsageFetchInFlight = false;
let demoLocale = locale;
let demoLocaleChangeGeneration = 0;
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
let demoMounted = false;
let demoShellPromise = null;
let demoEventsBound = false;
let appMounted = false;
let appShellPromise = null;
let appEventsBound = false;
let shoppingItems = [];
let shoppingBusy = false;
let shoppingPoll = null;
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
let pendingRegistration = null;

function demoMsg(key, vars) {
  return t(demoLocale, key, vars);
}

function applyChrome() {
  applyLandingChrome();
  el.loginInviteOnly.textContent = msg('inviteOnly');
  el.invite.textContent = msg('invite');
  el.loginJoin.textContent = msg('joinAction');
  el.loginClose.textContent = msg('cancel');
  el.peopleTitle.textContent = msg('people');
  el.previousTitle.textContent = msg('previousPeople');
  el.pendingTitle.textContent = msg('pendingInvites');
  el.peopleClose.textContent = msg('cancel');
  el.loginUsername.placeholder = msg('username');
  el.loginUsername.setAttribute('aria-label', msg('username'));
  el.loginPassword.placeholder = msg('password');
  el.loginSubmit.textContent = msg('unlock');
  applyLoginMode();
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
  if (!appMounted) {
    return;
  }
  el.language?.setAttribute('aria-label', msg('language'));
  el.settings.setAttribute('aria-label', msg('settings'));
  el.newChat.setAttribute('aria-label', msg('newChat'));
  if (el.viewOpen) {
    el.viewOpen.setAttribute('aria-label', msg('filesView'));
  }
  if (el.viewChat) {
    el.viewChat.textContent = msg('specBack');
    el.viewShopping.textContent = msg('shopping');
    el.viewFiles.textContent = msg('files');
    el.viewOverview.textContent = msg('overview');
  }
  el.themeLabel.textContent = msg('theme');
  el.sizeLabel.textContent = msg('size');
  syncThemePicker(el.theme);
  syncSizePicker(el.size);
  el.localeLabel.textContent = msg('language');
  if (el.usageBar) {
    el.usageBar.setAttribute('aria-label', msg('usage'));
  }
  if (el.usageRefresh) {
    el.usageRefresh.textContent = msg('grokUsageRefresh');
  }
  paintUsage();
  el.staticAssetsLabel.textContent = msg('staticAssets');
  syncLocalePicker(el.locale);
  syncStaticAssetsPicker();
  paintStaticAssetsStatus();
  el.exportLabel.textContent = msg('exportLog');
  el.exportJson.textContent = msg('exportJson');
  el.exportMarkdown.textContent = msg('exportMarkdown');
  el.exportEpub.textContent = msg('exportEpub');
  el.exportPrint.textContent = msg('exportPrint');
  if (el.exportDialogTitle) {
    el.exportDialogTitle.textContent = msg('exportEndedTitle');
  }
  for (const button of el.exportDialog?.querySelectorAll('[data-export-format]') ?? []) {
    const format = button.dataset.exportFormat;
    if (format === 'json') {
      button.textContent = msg('exportJson');
    } else if (format === 'markdown') {
      button.textContent = msg('exportMarkdown');
    } else if (format === 'epub') {
      button.textContent = msg('exportEpub');
    } else if (format === 'print') {
      button.textContent = msg('exportPrint');
    }
  }
  el.exportDialogCancel.textContent = msg('cancel');
  if (el.filesTitle) {
    el.filesTitle.textContent = msg('filesTitle');
    el.filesConversationHeading.textContent = msg('filesConversation');
    el.filesWorkdirHeading.textContent = msg('filesWorkdir');
    el.filesConversationEmpty.textContent = msg('filesEmpty');
    el.filesWorkdirEmpty.textContent = msg('filesEmpty');
  }
  if (el.overviewTitle) {
    el.overviewTitle.textContent = msg('overviewTitle');
    el.overviewEmpty.textContent = msg('overviewEmpty');
  }
  el.people.textContent = msg('people');
  el.passkeys.textContent = msg('passkeys');
  el.passkeysTitle.textContent = msg('passkeys');
  el.passkeyAdd.textContent = msg('addPasskey');
  el.passkeyLabel.placeholder = msg('passkeyLabel');
  el.passkeyLabel.setAttribute('aria-label', msg('passkeyLabel'));
  el.passkeysClose.textContent = msg('cancel');
  el.logOut.textContent = msg('logOut');
  el.specLink.textContent = msg('spec');
  paintShoppingChrome();
  paintLocaleTriggers();
  el.conversationListTitle.textContent = msg('conversationList');
  el.emptyTitle.textContent = msg('emptyGreeting');
  el.typing.setAttribute('aria-label', msg('typing'));
  el.input.placeholder = msg('messagePlaceholder');
  el.input.setAttribute('aria-label', msg('messageAria'));
  el.attach.setAttribute('aria-label', msg('attach'));
  renderPending();
  for (const when of el.passkeyEntries.querySelectorAll('.passkey-when')) {
    when.textContent = when.dataset.time ? msg('passkeyAddedAt', { time: when.dataset.time }) : '';
  }
  el.newChatTitle.textContent = msg('newChat');
  el.newChatBody.textContent = msg('confirmNewChat');
  el.newChatAgentLabel.textContent = msg('agentLabel');
  el.newChatModelLabel.textContent = msg('modelLabel');
  syncAgentPicker();
  syncModelPicker();
  el.newChatExport.textContent = msg('newChatExport');
  el.newChatClear.textContent = msg('newChatClear');
  el.newChatCancel.textContent = msg('cancel');
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
  if (!demoMounted) {
    return;
  }
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
  el.demoLanguage?.setAttribute('aria-label', demoMsg('language'));
  el.demoSettings.setAttribute('aria-label', demoMsg('settings'));
  el.demoThemeLabel.textContent = demoMsg('theme');
  el.demoSizeLabel.textContent = demoMsg('size');
  syncThemePicker(el.demoTheme, demoTheme, demoMsg);
  syncSizePicker(el.demoSize, demoSize, demoMsg);
  el.demoLocaleLabel.textContent = demoMsg('language');
  syncLocalePicker(el.demoLocale, demoLocale);
  paintLocaleTriggers();
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
  changeDemoLocale(option.dataset.locale).catch(handleFailure);
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
  changeDemoLocale(options[next].dataset.locale).catch(handleFailure);
}

async function changeDemoLocale(next) {
  const id = resolveLocale([next]);
  const generation = ++demoLocaleChangeGeneration;
  await ensureLocale(id);
  if (generation !== demoLocaleChangeGeneration) {
    return;
  }
  demoLocale = id;
  applyDemoChrome();
  startDemoConversation();
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
  if (!el.staticAssets) {
    return;
  }
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
  if (!el.staticAssetsStatus) {
    return;
  }
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

function resetGrokUsage() {
  grokUsageGeneration += 1;
  grokUsageRefresh = null;
  grokUsage = null;
  grokUsageLoaded = false;
  grokUsageFetchInFlight = false;
  paintUsage();
}

function requestGrokUsage({ fresh = false } = {}) {
  if (!sessionToken || !state.you?.inConversation) {
    return;
  }
  // A refresh owns the quota line until it finishes. Opening Settings (a
  // fresh poll) must not drop that result for a cached GET.
  if (grokUsageFetchInFlight) {
    return;
  }
  if (fresh) {
    grokUsageGeneration += 1;
    grokUsageRefresh = null;
  }
  if (grokUsageRefresh) {
    return;
  }
  const generation = grokUsageGeneration;
  const request = fetchGrokUsage(generation, fresh).finally(() => {
    if (grokUsageRefresh === request) {
      grokUsageRefresh = null;
    }
  });
  grokUsageRefresh = request;
  request.catch(handleFailure);
}

async function fetchGrokUsage(generation, fresh) {
  const response = await api(fresh ? '/api/usage?fresh=1' : '/api/usage');
  if (generation !== grokUsageGeneration) {
    response.body?.cancel()?.catch(() => {});
    return;
  }
  if (response.status === 403) {
    response.body?.cancel()?.catch(() => {});
    resetGrokUsage();
    return;
  }
  if (!response.ok) {
    throw new RequestError(await readServerError(response), response.status);
  }
  const body = await response.json();
  if (generation !== grokUsageGeneration) {
    return;
  }
  grokUsage = body.grok ?? null;
  grokUsageLoaded = true;
  paintUsage();
}

function usageText(entry) {
  if (!entry.available) {
    return msg('grokUsageUnavailable');
  }
  const percent = Number(entry.percent);
  if (!Number.isFinite(percent)) {
    return msg('grokUsageUnavailable');
  }
  const rounded = String(Math.round(percent));
  if (entry.period === 'monthly') {
    return msg('grokMonthlyQuota', { percent: rounded });
  }
  return msg('grokWeeklyQuota', { percent: rounded });
}

function usageTip(entry) {
  const text = usageText(entry);
  if (!entry.available || !entry.resetsAt) {
    return text;
  }
  const reset = new Date(entry.resetsAt);
  if (Number.isNaN(reset.getTime())) {
    return text;
  }
  return `${text}\n${reset.toLocaleString(locale)}`;
}

function setUsageRefreshStatus(text) {
  if (!el.usageRefreshStatus) {
    return;
  }
  el.usageRefreshStatus.textContent = text;
  el.usageRefreshStatus.hidden = !text;
}

function paintUsage() {
  if (!el.usageField || !el.usageLine || !el.usageBar || !el.usageFill || !el.usageTip) {
    return;
  }
  const show = grokUsageLoaded && grokUsage !== null;
  el.usageField.hidden = !show;
  el.usageLine.hidden = !show;
  if (el.usageRefresh) {
    el.usageRefresh.hidden = !show;
    el.usageRefresh.disabled = grokUsageFetchInFlight;
  }
  if (!show) {
    el.usageTip.textContent = '';
    el.usageFill.style.width = '0';
    el.usageBar.removeAttribute('aria-valuenow');
    el.usageBar.removeAttribute('aria-valuetext');
    setUsageRefreshStatus('');
    return;
  }
  const tip = usageTip(grokUsage);
  el.usageTip.textContent = tip;
  el.usageBar.setAttribute('aria-valuetext', tip.replaceAll('\n', ', '));
  el.usageBar.setAttribute('aria-valuemin', '0');
  if (grokUsage.available && Number.isFinite(Number(grokUsage.percent))) {
    const percent = Number(grokUsage.percent);
    const rounded = Math.max(0, Math.round(percent));
    el.usageFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    el.usageBar.setAttribute('aria-valuemax', String(Math.max(100, rounded)));
    el.usageBar.setAttribute('aria-valuenow', String(rounded));
    return;
  }
  el.usageFill.style.width = '0';
  el.usageBar.setAttribute('aria-valuemax', '100');
  el.usageBar.setAttribute('aria-valuenow', '0');
}

async function refreshGrokUsageFromServer() {
  if (!sessionToken || !state.you?.inConversation || grokUsageFetchInFlight) {
    return;
  }
  grokUsageFetchInFlight = true;
  grokUsageGeneration += 1;
  grokUsageRefresh = null;
  const generation = grokUsageGeneration;
  setUsageRefreshStatus(msg('grokUsageRefreshing'));
  paintUsage();
  try {
    const response = await api('/api/usage/refresh', { method: 'POST' });
    if (generation !== grokUsageGeneration) {
      response.body?.cancel()?.catch(() => {});
      return;
    }
    if (response.status === 403) {
      response.body?.cancel()?.catch(() => {});
      resetGrokUsage();
      return;
    }
    if (!response.ok) {
      const message = await readServerError(response);
      if (generation !== grokUsageGeneration) {
        return;
      }
      setUsageRefreshStatus(translateError(locale, message) || msg('grokUsageRefreshFailed'));
      return;
    }
    const body = await response.json();
    if (generation !== grokUsageGeneration) {
      return;
    }
    grokUsage = body.grok ?? null;
    grokUsageLoaded = true;
    setUsageRefreshStatus('');
  } catch (error) {
    if (generation !== grokUsageGeneration) {
      return;
    }
    setUsageRefreshStatus(failureMessage(error));
  } finally {
    if (generation === grokUsageGeneration) {
      grokUsageFetchInFlight = false;
      paintUsage();
    }
  }
}

function onUsageRefreshClick() {
  refreshGrokUsageFromServer().catch(handleFailure);
}

function resetStaticAssets() {
  staticAssetsGeneration += 1;
  staticAssetsRefresh = null;
  staticAssetsMode = 'dev';
  staticAssetsStale = false;
  staticAssetsBundling = false;
  staticAssetsBusy = false;
  staticAssetsLoaded = false;
  if (el.staticAssetsField) {
    el.staticAssetsField.hidden = true;
  }
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

function setDemoLanguageOpen(open) {
  if (!el.demoLanguagePanel) {
    return;
  }
  el.demoLanguagePanel.hidden = !open;
  el.demoLanguage?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    setDemoSettingsOpen(false);
    setLandingLanguageOpen(false);
    setLandingSettingsOpen(false);
    setLanguageOpen(false);
    setSettingsOpen(false);
    ensureLocalePickers().catch(handleFailure);
  }
}

function setDemoSettingsOpen(open) {
  if (!el.demoSettingsPanel) {
    return;
  }
  el.demoSettingsPanel.hidden = !open;
  el.demoSettings.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    setDemoLanguageOpen(false);
    setLandingLanguageOpen(false);
    setLandingSettingsOpen(false);
    setLanguageOpen(false);
    setSettingsOpen(false);
  }
}

function setLanguageOpen(open) {
  if (!el.languagePanel) {
    return;
  }
  el.languagePanel.hidden = !open;
  el.language?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    setSettingsOpen(false);
    setViewOpen(false);
    setDemoLanguageOpen(false);
    setDemoSettingsOpen(false);
    setLandingLanguageOpen(false);
    setLandingSettingsOpen(false);
    ensureLocalePickers().catch(handleFailure);
  }
}

function setSettingsOpen(open) {
  if (el.settingsPanel) {
    el.settingsPanel.hidden = !open;
    el.settings.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (open) {
    setLanguageOpen(false);
    setViewOpen(false);
    setDemoLanguageOpen(false);
    setDemoSettingsOpen(false);
    setLandingLanguageOpen(false);
    setLandingSettingsOpen(false);
    requestStaticAssets();
    requestGrokUsage({ fresh: true });
  }
}

function setViewOpen(open) {
  if (!el.viewPanel) {
    return;
  }
  el.viewPanel.hidden = !open;
  el.viewOpen?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    setLanguageOpen(false);
    setSettingsOpen(false);
    setDemoLanguageOpen(false);
    setDemoSettingsOpen(false);
    setLandingLanguageOpen(false);
    setLandingSettingsOpen(false);
  }
}

function isLanguageTarget(node) {
  return Boolean(node && el.language) && (el.language.contains(node) || el.languagePanel?.contains(node));
}

function isSettingsTarget(node) {
  return Boolean(node && el.settings) && (el.settings.contains(node) || el.settingsPanel.contains(node));
}

function isViewTarget(node) {
  return Boolean(node && el.viewOpen) && (el.viewOpen.contains(node) || el.viewPanel?.contains(node));
}

function isAppChromeMenuTarget(node) {
  return isLanguageTarget(node) || isSettingsTarget(node) || isViewTarget(node);
}

function isDemoLanguageTarget(node) {
  return (
    Boolean(node && el.demoLanguage) && (el.demoLanguage.contains(node) || el.demoLanguagePanel?.contains(node))
  );
}

function isDemoSettingsTarget(node) {
  return Boolean(node && el.demoSettings) && (el.demoSettings.contains(node) || el.demoSettingsPanel.contains(node));
}

function isDemoChromeMenuTarget(node) {
  return isDemoLanguageTarget(node) || isDemoSettingsTarget(node);
}

function onLanguageClick() {
  const opening = el.languagePanel.hidden;
  setLanguageOpen(opening);
}

function onSettingsClick() {
  const opening = el.settingsPanel.hidden;
  setSettingsOpen(opening);
}

function onViewClick() {
  const opening = el.viewPanel.hidden;
  setViewOpen(opening);
}

function closeAppChromeMenus() {
  setLanguageOpen(false);
  setSettingsOpen(false);
  setViewOpen(false);
}

function closeLandingAndDemoMenus() {
  setLandingLanguageOpen(false);
  setLandingSettingsOpen(false);
  setDemoLanguageOpen(false);
  setDemoSettingsOpen(false);
}

function onDocumentPointerDown(event) {
  if (!isAppChromeMenuTarget(event.target)) {
    closeAppChromeMenus();
  }
  if (!isDemoChromeMenuTarget(event.target)) {
    setDemoLanguageOpen(false);
    setDemoSettingsOpen(false);
  }
}

function onDocumentFocusIn(event) {
  if (!isAppChromeMenuTarget(event.target)) {
    closeAppChromeMenus();
  }
  if (!isDemoChromeMenuTarget(event.target)) {
    setDemoLanguageOpen(false);
    setDemoSettingsOpen(false);
  }
}

function onDocumentKeyDown(event) {
  // While any dialog is open it handles Escape, so the settings panels are left alone.
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) {
    return;
  }
  if (el.demoLanguagePanel && !el.demoLanguagePanel.hidden) {
    setDemoLanguageOpen(false);
    el.demoLanguage?.focus();
    return;
  }
  if (el.demoSettingsPanel && !el.demoSettingsPanel.hidden) {
    setDemoSettingsOpen(false);
    el.demoSettings.focus();
    return;
  }
  if (el.languagePanel && !el.languagePanel.hidden) {
    setLanguageOpen(false);
    el.language?.focus();
    return;
  }
  if (el.settingsPanel && !el.settingsPanel.hidden) {
    setSettingsOpen(false);
    el.settings.focus();
    return;
  }
  if (el.viewPanel && !el.viewPanel.hidden) {
    setViewOpen(false);
    el.viewOpen?.focus();
    return;
  }
  if (state.view && state.view !== 'chat') {
    setActiveView('chat');
    el.viewOpen?.focus();
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
  resetGrokUsage();
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
  requestGrokUsage();
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
  if (el.staticAssetsField) {
    el.staticAssetsField.hidden = !state.canManage;
  }
  if (!state.you?.inConversation) {
    resetGrokUsage();
  }
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

function parseHtmlFragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

async function fetchFragment(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) {
    throw new RequestError(await readServerError(response), response.status);
  }
  return parseHtmlFragment(await response.text());
}

function ensureAppShell() {
  if (appMounted) {
    return Promise.resolve();
  }
  if (!appShellPromise) {
    appShellPromise = loadAppShell().catch((error) => {
      appShellPromise = null;
      throw error;
    });
  }
  return appShellPromise;
}

async function loadAppShell() {
  if (!document.getElementById('app')) {
    const fragment = await fetchFragment('/app-shell.html');
    if (!document.getElementById('app')) {
      el.landing.before(fragment);
    }
  }
  captureAppElements();
  if (!appEventsBound) {
    bindAppEvents();
    fillStaticAssetsPicker();
    fillThemePicker(el.theme);
    fillSizePicker(el.size);
    registerLocaleGroup(el.locale);
    registerLocaleTrigger(el.languageFlag);
    appEventsBound = true;
  }
  // applyChrome paints the app only once this is set, and it clears on failure
  // so a later sign-in can try the load again.
  appMounted = true;
  try {
    applyChrome();
  } catch (error) {
    appMounted = false;
    throw error;
  }
}

function captureAppElements() {
  el.app = document.getElementById('app');
  el.status = document.getElementById('status');
  el.exportLabel = document.getElementById('export-label');
  el.exportJson = document.getElementById('export-json');
  el.exportMarkdown = document.getElementById('export-markdown');
  el.exportEpub = document.getElementById('export-epub');
  el.exportPrint = document.getElementById('export-print');
  el.exportDialog = document.getElementById('export-dialog');
  el.exportDialogTitle = document.getElementById('export-dialog-title');
  el.exportDialogCancel = document.getElementById('export-dialog-cancel');
  el.viewMenuHost = document.getElementById('view-menu-host');
  el.viewOpen = document.getElementById('view-open');
  el.viewPanel = document.getElementById('view-panel');
  el.viewChat = document.getElementById('view-chat');
  el.viewShopping = document.getElementById('view-shopping');
  el.viewFiles = document.getElementById('view-files');
  el.viewOverview = document.getElementById('view-overview');
  el.overviewView = document.getElementById('overview-view');
  el.overviewTitle = document.getElementById('overview-title');
  el.overviewStatus = document.getElementById('overview-status');
  el.overviewEmpty = document.getElementById('overview-empty');
  el.overviewStory = document.getElementById('overview-story');
  el.filesView = document.getElementById('files-view');
  el.filesTitle = document.getElementById('files-title');
  el.filesStatus = document.getElementById('files-status');
  el.filesConversationHeading = document.getElementById('files-conversation-heading');
  el.filesConversationList = document.getElementById('files-conversation-list');
  el.filesConversationEmpty = document.getElementById('files-conversation-empty');
  el.filesWorkdirSection = document.getElementById('files-workdir-section');
  el.filesWorkdirHeading = document.getElementById('files-workdir-heading');
  el.filesWorkdirList = document.getElementById('files-workdir-list');
  el.filesWorkdirEmpty = document.getElementById('files-workdir-empty');
  el.people = document.getElementById('people');
  el.passkeys = document.getElementById('passkeys');
  el.passkeysDialog = document.getElementById('passkeys-dialog');
  el.passkeysTitle = document.getElementById('passkeys-title');
  el.passkeyEntries = document.getElementById('passkey-entries');
  el.passkeysStatus = document.getElementById('passkeys-status');
  el.passkeyAdd = document.getElementById('passkey-add');
  el.passkeyLabel = document.getElementById('passkey-label');
  el.passkeysClose = document.getElementById('passkeys-close');
  el.logOut = document.getElementById('log-out');
  el.peopleLine = document.getElementById('people-line');
  el.usageLine = document.getElementById('usage-line');
  el.usageBar = document.getElementById('usage-bar');
  el.usageFill = document.getElementById('usage-bar-fill');
  el.usageTip = document.getElementById('usage-tip');
  el.usageField = document.getElementById('usage-field');
  el.usageRefreshStatus = document.getElementById('usage-refresh-status');
  el.usageRefresh = document.getElementById('usage-refresh');
  el.conversationList = document.getElementById('conversation-list');
  el.conversationListTitle = document.getElementById('conversation-list-title');
  el.conversationEntries = document.getElementById('conversation-entries');
  el.specLink = document.getElementById('spec-link');
  el.shopping = document.getElementById('shopping');
  el.shoppingStatus = document.getElementById('shopping-status');
  el.shoppingWantedHeading = document.getElementById('shopping-wanted-heading');
  el.shoppingWantedList = document.getElementById('shopping-wanted-list');
  el.shoppingEmpty = document.getElementById('shopping-empty');
  el.shoppingBoughtSection = document.getElementById('shopping-bought-section');
  el.shoppingBoughtHeading = document.getElementById('shopping-bought-heading');
  el.shoppingBoughtList = document.getElementById('shopping-bought-list');
  el.newChat = document.getElementById('new-chat');
  el.language = document.getElementById('language');
  el.languageFlag = document.getElementById('language-flag');
  el.languagePanel = document.getElementById('language-panel');
  el.settings = document.getElementById('settings');
  el.settingsPanel = document.getElementById('settings-panel');
  el.locale = document.getElementById('locale');
  el.localeLabel = document.getElementById('locale-label');
  el.staticAssetsField = document.getElementById('static-assets-field');
  el.staticAssets = document.getElementById('static-assets');
  el.staticAssetsLabel = document.getElementById('static-assets-label');
  el.staticAssetsStatus = document.getElementById('static-assets-status');
  el.theme = document.getElementById('theme');
  el.themeLabel = document.getElementById('theme-label');
  el.size = document.getElementById('size');
  el.sizeLabel = document.getElementById('size-label');
  el.empty = document.getElementById('empty');
  el.emptyTitle = document.getElementById('empty-title');
  el.messages = document.getElementById('messages');
  el.transcript = document.getElementById('transcript');
  el.typing = document.getElementById('typing');
  el.input = document.getElementById('input');
  el.pending = document.getElementById('pending');
  el.attach = document.getElementById('attach');
  el.files = document.getElementById('files');
  el.send = document.getElementById('send');
  el.newChatDialog = document.getElementById('new-chat-dialog');
  el.newChatTitle = document.getElementById('new-chat-title');
  el.newChatBody = document.getElementById('new-chat-body');
  el.newChatAgentField = document.getElementById('new-chat-agent-field');
  el.newChatAgentLabel = document.getElementById('new-chat-agent-label');
  el.newChatAgent = document.getElementById('new-chat-agent');
  el.newChatModelField = document.getElementById('new-chat-model-field');
  el.newChatModelLabel = document.getElementById('new-chat-model-label');
  el.newChatModel = document.getElementById('new-chat-model');
  el.newChatExport = document.getElementById('new-chat-export');
  el.newChatClear = document.getElementById('new-chat-clear');
  el.newChatCancel = document.getElementById('new-chat-cancel');
}

function captureDemoElements() {
  el.demoLanguage = document.getElementById('demo-language');
  el.demoLanguageFlag = document.getElementById('demo-language-flag');
  el.demoLanguagePanel = document.getElementById('demo-language-panel');
  el.demoSettings = document.getElementById('demo-settings');
  el.demoSettingsPanel = document.getElementById('demo-settings-panel');
  el.demoTheme = document.getElementById('demo-theme');
  el.demoThemeLabel = document.getElementById('demo-theme-label');
  el.demoSize = document.getElementById('demo-size');
  el.demoSizeLabel = document.getElementById('demo-size-label');
  el.demoLocale = document.getElementById('demo-locale');
  el.demoLocaleLabel = document.getElementById('demo-locale-label');
  el.demoExport = document.getElementById('demo-export');
  el.demoMembers = document.getElementById('demo-members');
  el.demoPasskeys = document.getElementById('demo-passkeys');
  el.demoPasskeysDialog = document.getElementById('demo-passkeys-dialog');
  el.demoPasskeysTitle = document.getElementById('demo-passkeys-title');
  el.demoPasskeysBody = document.getElementById('demo-passkeys-body');
  el.demoPasskeysClose = document.getElementById('demo-passkeys-close');
  el.demoAttachDialog = document.getElementById('demo-attach-dialog');
  el.demoAttachTitle = document.getElementById('demo-attach-title');
  el.demoAttachBody = document.getElementById('demo-attach-body');
  el.demoAttachClose = document.getElementById('demo-attach-close');
  el.demoInviteDialog = document.getElementById('demo-invite-dialog');
  el.demoInviteTitle = document.getElementById('demo-invite-title');
  el.demoInviteBody = document.getElementById('demo-invite-body');
  el.demoInviteClose = document.getElementById('demo-invite-close');
  el.demoLogOut = document.getElementById('demo-log-out');
  el.demoLogOutDialog = document.getElementById('demo-log-out-dialog');
  el.demoLogOutTitle = document.getElementById('demo-log-out-title');
  el.demoLogOutBody = document.getElementById('demo-log-out-body');
  el.demoLogOutClose = document.getElementById('demo-log-out-close');
  el.demoSpec = document.getElementById('demo-spec');
  el.demoSpecBack = document.getElementById('demo-spec-back');
  el.demoSpecEdit = document.getElementById('demo-spec-edit');
  el.demoSpecView = document.getElementById('demo-spec-view');
  el.demoSpecStatus = document.getElementById('demo-spec-status');
  el.demoSpecRendered = document.getElementById('demo-spec-rendered');
  el.demoTitle = document.getElementById('demo-title');
  el.demoPeople = document.getElementById('demo-people');
  el.demoMessages = document.getElementById('demo-messages');
  el.demoTranscript = document.getElementById('demo-transcript');
  el.demoTyping = document.getElementById('demo-typing');
  el.demoComposer = document.getElementById('demo-composer');
  el.demoAttach = document.getElementById('demo-attach');
  el.demoInput = document.getElementById('demo-input');
  el.demoSend = document.getElementById('demo-send');
}

function bindDemoEvents() {
  registerLocaleTrigger(el.demoLanguageFlag, () => demoLocale);
  el.demoLanguage?.addEventListener('click', () => {
    const open = el.demoLanguagePanel.hidden;
    setDemoLanguageOpen(open);
  });
  el.demoSettings.addEventListener('click', () => {
    const open = el.demoSettingsPanel.hidden;
    setDemoSettingsOpen(open);
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
  el.demoLocale.addEventListener('click', onDemoLocaleClick);
  el.demoLocale.addEventListener('keydown', onDemoLocaleKey);
  el.demoTheme.addEventListener('click', onDemoThemeClick);
  el.demoSize.addEventListener('click', onDemoSizeClick);
  el.demoTheme.addEventListener('keydown', onDemoThemeKey);
  el.demoSize.addEventListener('keydown', onDemoSizeKey);
}

function bindAppEvents() {
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
    const text = event.clipboardData?.getData('text/plain') ?? '';
    event.preventDefault();
    if (text) {
      const start = el.input.selectionStart ?? el.input.value.length;
      const end = el.input.selectionEnd ?? start;
      el.input.setRangeText(text, start, end, 'end');
      autoGrow();
      updateComposer();
    }
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
  for (const [id, format] of [
    ['exportJson', 'json'],
    ['exportMarkdown', 'markdown'],
    ['exportEpub', 'epub'],
    ['exportPrint', 'print'],
  ]) {
    el[id]?.addEventListener('click', () => {
      closeAppChromeMenus();
      const printWindow = format === 'print' ? openPrintWindow() : null;
      void exportActiveConversation(format, printWindow);
    });
  }
  el.exportDialog?.addEventListener('click', onExportDialogClick);
  el.exportDialog?.addEventListener('cancel', (event) => {
    event.preventDefault();
    pendingKeptLogId = null;
    el.exportDialog.close();
  });
  el.exportDialogCancel?.addEventListener('click', () => {
    pendingKeptLogId = null;
    el.exportDialog.close();
  });
  el.language?.addEventListener('click', onLanguageClick);
  el.viewOpen?.addEventListener('click', onViewClick);
  el.viewChat?.addEventListener('click', () => {
    closeAppChromeMenus();
    setActiveView('chat');
  });
  el.viewShopping?.addEventListener('click', () => {
    closeAppChromeMenus();
    setActiveView('shopping');
  });
  el.viewFiles?.addEventListener('click', () => {
    closeAppChromeMenus();
    setActiveView('files');
  });
  el.viewOverview?.addEventListener('click', () => {
    closeAppChromeMenus();
    setActiveView('overview');
  });
  el.settings.addEventListener('click', onSettingsClick);
  el.usageRefresh?.addEventListener('click', onUsageRefreshClick);
  el.newChat.addEventListener('click', newChat);
  el.newChatDialog.addEventListener('click', onNewChatDialogClick);
  el.newChatDialog.addEventListener('cancel', onNewChatDialogCancel);
  el.newChatAgent.addEventListener('click', onAgentPickerClick);
  el.newChatModel.addEventListener('click', onModelPickerClick);
  el.newChatAgent.addEventListener('keydown', (event) => {
    onPickerKey(event, state.draftAgent, (option) => option.dataset.agent, (option) => {
      if (option.dataset.agent !== state.draftAgent) {
        state.draftAgent = option.dataset.agent;
        state.draftModel = defaultModelFor(state.draftAgent);
        syncAgentPicker();
        fillModelPicker();
      }
    });
  });
  el.newChatModel.addEventListener('keydown', (event) => {
    onPickerKey(event, state.draftModel, (option) => option.dataset.model, (option) => {
      state.draftModel = option.dataset.model;
      syncModelPicker();
    });
  });
  el.people.addEventListener('click', openPeople);
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
  el.locale.addEventListener('keydown', onLocaleKey);
  el.theme.addEventListener('click', onThemeClick);
  el.size.addEventListener('click', onSizeClick);
  el.theme.addEventListener('keydown', onThemeKey);
  el.size.addEventListener('keydown', onSizeKey);
}

async function mountLandingDemo() {
  if (demoMounted) {
    return;
  }
  if (!demoShellPromise) {
    demoShellPromise = (async () => {
      if (!document.getElementById('demo-settings')) {
        const fragment = await fetchFragment('/demo-shell.html');
        if (!document.getElementById('demo-settings')) {
          el.landingDemo.append(fragment);
        }
      }
      el.demoPlay?.remove();
      el.landingDemo.classList.remove('is-idle');
      captureDemoElements();
      if (!demoEventsBound) {
        fillThemePicker(el.demoTheme);
        fillSizePicker(el.demoSize);
        registerLocaleGroup(el.demoLocale, () => demoLocale);
        bindDemoEvents();
        demoEventsBound = true;
      }
      // applyDemoChrome and startDemoConversation both return until this is set.
      demoMounted = true;
      try {
        applyDemoChrome();
        startDemoConversation();
      } catch (error) {
        demoMounted = false;
        throw error;
      }
      el.landingDemo.focus();
    })().catch((error) => {
      demoShellPromise = null;
      throw error;
    });
  }
  try {
    await demoShellPromise;
  } catch (error) {
    setStatus(() => msg('retrying', { detail: retryDetail(error) }));
  }
}

function startDemoConversation() {
  if (!demoMounted) {
    return;
  }
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
    await exportConversationLog(appendDemoUserTurns(demoScript()), { agent: 'cursor', model: DEMO_MODEL });
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
  if (state.shopping) {
    el.messages.hidden = true;
    el.input.closest('.composer').hidden = true;
    el.shopping.hidden = false;
  } else {
    el.messages.hidden = false;
    el.input.closest('.composer').hidden = false;
  }
  applySessionIdentity(session);
  state.agent = session.agent ?? 'cursor';
  state.model = session.model ?? '';
  state.agents = Array.isArray(session.agents) ? session.agents : [];
  state.busy = Boolean(session.busy);
  state.items = session.items ?? [];
  state.people = session.people ?? [];
  state.alumni = session.alumni ?? [];
  state.invites = session.invites ?? [];
  renderPeopleLine();
  el.newChat.hidden = !state.canManage;
  el.people.hidden = !state.canManage;
  if (el.viewMenuHost) {
    el.viewMenuHost.hidden = false;
  }
  el.passkeys.hidden = false;
  rebindInviteNames(el.transcript, false);
  scheduleRender();
  updateComposer();
}

function showConversationList(conversations) {
  state.listing = true;
  state.items = [];
  state.busy = false;
  hideViews();
  if (el.viewMenuHost) {
    el.viewMenuHost.hidden = true;
  }
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
    pendingKeptLogId = conversation.id;
    if (el.exportDialogTitle) {
      el.exportDialogTitle.textContent = msg('exportEndedTitle');
    }
    el.exportDialog?.showModal();
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
  closeAppChromeMenus();
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
      await exportConversationLog(state.items, { agent: state.agent, model: state.model });
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
    const response = await api('/api/new', {
      method: 'POST',
      body: { agent: state.draftAgent, model: state.draftModel },
    });
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

const AGENT_LABELS = { cursor: 'agentCursor', grok: 'agentGrok', opencode: 'agentOpenCode' };

function agentCatalog() {
  return Array.isArray(state.agents) ? state.agents : [];
}

function agentEntry(id) {
  return agentCatalog().find((entry) => entry.id === id) ?? null;
}

function defaultModelFor(agentId) {
  const entry = agentEntry(agentId);
  const models = entry?.models ?? [];
  if (entry?.defaultModel && models.some((model) => model.id === entry.defaultModel)) {
    return entry.defaultModel;
  }
  return models[0]?.id ?? '';
}

function prepareNewChatPickers() {
  const catalog = agentCatalog();
  const fallback = catalog[0]?.id ?? 'cursor';
  state.draftAgent = agentEntry(state.agent)?.id ?? fallback;
  const models = agentEntry(state.draftAgent)?.models ?? [];
  state.draftModel = models.some((entry) => entry.id === state.model) ? state.model : defaultModelFor(state.draftAgent);
  el.newChatAgentField.hidden = catalog.length < 2;
  fillAgentPicker();
  fillModelPicker();
}

function fillAgentPicker() {
  el.newChatAgent.replaceChildren();
  for (const entry of agentCatalog()) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'theme-option';
    option.role = 'radio';
    option.dataset.agent = entry.id;
    option.textContent = msg(AGENT_LABELS[entry.id] ?? 'agentLabel');
    el.newChatAgent.append(option);
  }
  syncAgentPicker();
}

function syncAgentPicker() {
  for (const option of el.newChatAgent.querySelectorAll('.theme-option')) {
    option.textContent = msg(AGENT_LABELS[option.dataset.agent] ?? 'agentLabel');
    const on = option.dataset.agent === state.draftAgent;
    option.setAttribute('aria-checked', on ? 'true' : 'false');
    option.tabIndex = on ? 0 : -1;
  }
}

function fillModelPicker() {
  el.newChatModel.replaceChildren();
  for (const entry of agentEntry(state.draftAgent)?.models ?? []) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'theme-option';
    option.role = 'radio';
    option.dataset.model = entry.id;
    option.textContent = entry.label || entry.id;
    el.newChatModel.append(option);
  }
  syncModelPicker();
}

function syncModelPicker() {
  for (const option of el.newChatModel.querySelectorAll('.theme-option')) {
    const on = option.dataset.model === state.draftModel;
    option.setAttribute('aria-checked', on ? 'true' : 'false');
    option.tabIndex = on ? 0 : -1;
  }
}

function onAgentPickerClick(event) {
  const option = event.target.closest('.theme-option');
  if (!option || option.dataset.agent === state.draftAgent) {
    return;
  }
  state.draftAgent = option.dataset.agent;
  state.draftModel = defaultModelFor(state.draftAgent);
  syncAgentPicker();
  fillModelPicker();
}

function onModelPickerClick(event) {
  const option = event.target.closest('.theme-option');
  if (!option) {
    return;
  }
  state.draftModel = option.dataset.model;
  syncModelPicker();
}

function onPickerKey(event, selected, ids, apply) {
  if (!RADIO_NAV_KEYS.includes(event.key)) {
    return;
  }
  const options = [...event.currentTarget.querySelectorAll('.theme-option')];
  const index = options.findIndex((option) => ids(option) === selected);
  const next = nextRadioIndex(event.key, index < 0 ? 0 : index, options.length, localeDir(locale));
  event.preventDefault();
  options[next].focus();
  apply(options[next]);
}

function chooseNewChatAction() {
  prepareNewChatPickers();
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

function exportLabels() {
  return {
    user: msg('exportRoleUser'),
    assistant: msg('exportRoleAssistant'),
    tool: msg('exportRoleTool'),
    notice: msg('exportRoleNotice'),
    attachments: msg('exportAttachments'),
    images: msg('exportImages'),
    fileOmitted: msg('exportFileOmitted'),
  };
}

function exportMeta({ agent, model, exportedAt = new Date() }) {
  const stamp = exportedAt instanceof Date ? exportedAt.toISOString() : exportedAt;
  return { agent, model, exportedAt: stamp };
}

async function exportActiveConversation(format, printWindow) {
  if (state.items.length === 0 || state.exporting) {
    closePrintWindow(printWindow);
    return;
  }
  await runExport(format, state.items, { agent: state.agent, model: state.model }, printWindow);
}

function onExportDialogClick(event) {
  const button = event.target.closest('[data-export-format]');
  if (!button || !pendingKeptLogId) {
    return;
  }
  const logId = pendingKeptLogId;
  const format = button.dataset.exportFormat;
  pendingKeptLogId = null;
  el.exportDialog?.close();
  const printWindow = format === 'print' ? openPrintWindow() : null;
  void exportKeptConversation(logId, format, printWindow);
}

async function exportKeptConversation(logId, format, printWindow) {
  if (state.exporting) {
    closePrintWindow(printWindow);
    return;
  }
  state.exporting = true;
  try {
    if (format === 'json') {
      const response = await api(`/api/logs/${logId}`);
      if (!response.ok) {
        throw new RequestError(await readServerError(response), response.status);
      }
      const body = await response.json();
      await shareOrDownloadText(body.filename, body.text, 'application/json;charset=utf-8');
      return;
    }
    const response = await api(`/api/logs/${logId}?format=source`);
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    const body = await response.json();
    const labels = exportLabels();
    const meta = exportMeta({ agent: body.agent, model: body.model, exportedAt: body.exportedAt });
    if (format === 'print') {
      await exportPrintView(body.items, meta, labels, printWindow);
      return;
    }
    const when = body.exportedAt ? new Date(body.exportedAt) : new Date();
    if (format === 'markdown') {
      const text = formatConversationLogMarkdown(body.items, meta, labels);
      await shareOrDownloadText(conversationMarkdownFilename(when), text, 'text/markdown;charset=utf-8');
      return;
    }
    if (format === 'epub') {
      const bytes = await buildConversationEpubAsync(body.items, meta, labels);
      await shareOrDownloadBytes(conversationEpubFilename(when), bytes, 'application/epub+zip');
    }
  } catch (error) {
    closePrintWindow(printWindow);
    if (error?.name !== 'AbortError') {
      setStatus(() => error.message || msg('exportFailed'));
    }
  } finally {
    state.exporting = false;
    setExportButtonsDisabled(state.items.length === 0);
  }
}

async function runExport(format, items, { agent, model, exportedAt }, printWindow) {
  state.exporting = true;
  setExportButtonsDisabled(true);
  try {
    const when = exportedAt ? new Date(exportedAt) : new Date();
    const meta = exportMeta({ agent, model, exportedAt: when });
    const labels = exportLabels();
    if (format === 'json') {
      const text = formatConversationLog(items, meta);
      await shareOrDownloadText(conversationLogFilename(when), text, 'application/json;charset=utf-8');
      return;
    }
    if (format === 'markdown') {
      const text = formatConversationLogMarkdown(items, meta, labels);
      await shareOrDownloadText(conversationMarkdownFilename(when), text, 'text/markdown;charset=utf-8');
      return;
    }
    if (format === 'epub') {
      const bytes = await buildConversationEpubAsync(items, meta, labels);
      await shareOrDownloadBytes(conversationEpubFilename(when), bytes, 'application/epub+zip');
      return;
    }
    if (format === 'print') {
      await exportPrintView(items, meta, labels, printWindow);
      return;
    }
  } catch (error) {
    closePrintWindow(printWindow);
    if (error?.name !== 'AbortError') {
      setStatus(() => error.message || msg('exportFailed'));
    }
  } finally {
    state.exporting = false;
    setExportButtonsDisabled(state.items.length === 0);
  }
}

async function exportConversationLog(items, { agent, model }) {
  await runExport('json', items, { agent, model });
}

async function buildConversationEpubAsync(items, meta, labels) {
  const cache = new Map();
  for (const id of mediaIdsInItems(items)) {
    const response = await api(`/api/media/${id}`);
    if (!response.ok) {
      continue;
    }
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const name = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'image';
    cache.set(id, { bytes, mime: blob.type, name });
  }
  return buildConversationEpub(items, meta, (mediaId) => cache.get(mediaId) ?? null, {
    renderMarkdown,
    labels,
  });
}

async function buildImageHrefs(items) {
  const map = new Map();
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    for (const list of [item.attachments, item.images]) {
      if (!Array.isArray(list)) {
        continue;
      }
      for (const file of list) {
        if (!file?.id || !file?.name) {
          continue;
        }
        const key = `${file.id}:${file.name}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        try {
          const response = await api(`/api/media/${file.id}`);
          if (!response.ok) {
            continue;
          }
          const blob = await response.blob();
          if (!blob.type.startsWith('image/')) {
            continue;
          }
          map.set(key, await blobToDataUrl(blob));
        } catch (error) {
          if (error instanceof SessionEndedError || error instanceof AuthError) {
            throw error;
          }
        }
      }
    }
  }
  return map;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function openPrintWindow() {
  const view = window.open('', '_blank');
  if (!view) {
    return null;
  }
  try {
    view.opener = null;
  } catch {
    // The blank document is same-origin. Ignore a browser that refuses.
  }
  return view;
}

function closePrintWindow(view) {
  if (view && !view.closed) {
    view.close();
  }
}

async function exportPrintView(items, meta, labels, printWindow) {
  const imageHrefs = await buildImageHrefs(items);
  const html = buildPrintHtmlDocument(items, meta, {
    renderMarkdown,
    imageHrefs,
    labels,
    printHint: msg('exportPrintHint'),
  });
  const when = meta.exportedAt ? new Date(meta.exportedAt) : new Date();
  if (!printWindow || printWindow.closed) {
    await shareOrDownloadText(conversationPrintFilename(when), html, 'text/html;charset=utf-8');
    setStatus(() => msg('exportPrintBlocked'), { alert: true });
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  try {
    printWindow.opener = null;
  } catch {
    // The written document is still ours.
  }
  let printed = false;
  const trigger = () => {
    if (printed || printWindow.closed) {
      return;
    }
    printed = true;
    printWindow.focus();
    printWindow.print();
  };
  printWindow.addEventListener('load', trigger, { once: true });
  if (printWindow.document.readyState === 'complete') {
    trigger();
  }
}

async function shareOrDownloadText(filename, text, mime) {
  const file = new File([text], filename, { type: mime });
  if (typeof navigator.share === 'function') {
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
  downloadTextFile(filename, text, mime);
}

async function shareOrDownloadBytes(filename, bytes, mime) {
  const file = new File([bytes], filename, { type: mime });
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
    }
  }
  downloadBytesFile(filename, bytes, mime);
}

function downloadTextFile(filename, text, mime = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadBytesFile(filename, bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setExportButtonsDisabled(disabled) {
  for (const node of [el.exportJson, el.exportMarkdown, el.exportEpub, el.exportPrint]) {
    if (node) {
      node.disabled = disabled;
    }
  }
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
  if (error instanceof RequestError || typeof error.status === 'number') {
    return responseStatusText(error.raw || '', error.status)();
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
  setExportButtonsDisabled(state.items.length === 0 || state.exporting);
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
      const frame = document.createElement('figure');
      frame.className = 'shot-frame';
      const img = document.createElement('img');
      img.className = 'shot';
      img.alt = file.name || msg('image');
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'download';
      link.textContent = msg('download');
      frame.append(img, link);
      container.append(frame);
      showMedia(img, file.id);
      bindDownload(link, file.id, file.name || 'image');
      continue;
    }
    if (file?.id && file?.name) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'file-chip';
      link.textContent = `${file.name} · ${msg('download')}`;
      container.append(link);
      bindDownload(link, file.id, file.name);
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

function bindDownload(button, id, name) {
  button.addEventListener('click', () => {
    ensureMediaUrl(id)
      .then((url) => {
        if (!url) {
          return;
        }
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.rel = 'noopener';
        document.body.append(link);
        link.click();
        link.remove();
      })
      .catch((error) => {
        if (error instanceof SessionEndedError) {
          return;
        }
        if (error instanceof AuthError) {
          handleFailure(error);
        }
      });
  });
}

function ensureMediaUrl(id) {
  const cached = mediaUrls.get(id);
  if (cached) {
    return Promise.resolve(cached);
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
  return load;
}

function showMedia(img, id) {
  ensureMediaUrl(id)
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

function setStatus(message, { alert = false } = {}) {
  setLandingStatus(typeof message === 'function' ? message : () => message, { alert });
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
  // Landing can set this after the app module loads; paint from that same function.
  renderStatus = currentLandingStatus();
  const message = renderStatus();
  const alert = currentLandingStatusAlert();
  paintStatusMessage(el.status, message, alert);
  paintStatusMessage(el.landingStatus, message, alert);
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

function closeDialog(dialog) {
  if (dialog?.open) {
    dialog.close();
  }
}

function showLanding() {
  closeAppChromeMenus();
  closeLandingAndDemoMenus();
  el.landing.hidden = false;
  if (el.app) {
    el.app.inert = true;
  }
  closeDialog(el.login);
}

async function logOut({ revokeServer = true } = {}) {
  closeAppChromeMenus();
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
  hideViews();
  if (el.viewMenuHost) {
    el.viewMenuHost.hidden = true;
  }
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
  const revokeError = revokeServer ? await revokeServerSession(token) : null;
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
  applyLandingGate();
  if (revokeError) {
    setStatus(() => failureMessage(revokeError));
  } else {
    setStatus('');
  }
}

async function hideGate() {
  await ensureAppShell();
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
    if (sessionToken) {
      await hideGate();
      return;
    }
    // Prefetch only. Sign-in awaits the same load and reports a failure there.
    void ensureAppShell().catch(() => {});
    showLogin('', gateLoginMode());
  } catch (error) {
    setStatus(() => msg('retrying', { detail: retryDetail(error) }));
  } finally {
    if (!el.landing.hidden) {
      applyLandingGate();
    }
  }
}

function showLogin(message = '', mode = lastLoginMode) {
  lastLoginMode = mode;
  if (mode !== 'register') {
    pendingRegistration = null;
  }
  closeAppChromeMenus();
  closeLandingAndDemoMenus();
  if (el.passkeys) {
    el.passkeys.hidden = true;
  }
  el.landing.hidden = false;
  if (el.app) {
    el.app.inert = true;
  }
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
  hideGate().catch(handleFailure);
}

function onLoginDialogClose() {
  if (!sessionToken || el.landing.hidden) {
    return;
  }
  clearJoinParam();
  hideGate().catch(handleFailure);
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
    await hideGate();
    if (session) {
      applySessionIdentity(session);
      requestGrokUsage();
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
      await ensureAppShell();
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
      await hideGate();
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
  closeAppChromeMenus();
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
  const epoch = chatEpoch;
  el.passkeysStatus.textContent = '';
  const response = await api(`/api/passkeys/${passkeyId}`, { method: 'DELETE' });
  if (epoch !== chatEpoch) {
    return;
  }
  if (!response.ok) {
    throw new RequestError(await readServerError(response), response.status);
  }
  const body = await response.json();
  if (epoch !== chatEpoch) {
    return;
  }
  if (body.signedOut) {
    await logOut({ revokeServer: false });
    return;
  }
  renderPasskeys(body.passkeys ?? []);
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

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileEntryUrl(entry) {
  if (entry.kind === 'media') {
    return `/api/media/${entry.id}`;
  }
  if (entry.kind === 'stash') {
    return `/api/files/stash?path=${encodeURIComponent(entry.path)}`;
  }
  return `/api/files/workdir?path=${encodeURIComponent(entry.path)}`;
}

function renderFilesList(container, emptyNode, entries) {
  container.replaceChildren();
  if (!entries.length) {
    emptyNode.hidden = false;
    return;
  }
  emptyNode.hidden = true;
  for (const entry of entries) {
    const row = document.createElement('li');
    row.className = 'files-row';
    const meta = document.createElement('div');
    meta.className = 'files-meta';
    const title = document.createElement('strong');
    title.textContent = entry.path && entry.kind === 'workdir' ? entry.path : entry.name;
    const detail = document.createElement('span');
    detail.textContent = [entry.mime, formatFileSize(entry.size)].filter(Boolean).join(' · ');
    meta.append(title, detail);
    const actions = document.createElement('div');
    actions.className = 'files-actions';
    const view = document.createElement('button');
    view.type = 'button';
    view.textContent = msg('filesView');
    view.hidden = !entry.inline;
    view.addEventListener('click', () => {
      const popup = openPrintWindow();
      if (!popup) {
        setFilesStatus(msg('filesOpenFailed'));
        return;
      }
      void transferFileEntry(entry, popup);
    });
    const download = document.createElement('button');
    download.type = 'button';
    download.textContent = msg('download');
    download.addEventListener('click', () => {
      void transferFileEntry(entry);
    });
    actions.append(view, download);
    row.append(meta, actions);
    container.append(row);
  }
}

function setFilesStatus(message) {
  if (!el.filesStatus) {
    return;
  }
  const text = message || '';
  el.filesStatus.textContent = text;
  el.filesStatus.hidden = !text;
}

async function transferFileEntry(entry, viewWindow) {
  setFilesStatus('');
  try {
    const response = await api(fileEntryUrl(entry));
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    if (viewWindow) {
      if (viewWindow.closed) {
        URL.revokeObjectURL(url);
        setFilesStatus(msg('filesOpenFailed'));
        return;
      }
      viewWindow.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = entry.name || 'download';
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    closePrintWindow(viewWindow);
    if (error instanceof SessionEndedError) {
      return;
    }
    if (error instanceof AuthError) {
      handleFailure(error);
      return;
    }
    setFilesStatus(error.message || msg('filesOpenFailed'));
  }
}

function paintShoppingChrome() {
  if (!el.shopping) {
    return;
  }
  el.shoppingWantedHeading.textContent = msg('shoppingWanted');
  el.shoppingBoughtHeading.textContent = msg('shoppingBought');
  el.shoppingEmpty.textContent = msg('shoppingEmpty');
  renderShoppingItems();
}

function setShoppingStatus(text) {
  if (!el.shoppingStatus) {
    return;
  }
  el.shoppingStatus.hidden = !text;
  el.shoppingStatus.textContent = text;
}

function stopShoppingPoll() {
  if (shoppingPoll) {
    clearInterval(shoppingPoll);
    shoppingPoll = null;
  }
}

function syncViewButtons(active) {
  const map = [
    ['chat', el.viewChat],
    ['shopping', el.viewShopping],
    ['files', el.viewFiles],
    ['overview', el.viewOverview],
  ];
  for (const [key, button] of map) {
    if (button) {
      button.setAttribute('aria-pressed', key === active ? 'true' : 'false');
    }
  }
}

function hideViews() {
  state.view = 'chat';
  stopShoppingPoll();
  if (el.shopping) {
    el.shopping.hidden = true;
  }
  if (el.filesView) {
    el.filesView.hidden = true;
  }
  if (el.overviewView) {
    el.overviewView.hidden = true;
  }
  syncViewButtons('chat');
  if (!state.listing && el.messages) {
    el.messages.hidden = false;
    const composer = el.input?.closest('.composer');
    if (composer) {
      composer.hidden = false;
    }
  }
}

function setActiveView(view) {
  if (state.listing) {
    return;
  }
  state.view = view;
  syncViewButtons(view);
  stopShoppingPoll();
  if (el.messages) {
    el.messages.hidden = view !== 'chat';
  }
  const composer = el.input?.closest('.composer');
  if (composer) {
    composer.hidden = view !== 'chat';
  }
  if (el.shopping) {
    el.shopping.hidden = view !== 'shopping';
  }
  if (el.filesView) {
    el.filesView.hidden = view !== 'files';
  }
  if (el.overviewView) {
    el.overviewView.hidden = view !== 'overview';
  }
  if (view === 'shopping') {
    void openShopping();
  } else if (view === 'files') {
    void openFiles();
  } else if (view === 'overview') {
    void openOverview();
  }
}

async function openShopping() {
  if (state.listing || !el.shopping) {
    return;
  }
  setShoppingStatus('');
  paintShoppingChrome();
  await loadShoppingList();
  stopShoppingPoll();
  shoppingPoll = setInterval(() => {
    if (document.visibilityState === 'hidden' || shoppingBusy || state.view !== 'shopping') {
      return;
    }
    void loadShoppingList({ quiet: true });
  }, 2000);
}

async function loadShoppingList({ quiet = false } = {}) {
  try {
    const response = await api('/api/shopping');
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    const body = await response.json();
    shoppingItems = Array.isArray(body.items) ? body.items : [];
    renderShoppingItems();
    if (!quiet) {
      setShoppingStatus('');
    }
  } catch (error) {
    if (error instanceof SessionEndedError) {
      return;
    }
    if (error instanceof AuthError) {
      handleFailure(error);
      return;
    }
    if (!quiet) {
      setShoppingStatus(error.message || msg('shoppingLoadFailed'));
    }
  }
}

function renderShoppingItems() {
  if (!el.shoppingWantedList) {
    return;
  }
  const wanted = shoppingItems.filter((item) => !item.bought);
  const bought = shoppingItems.filter((item) => item.bought);
  fillShoppingList(el.shoppingWantedList, wanted);
  fillShoppingList(el.shoppingBoughtList, bought);
  el.shoppingEmpty.hidden = wanted.length > 0;
  el.shoppingBoughtSection.hidden = bought.length === 0;
}

function fillShoppingList(node, items) {
  node.replaceChildren();
  for (const item of items) {
    node.append(shoppingRow(item));
  }
}

function shoppingRow(item) {
  const row = document.createElement('li');
  row.className = item.bought ? 'shopping-row is-bought' : 'shopping-row';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'shopping-check';
  check.checked = Boolean(item.bought);
  check.setAttribute('aria-label', item.name);
  check.addEventListener('change', () => {
    void saveShoppingItems(
      shoppingItems.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              bought: check.checked,
              boughtBy: check.checked ? state.you?.name || entry.boughtBy || '' : '',
            }
          : entry,
      ),
    );
  });
  const meta = document.createElement('div');
  meta.className = 'shopping-meta';
  const name = document.createElement('span');
  name.className = 'shopping-name';
  name.textContent = item.name;
  meta.append(name);
  const who = item.bought ? item.boughtBy : item.wantedBy;
  if (who) {
    const line = document.createElement('span');
    line.className = 'shopping-who';
    line.textContent = item.bought ? msg('shoppingBoughtBy', { name: who }) : msg('shoppingWantedBy', { name: who });
    meta.append(line);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'shopping-remove';
  remove.textContent = msg('shoppingRemove');
  remove.addEventListener('click', () => {
    void saveShoppingItems(shoppingItems.filter((entry) => entry.id !== item.id));
  });
  row.append(check, meta, remove);
  return row;
}

async function saveShoppingItems(items) {
  shoppingBusy = true;
  setShoppingStatus('');
  try {
    const response = await api('/api/shopping', { method: 'PUT', body: { items } });
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    const body = await response.json();
    shoppingItems = Array.isArray(body.items) ? body.items : items;
    renderShoppingItems();
  } catch (error) {
    if (error instanceof SessionEndedError) {
      return;
    }
    if (error instanceof AuthError) {
      handleFailure(error);
      return;
    }
    setShoppingStatus(error.message || msg('shoppingSaveFailed'));
    renderShoppingItems();
  } finally {
    shoppingBusy = false;
  }
}

async function openFiles() {
  setFilesStatus('');
  try {
    const response = await api('/api/files');
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    const body = await response.json();
    renderFilesList(el.filesConversationList, el.filesConversationEmpty, body.conversation ?? []);
    const workdir = body.workdir ?? [];
    if (state.you?.owner) {
      el.filesWorkdirSection.hidden = false;
      renderFilesList(el.filesWorkdirList, el.filesWorkdirEmpty, workdir);
    } else {
      el.filesWorkdirSection.hidden = true;
    }
  } catch (error) {
    if (error instanceof SessionEndedError) {
      return;
    }
    if (error instanceof AuthError) {
      handleFailure(error);
      return;
    }
    setFilesStatus(error.message || msg('filesOpenFailed'));
  }
}

function setOverviewStatus(message) {
  if (!el.overviewStatus) {
    return;
  }
  const text = message || '';
  el.overviewStatus.textContent = text;
  el.overviewStatus.hidden = !text;
}

function renderOverviewStory(story) {
  if (!el.overviewStory) {
    return;
  }
  el.overviewStory.replaceChildren();
  const paragraphs = String(story ?? '')
    .trim()
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  el.overviewStory.hidden = paragraphs.length === 0;
  for (const text of paragraphs) {
    const p = document.createElement('p');
    p.textContent = text;
    el.overviewStory.append(p);
  }
}

async function openOverview() {
  setOverviewStatus('');
  try {
    const response = await api('/api/overview');
    if (!response.ok) {
      throw new RequestError(await readServerError(response), response.status);
    }
    const body = await response.json();
    el.overviewEmpty.hidden = !body.empty;
    renderOverviewStory(body.empty ? '' : body.story);
  } catch (error) {
    if (error instanceof SessionEndedError) {
      return;
    }
    if (error instanceof AuthError) {
      handleFailure(error);
      return;
    }
    setOverviewStatus(error.message || msg('overviewOpenFailed'));
  }
}

function openPeople() {
  closeAppChromeMenus();
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
  if (error instanceof RequestError || typeof error.status === 'number') {
    return responseStatusText(error.raw || '', error.status)();
  }
  return translateError(locale, error.message) || msg('somethingWentWrong');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

document.addEventListener('pointerdown', onDocumentPointerDown);
document.addEventListener('focusin', onDocumentFocusIn);
document.addEventListener('keydown', onDocumentKeyDown);
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
el.invite.addEventListener('click', () => {
  if (peopleDialogDemo) {
    el.peopleDialog.close();
    openDemoSheet(el.demoInviteDialog);
    return;
  }
  createInvite().catch(handlePeopleDialogFailure);
});
el.peopleClose.addEventListener('click', () => el.peopleDialog.close());
el.peopleDialog.addEventListener('close', () => {
  peopleDialogDemo = false;
  paintDialogTheme(el.peopleDialog, null);
  setPeopleStatus('');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !sessionToken || state.streaming || state.following) {
    return;
  }
  ensureAppShell()
    .then(() => {
      if (!state.listing) {
        requestGrokUsage();
      }
      return loadSession();
    })
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

setPaintChrome(applyChrome);
setAfterLandingSettingsToggle(() => {
  setDemoLanguageOpen(false);
  setDemoSettingsOpen(false);
  closeAppChromeMenus();
});
setOnChromeError(handleFailure);
applyChrome();

export { applyChrome, beginSignIn, bootstrap, mountLandingDemo, showLogin };
