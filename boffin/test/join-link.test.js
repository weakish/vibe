import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invitationFromHref } from '../public/join-link.js';

const ID = '550e8400-e29b-41d4-a716-446655440000';

test('a legacy query token moves into the fragment', () => {
  assert.deepEqual(invitationFromHref(`https://example.test/?join=${ID}&x=1`), {
    joinId: ID,
    path: `/?x=1#join=${ID}`,
  });
  assert.deepEqual(invitationFromHref(`https://example.test/app/?join=${ID}`), {
    joinId: ID,
    path: `/app/#join=${ID}`,
  });
});

test('a query token is removed when the fragment already has one', () => {
  const other = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(invitationFromHref(`https://example.test/?join=${ID}#join=${other}`), {
    joinId: other,
    path: `/#join=${other}`,
  });
  assert.deepEqual(invitationFromHref(`https://example.test/?x=1&join=${ID}#join=${ID}`), {
    joinId: ID,
    path: `/?x=1#join=${ID}`,
  });
});

test('a fragment token leaves the URL alone', () => {
  assert.deepEqual(invitationFromHref(`https://example.test/?x=1#join=${ID}`), {
    joinId: ID,
    path: null,
  });
  assert.deepEqual(invitationFromHref('https://example.test/'), {
    joinId: null,
    path: null,
  });
});

test('an empty query token is removed and does not replace a fragment token', () => {
  assert.deepEqual(invitationFromHref(`https://example.test/?join=#join=${ID}`), {
    joinId: ID,
    path: `/#join=${ID}`,
  });
  assert.deepEqual(invitationFromHref('https://example.test/?join='), {
    joinId: null,
    path: '/',
  });
});
