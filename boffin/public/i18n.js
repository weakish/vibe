export const LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ms', label: 'Melayu' },
  { id: 'kxd', label: 'Kedayan' },
  { id: 'ms-BN-Arab', label: 'ملايو بروني' },
  { id: 'id', label: 'Indonesia' },
  { id: 'ta', label: 'தமிழ்' },
  { id: 'yue', label: '粵語' },
  { id: 'zh-Hans', label: '中文' },
  { id: 'nan-Latn', label: 'Pe̍h-ōe-jī' },
];

const ALIASES = new Map([
  ['en', 'en'],
  ['ja', 'ja'],
  ['ms', 'ms'],
  ['kxd', 'kxd'],
  ['kedayan', 'kxd'],
  ['kadayan', 'kxd'],
  ['ms-bn-arab', 'ms-BN-Arab'],
  ['ms-arab', 'ms-BN-Arab'],
  ['ms-my-arab', 'ms-BN-Arab'],
  ['ms-bn-jawi', 'ms-BN-Arab'],
  ['id', 'id'],
  ['in', 'id'],
  ['ta', 'ta'],
  ['yue', 'yue'],
  ['zh-hk', 'yue'],
  ['zh-hant-hk', 'yue'],
  ['zh-cn', 'zh-Hans'],
  ['zh-hans', 'zh-Hans'],
  ['zh-hans-cn', 'zh-Hans'],
  ['zh-sg', 'zh-Hans'],
  ['nan', 'nan-Latn'],
  ['nan-latn', 'nan-Latn'],
  ['nan-tw', 'nan-Latn'],
  ['zh-min-nan', 'nan-Latn'],
]);

export const MESSAGES = Object.create(null);

const LOCALE_LOADERS = {
  en: () => import('./locales/en.js'),
  ja: () => import('./locales/ja.js'),
  ms: () => import('./locales/ms.js'),
  kxd: () => import('./locales/kxd.js'),
  'ms-BN-Arab': () => import('./locales/ms-BN-Arab.js'),
  id: () => import('./locales/id.js'),
  ta: () => import('./locales/ta.js'),
  yue: () => import('./locales/yue.js'),
  'zh-Hans': () => import('./locales/zh-Hans.js'),
  'nan-Latn': () => import('./locales/nan-Latn.js'),
};
const LOCALE_IDS = new Set(Object.keys(LOCALE_LOADERS));
const pendingLocales = new Map();

function loadOne(id) {
  if (Object.hasOwn(MESSAGES, id)) {
    return Promise.resolve(MESSAGES[id]);
  }
  let pending = pendingLocales.get(id);
  if (!pending) {
    pending = LOCALE_LOADERS[id]()
      .then((module) => {
        MESSAGES[id] = module.default;
        pendingLocales.delete(id);
        return module.default;
      })
      .catch((error) => {
        pendingLocales.delete(id);
        throw error;
      });
    pendingLocales.set(id, pending);
  }
  return pending;
}

export function loadLocale(id) {
  const resolved = LOCALE_IDS.has(id) ? id : 'en';
  if (resolved === 'en') {
    return loadOne('en');
  }
  // English covers missing keys. Its failure must not drop the requested catalog.
  return Promise.allSettled([loadOne(resolved), loadOne('en')]).then(([main]) => {
    if (main.status === 'rejected') {
      throw main.reason;
    }
    return main.value;
  });
}

export function loadAllLocales() {
  return Promise.all(Object.keys(LOCALE_LOADERS).map((id) => loadOne(id)));
}

export function ensureLocale(id) {
  return loadLocale(id);
}

const SERVER_ERRORS = new Map([
  ['Invalid or missing username or password.', 'invalidAuth'],
  ['Not found.', 'notFound'],
  ['Send a message or attach a file.', 'messageRequired'],
  ['Attachments must be a list.', 'attachmentsMustBeList'],
  ['An attachment is not valid.', 'attachmentInvalid'],
  ['Request body is too large.', 'bodyTooLarge'],
  ['Request body must be valid JSON.', 'bodyMustBeJson'],
  ['Could not start a new chat because the conversation could not be saved.', 'newChatSaveFailed'],
  ['Internal server error.', 'internalError'],
  ['The spec must be text.', 'specMustBeText'],
  ['The agent is still working on the previous message.', 'agentBusyExact'],
  ['The password is no longer used.', 'passwordRetired'],
  ['The passkey was not accepted.', 'passkeyFailed'],
  ['A passkey needs HTTPS on a stable hostname.', 'passkeyUnavailable'],
  ['Enter a name.', 'nameRequired'],
  ['That name is already used.', 'nameTaken'],
  ['A name may be up to 40 characters.', 'nameTooLong'],
  ['This invitation has already been used.', 'inviteUsed'],
  ['You are not in this conversation.', 'notInConversation'],
  ['Only the owner can do that.', 'ownerOnly'],
  ['Create a passkey to finish signing in.', 'passkeyRequired'],
  ['That person is already in the conversation.', 'alreadyMember'],
  ['That person is not known.', 'unknownPerson'],
  ['That person is not in the conversation.', 'personNotInConversation'],
  ['Enter a username.', 'needUsername'],
  ['Keep at least one passkey.', 'lastPasskey'],
  ['That label is not valid.', 'passkeyLabelInvalid'],
  ['A label may be up to 40 characters.', 'passkeyLabelTooLong'],
  ['That passkey is already saved.', 'passkeyAlreadySaved'],
  ['Too many attempts. Try again later.', 'tooManyAttempts'],
  ['Bundling failed.', 'bundleFailed'],
  ['Bun was not found on the server.', 'bunNotFound'],
  ['Bundling is already in progress.', 'bundleInProgress'],
  ['That agent is not available.', 'unknownAgent'],
  ['That model is not available.', 'unknownModel'],
]);

export function resolveLocale(requested = []) {
  for (const raw of requested) {
    if (typeof raw !== 'string' || !raw.trim()) {
      continue;
    }
    const tag = raw.trim().replace(/_/g, '-');
    if (LOCALE_IDS.has(tag)) {
      return tag;
    }
    const lower = tag.toLowerCase();
    if (ALIASES.has(lower)) {
      return ALIASES.get(lower);
    }
    // A bare zh may be Traditional, so zh-Hans needs an explicit alias above or a Hans script.
    if (lower.startsWith('zh-hans-')) {
      return 'zh-Hans';
    }
    const prefix = lower.split('-')[0];
    if (ALIASES.has(prefix)) {
      return ALIASES.get(prefix);
    }
  }
  return 'en';
}

export function localeDir(locale) {
  return locale === 'ms-BN-Arab' ? 'rtl' : 'ltr';
}

export function nextRadioIndex(key, index, count, dir) {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return count - 1;
  }
  const forward = key === 'ArrowDown' || key === (dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
  if (forward) {
    return (index + 1) % count;
  }
  return (index - 1 + count) % count;
}

export function t(locale, key, vars = {}) {
  const table = MESSAGES[locale] ?? MESSAGES.en;
  const template = table?.[key] ?? MESSAGES.en?.[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    if (vars[name] == null) {
      throw new Error(`Missing translation value {${name}} for ${key}.`);
    }
    return String(vars[name]);
  });
}

// «like this» marks a literal that stays in a code span. Translations use it
// for config keys, which are not words to translate.
export function splitMarked(template) {
  const parts = [];
  const pattern = /«([^»]*)»/g;
  let last = 0;
  for (const match of template.matchAll(pattern)) {
    if (match.index > last) {
      parts.push({ text: template.slice(last, match.index) });
    }
    if (!match[1]) {
      throw new Error('Empty «» span in a translation.');
    }
    parts.push({ code: match[1] });
    last = match.index + match[0].length;
  }
  if (last < template.length) {
    parts.push({ text: template.slice(last) });
  }
  return parts;
}

export function translateError(locale, message) {
  if (typeof message !== 'string' || !message) {
    return t(locale, 'somethingWentWrong');
  }
  const key = SERVER_ERRORS.get(message);
  if (key) {
    return t(locale, key);
  }
  const limited = /^Messages are limited to (\d+) characters\.$/.exec(message);
  if (limited) {
    return t(locale, 'messageTooLong', { limit: limited[1] });
  }
  const specLimited = /^The spec is limited to (\d+) characters\.$/.exec(message);
  if (specLimited) {
    return t(locale, 'specTooLong', { limit: specLimited[1] });
  }
  const attachmentCount = /^You can attach up to (\d+) files\.$/.exec(message);
  if (attachmentCount) {
    return t(locale, 'tooManyFiles', { limit: attachmentCount[1] });
  }
  const attachmentBytes = /^Each attachment is limited to (\d+) bytes\.$/.exec(message);
  if (attachmentBytes) {
    return t(locale, 'attachmentByteLimit', { limit: attachmentBytes[1] });
  }
  return message;
}
