import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberHue, resetMemberColors } from '../public/member-color.js';

test('the same member keeps the same hue', () => {
  resetMemberColors();
  assert.equal(memberHue('jakukyo'), memberHue('jakukyo'));
  assert.equal(memberHue('四地'), memberHue('四地'));
});

test('jakukyo and 四地 land far apart on the wheel', () => {
  resetMemberColors();
  const left = memberHue('jakukyo');
  const right = memberHue('四地');
  const delta = Math.abs(left - right);
  assert.ok(Math.min(delta, 360 - delta) >= 120, `${left} and ${right} are too close`);
});

test('nine members each receive a different hue', () => {
  resetMemberColors();
  const names = ['jakukyo', '四地', 'Ada', 'Grace', 'Boaz', 'Mei', 'Noor', 'Siva', 'Yen'];
  const hues = names.map(memberHue);
  assert.equal(new Set(hues).size, names.length);
  assert.equal(memberHue('Ada'), hues[2]);
});
