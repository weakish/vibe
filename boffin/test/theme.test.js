import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSize, resolveTheme, resolvedScheme } from '../public/theme.js';

test('unknown theme values follow the device', () => {
  assert.equal(resolveTheme('light'), 'light');
  assert.equal(resolveTheme('dark'), 'dark');
  assert.equal(resolveTheme('system'), 'system');
  assert.equal(resolveTheme(''), 'system');
  assert.equal(resolveTheme('nope'), 'system');
  assert.equal(resolveTheme(undefined), 'system');
});

test('unknown size values stay at the default', () => {
  assert.equal(resolveSize('large'), 'large');
  assert.equal(resolveSize('default'), 'default');
  assert.equal(resolveSize(''), 'default');
  assert.equal(resolveSize('nope'), 'default');
  assert.equal(resolveSize(undefined), 'default');
});

test('an explicit choice wins over the device scheme', () => {
  assert.equal(resolvedScheme('light', true), 'light');
  assert.equal(resolvedScheme('dark', false), 'dark');
  assert.equal(resolvedScheme('system', true), 'dark');
  assert.equal(resolvedScheme('system', false), 'light');
});
