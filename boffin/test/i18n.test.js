import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LOCALES, MESSAGES, loadAllLocales, localeDir, nextRadioIndex, resolveLocale, splitMarked, t, translateError } from '../public/i18n.js';

before(async () => {
  await loadAllLocales();
});

test('every locale has the same keys as English', () => {
  const expected = Object.keys(MESSAGES.en).sort();
  assert.deepEqual(
    LOCALES.map((item) => item.id).sort(),
    Object.keys(MESSAGES).sort(),
  );
  for (const locale of Object.keys(MESSAGES)) {
    assert.deepEqual(Object.keys(MESSAGES[locale]).sort(), expected, locale);
  }
});

test('resolves browser language tags onto supported locales', () => {
  assert.equal(t('en', 'emptyGreeting'), 'The LORD bless thee, and keep thee.');
  assert.equal(t('ja', 'emptyGreeting'), '天の御加護がありますように');
  assert.equal(resolveLocale(['nan-Latn']), 'nan-Latn');
  assert.equal(resolveLocale(['ja-JP', 'en']), 'ja');
  assert.equal(resolveLocale(['ms-MY']), 'ms');
  assert.equal(t('ms', 'emptyGreeting'), 'Salam');
  assert.equal(resolveLocale(['kxd']), 'kxd');
  assert.equal(t('kxd', 'emptyGreeting'), 'Mualaikum');
  assert.equal(resolveLocale(['Kedayan']), 'kxd');
  assert.equal(resolveLocale(['kadayan']), 'kxd');
  assert.equal(resolveLocale(['ms-BN-Arab']), 'ms-BN-Arab');
  assert.equal(resolveLocale(['ms-bn-arab']), 'ms-BN-Arab');
  assert.equal(resolveLocale(['ms-Arab']), 'ms-BN-Arab');
  assert.equal(resolveLocale(['ms-MY-Arab']), 'ms-BN-Arab');
  assert.equal(t('ms-BN-Arab', 'send'), 'انتت');
  assert.equal(t('ms-BN-Arab', 'emptyGreeting'), 'السلام عليكم');
  assert.equal(localeDir('ms-BN-Arab'), 'rtl');
  assert.equal(localeDir('ms'), 'ltr');
  assert.equal(nextRadioIndex('ArrowRight', 0, 3, 'ltr'), 1);
  assert.equal(nextRadioIndex('ArrowLeft', 0, 3, 'rtl'), 1);
  assert.equal(nextRadioIndex('ArrowRight', 1, 3, 'rtl'), 0);
  assert.equal(resolveLocale(['id-ID']), 'id');
  assert.equal(resolveLocale(['in']), 'id');
  assert.equal(resolveLocale(['ta-SG']), 'ta');
  assert.equal(t('ta', 'emptyGreeting'), 'வணக்கம்');
  assert.equal(resolveLocale(['zh-HK']), 'yue');
  assert.equal(t('yue', 'emptyGreeting'), '願上帝賜福畀你');
  assert.equal(resolveLocale(['yue-Hant-HK']), 'yue');
  assert.equal(resolveLocale(['nan-TW']), 'nan-Latn');
  assert.equal(t('nan-Latn', 'emptyGreeting'), 'Goān Iâ-hô-hoa sù-hok lí');
  assert.equal(resolveLocale(['zh-CN']), 'zh-Hans');
  assert.equal(resolveLocale(['zh-SG']), 'zh-Hans');
  assert.equal(resolveLocale(['zh-Hans-TW']), 'zh-Hans');
  assert.equal(resolveLocale(['zh']), 'en');
  assert.equal(resolveLocale(['zh-Latn']), 'en');
  assert.equal(resolveLocale(['zh-Hant']), 'en');
  assert.equal(resolveLocale(['zh-Hant-TW']), 'en');
  assert.equal(resolveLocale(['zh-TW']), 'en');
  assert.equal(resolveLocale(['zh-MO']), 'en');
  assert.equal(resolveLocale(['zh-Hant-HK']), 'yue');
  assert.equal(resolveLocale(['zh-TW', 'zh']), 'en');
  assert.equal(resolveLocale(['zh-TW', 'zh-CN']), 'zh-Hans');
  assert.equal(resolveLocale(['zh-TW', 'ja']), 'ja');
  assert.equal(t('zh-Hans', 'emptyGreeting'), '全世界无产阶级和被压迫的民族联合起来');
  assert.equal(resolveLocale(['nope']), 'en');
  assert.equal(resolveLocale([]), 'en');
});

test('landing demo states what is particular about Boffin', () => {
  assert.match(MESSAGES.en.inviteOnly, /invite-only/i);
  assert.equal(MESSAGES.en.landingSignIn, 'Start');
  assert.equal(t('en', 'landingInvite', { name: 'Ada' }), 'Ada invited you to use Boffin, click here to accept it.');
  assert.match(MESSAGES.en.landingTagline, /shoot itself in the foot/);
  assert.equal(MESSAGES.en.demoPlay, 'Play demo');
  assert.match(MESSAGES.en.demoAsk, /Export/);
  assert.match(MESSAGES.en.demoAsk, /Settings/);
  assert.match(MESSAGES.en.demoBack, /icon/i);
  assert.match(MESSAGES.en.demoStays, /reload/i);
  assert.match(MESSAGES.en.demoLiveReply, /real application/i);
  assert.match(MESSAGES.en.demoAttachBody, /attach files/i);
  assert.match(MESSAGES.en.demoInviteBody, /invitation link/i);
  assert.equal(MESSAGES.en.previousPeople, 'Previously invited');
  assert.match(MESSAGES.en.manyPasskeysWarning, /already have at least 8 passkeys/);
  assert.match(MESSAGES.en.manyPasskeysWarning, /how many/);
  assert.equal(MESSAGES.en.logOut, 'Log out');
  assert.match(MESSAGES.en.demoLogOutBody, /log out/i);
});

test('sign-in hint keeps the config key names', () => {
  for (const locale of Object.keys(MESSAGES)) {
    const codes = splitMarked(MESSAGES[locale].signInHint)
      .filter((part) => Object.hasOwn(part, 'code'))
      .map((part) => part.code);
    assert.deepEqual(codes, ['username', 'password'], locale);
  }
});

test('the runtime module does not embed locale catalogs', () => {
  const source = fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /The LORD bless thee/);
  assert.doesNotMatch(source, /天の御加護/);
  for (const item of LOCALES) {
    assert.match(source, new RegExp(`import\\('./locales/${item.id}\\.js'\\)`));
  }
});

test('the landing script loads flags only when the language menu is filled', () => {
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /import \{ flagMarkup \} from '\.\/flags\.js'/);
  assert.match(source, /import\('\.\/flags\.js'\)/);
  assert.match(source, /loadAllLocales\(\)/);
  assert.doesNotMatch(source, /Promise\.all\(\[import\('\.\/flags\.js'\), loadAllLocales\(\)\]\)/);
});

test('a non-English catalog load also fetches English', () => {
  const source = fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');
  assert.match(source, /loadOne\(resolved\), loadOne\('en'\)/);
});

test('missing interpolation values throw', () => {
  assert.throws(() => t('en', 'requestFailed'), /\{status\}/);
});

test('fills interpolation slots and maps known server errors', () => {
  assert.equal(t('ja', 'requestFailed', { status: 413 }), 'リクエストに失敗しました（413）。');
  assert.equal(t('nan-Latn', 'send'), 'Kià');
  assert.equal(t('kxd', 'send'), 'Antat');
  assert.equal(translateError('yue', 'Not found.'), '搵唔到。');
  assert.equal(translateError('ta', 'Messages are limited to 32768 characters.'), 'செய்திகள் 32768 எழுத்துகளுக்குள் இருக்க வேண்டும்.');
  assert.equal(translateError('en', 'some unknown error'), 'some unknown error');
  assert.equal(translateError('en', 'Too many attempts. Try again later.'), 'Too many attempts. Try again later.');
  assert.equal(translateError('ja', 'Too many attempts. Try again later.'), '試行が多すぎます。しばらくしてからもう一度お試しください。');
  assert.equal(translateError('ja', 'The spec must be text.'), '仕様はテキストである必要があります。');
  assert.equal(translateError('en', 'The spec is limited to 100000 characters.'), 'The spec is limited to 100000 characters.');
});
