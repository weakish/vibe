import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES } from '../public/i18n.js';
import { flagMarkup } from '../public/flags.js';

test('every locale has its own flag icon', () => {
  for (const item of LOCALES) {
    const markup = flagMarkup(item.id);
    assert.match(markup, /^<svg\b/);
    assert.doesNotMatch(markup, /<script/i);
  }
});

test('every flag uses the same 3:2 frame', () => {
  for (const item of LOCALES) {
    const markup = flagMarkup(item.id);
    const match = markup.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/);
    assert.ok(match, item.id);
    const width = Number(match[3]);
    const height = Number(match[4]);
    assert.ok(height > 0, item.id);
    assert.ok(Math.abs(width / height - 1.5) < 1e-6, `${item.id} is ${width}:${height}`);
  }
});

test('English uses the St George cross', () => {
  const markup = flagMarkup('en');
  assert.match(markup, /#fff/);
  assert.match(markup, /#c8102e/);
  assert.doesNotMatch(markup, /#012169/i);
});

test('Kedayan uses the Sabah state flag', () => {
  const markup = flagMarkup('kxd');
  assert.match(markup, /#78CDFF/i);
  assert.match(markup, /#002780/i);
  assert.match(markup, /#0085D7/i);
  assert.match(markup, /#fff/i);
  assert.match(markup, /#F5332B/i);
  assert.doesNotMatch(markup, /#0032a0/i);
});

test('Brunei Malay uses the 1906–1959 flag', () => {
  const markup = flagMarkup('ms-BN-Arab');
  assert.match(markup, /#f7e017/i);
  assert.match(markup, /#fff/i);
  assert.match(markup, /#000/);
  assert.doesNotMatch(markup, /#cf0921/i);
});

test('Malay uses the Federated Malay States flag', () => {
  const markup = flagMarkup('ms');
  assert.match(markup, /#fff/);
  assert.match(markup, /#c8102e/);
  assert.match(markup, /#ffc72c/);
  assert.match(markup, /#000/);
  assert.doesNotMatch(markup, /#0032a0/i);
});

test('Cantonese uses the 1876–1955 Hong Kong flag', () => {
  const markup = flagMarkup('yue');
  assert.match(markup, /#012169/i);
  assert.match(markup, /#c8102e/i);
  assert.match(markup, /#fff/i);
  assert.match(markup, /#5f8a2e/i);
  assert.match(markup, /#e0b325/i);
  assert.doesNotMatch(markup, /#de2910/i);
  assert.doesNotMatch(markup, /fill="#000"/);
});

test('Pe̍h-ōe-jī uses the Hearts-in-Harmony flag', () => {
  const markup = flagMarkup('nan-Latn');
  assert.match(markup, /#008000/);
  assert.match(markup, /#fff/);
  assert.match(markup, /#ff0000/);
  assert.doesNotMatch(markup, /#000095/i);
  assert.doesNotMatch(markup, /#fe0000/i);
});

test('Tamil uses the green Pudukkottai standard', () => {
  const markup = flagMarkup('ta');
  assert.match(markup, /#0b5c2e/);
  assert.doesNotMatch(markup, /#ff9933/i);
});

test('refuses names that are not own keys of the flag table', () => {
  assert.throws(() => flagMarkup('constructor'), /No flag icon/);
  assert.throws(() => flagMarkup('__proto__'), /No flag icon/);
});
