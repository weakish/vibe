import { localeDir, resolveLocale, t, translateError } from './i18n.js';
import { renderMarkdown } from './markdown.js';

const SESSION_KEY = 'boffin.session';
const LOCALE_KEY = 'boffin.locale';

const el = {
  title: document.getElementById('spec-title'),
  back: document.getElementById('spec-back'),
  edit: document.getElementById('spec-edit'),
  save: document.getElementById('spec-save'),
  cancel: document.getElementById('spec-cancel'),
  status: document.getElementById('spec-status'),
  view: document.getElementById('spec-view'),
  rendered: document.getElementById('spec-rendered'),
  editor: document.getElementById('spec-editor'),
};

const sessionToken = readSession();
const locale = readLocale();
let savedText = '';
let editing = false;

function msg(key, vars) {
  return t(locale, key, vars);
}

function readSession() {
  try {
    return localStorage.getItem(SESSION_KEY) || null;
  } catch {
    return null;
  }
}

function authorization() {
  return { Authorization: `Bearer ${sessionToken}` };
}

function readLocale() {
  let stored = '';
  try {
    stored = localStorage.getItem(LOCALE_KEY) ?? '';
  } catch {
    stored = '';
  }
  return resolveLocale([stored, ...(navigator.languages ?? []), navigator.language]);
}

function forgetSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be unavailable.
  }
}

function setStatus(text) {
  el.status.hidden = !text;
  el.status.textContent = text;
}

function showSaved(text) {
  savedText = text;
  el.rendered.innerHTML = renderMarkdown(text);
  setEditing(false);
}

function setEditing(next) {
  editing = next;
  el.view.hidden = next;
  el.editor.hidden = !next;
  el.edit.hidden = next;
  el.save.hidden = !next;
  el.cancel.hidden = !next;
  if (next) {
    el.editor.value = savedText;
    el.editor.focus();
  }
}

async function loadSpec() {
  try {
    const response = await fetch('/api/spec', {
      headers: sessionToken ? authorization() : {},
      cache: 'no-store',
    });
    if (response.status === 401) {
      forgetSession();
      location.replace('/');
      return;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setStatus(translateError(locale, body.error) || msg('specSaveFailed'));
      return;
    }
    const body = await response.json();
    showSaved(typeof body.text === 'string' ? body.text : '');
    if (body.canEdit === false) {
      el.edit.hidden = true;
    }
  } catch {
    setStatus(msg('cannotReach'));
  }
}

async function saveSpec() {
  el.save.disabled = true;
  setStatus('');
  try {
    const response = await fetch('/api/spec', {
      method: 'PUT',
      headers: {
        ...authorization(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: el.editor.value }),
    });
    if (response.status === 401) {
      forgetSession();
      location.replace('/');
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(translateError(locale, body.error) || msg('specSaveFailed'));
      return;
    }
    showSaved(typeof body.text === 'string' ? body.text : el.editor.value);
    setStatus(msg('specSaved'));
  } catch {
    setStatus(msg('specSaveFailed'));
  } finally {
    el.save.disabled = false;
  }
}

document.documentElement.lang = locale;
document.documentElement.dir = localeDir(locale);
el.rendered.dir = 'auto';
el.editor.dir = 'auto';
el.title.textContent = msg('spec');
document.title = `${msg('spec')} · Boffin`;
el.back.textContent = msg('specBack');
el.edit.textContent = msg('specEdit');
el.save.textContent = msg('specSave');
el.cancel.textContent = msg('cancel');

el.edit.addEventListener('click', () => {
  setStatus('');
  setEditing(true);
});
el.cancel.addEventListener('click', () => {
  setStatus('');
  setEditing(false);
});
el.save.addEventListener('click', () => {
  saveSpec();
});

if (!sessionToken) {
  el.edit.hidden = true;
}
loadSpec();
