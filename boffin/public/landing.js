import {
  applyLandingChrome,
  applyLandingGate,
  authGate,
  bindLandingChromeEvents,
  fillSizePicker,
  fillThemePicker,
  joinId,
  landingEl,
  locale,
  peekSession,
  refreshAuthGate,
  setLandingStatus,
  setOnChromeError,
} from './chrome.js';
import { t, translateError } from './i18n.js';

const RETRY_INTERVAL_MS = 4000;

let appPromise = null;

function loadApp() {
  if (!appPromise) {
    appPromise = import('./app.js').catch((error) => {
      appPromise = null;
      throw error;
    });
  }
  return appPromise;
}

function failureDetail(error) {
  if (error instanceof TypeError) {
    return t(locale, 'cannotReach');
  }
  if (typeof error.status === 'number') {
    if (error.raw) {
      return translateError(locale, error.raw);
    }
    return t(locale, 'requestFailed', { status: error.status });
  }
  return translateError(locale, error.message) || t(locale, 'somethingWentWrong');
}

function reportGateFailure(error) {
  setLandingStatus(() => t(locale, 'retrying', { detail: failureDetail(error) }));
}

async function bootstrapGate() {
  try {
    await refreshAuthGate();
  } catch (error) {
    reportGateFailure(error);
    setTimeout(bootstrapGate, RETRY_INTERVAL_MS);
    return;
  }
  applyLandingGate();
  if (joinId && !authGate.invite) {
    setLandingStatus(() => t(locale, 'inviteUsed'));
  } else {
    setLandingStatus('');
  }
}

function onStart() {
  landingEl.signIn.disabled = true;
  loadApp()
    .then((app) => app.beginSignIn())
    .catch((error) => {
      reportGateFailure(error);
    })
    .finally(() => {
      if (!landingEl.root.hidden) {
        landingEl.signIn.disabled = false;
      }
    });
}

function onInvite() {
  loadApp()
    .then((app) => app.showLogin('', 'join'))
    .catch((error) => {
      reportGateFailure(error);
    });
}

function onPlay() {
  loadApp()
    .then((app) => app.mountLandingDemo())
    .catch((error) => {
      reportGateFailure(error);
    });
}

function bootStoredSession() {
  loadApp()
    .then((app) => app.bootstrap())
    .catch((error) => {
      reportGateFailure(error);
      setTimeout(bootStoredSession, RETRY_INTERVAL_MS);
    });
}

setOnChromeError(reportGateFailure);
bindLandingChromeEvents();
fillThemePicker(landingEl.theme);
fillSizePicker(landingEl.size);
applyLandingChrome();
landingEl.signIn.addEventListener('click', onStart);
landingEl.invite.addEventListener('click', onInvite);
landingEl.play.addEventListener('click', onPlay);

if (peekSession()) {
  bootStoredSession();
} else {
  bootstrapGate();
}
