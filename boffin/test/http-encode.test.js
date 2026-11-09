import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { entityTag, httpDate, isNotModified } from '../src/http-encode.js';

test('entity tag is a strong hash of the raw bytes', () => {
  const body = Buffer.from('function ready() {}\n'.repeat(40));
  const hash = createHash('sha256').update(body).digest('hex');
  assert.equal(entityTag(body), `"${hash}"`);
  assert.equal(entityTag(body), entityTag(Buffer.from(body)));
});

test('If-None-Match wins over If-Modified-Since and uses weak comparison', () => {
  const now = new Date('2024-01-02T03:04:05Z');
  const etag = '"abc"';
  assert.equal(isNotModified({ headers: { 'if-none-match': '"abc"' } }, etag, now), true);
  assert.equal(isNotModified({ headers: { 'if-none-match': 'W/"abc"' } }, etag, now), true);
  assert.equal(isNotModified({ headers: { 'if-none-match': '"nope", "abc"' } }, etag, now), true);
  assert.equal(isNotModified({ headers: { 'if-none-match': '*' } }, etag, now), true);
  assert.equal(isNotModified({ headers: { 'if-none-match': '"nope"' } }, etag, now), false);
  assert.equal(
    isNotModified(
      { headers: { 'if-none-match': '"nope"', 'if-modified-since': httpDate(now) } },
      etag,
      now,
    ),
    false,
  );
  assert.equal(isNotModified({ headers: { 'if-modified-since': httpDate(now) } }, etag, now), true);
  assert.equal(
    isNotModified({ headers: { 'if-modified-since': httpDate(new Date(now.getTime() - 2000)) } }, etag, now),
    false,
  );
  assert.equal(isNotModified({ headers: { 'if-modified-since': 'not-a-date' } }, etag, now), false);
});
