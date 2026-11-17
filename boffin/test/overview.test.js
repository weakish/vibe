import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConversationOverview, clipSummary } from '../src/overview.js';

test('clips long texts and collapses whitespace', () => {
  assert.equal(clipSummary('  hello   world  ', 100), 'hello world');
  assert.equal(clipSummary('a'.repeat(10), 10), 'a'.repeat(10));
  assert.equal(clipSummary('a'.repeat(11), 10), `${'a'.repeat(10)}…`);
  assert.equal(clipSummary('héllo wörld', 5), 'héllo…');
});

test('an empty transcript digests to nothing', () => {
  const overview = buildConversationOverview({ items: [] });
  assert.equal(overview.empty, true);
  assert.equal(overview.topic, null);
  assert.deepEqual(overview.requests, []);
  assert.deepEqual(overview.responses, []);
  assert.deepEqual(overview.work, []);
  assert.deepEqual(overview.materials, []);
  assert.deepEqual(overview.issues, []);
});

test('digests requests, responses, work, materials, and issues', () => {
  const overview = buildConversationOverview({
    items: [
      { id: '1', role: 'user', author: 'Ada', text: 'add dark mode', attachments: [{ name: 'mock.png' }] },
      { id: '2', role: 'assistant', text: 'on it' },
      { id: '3', role: 'tool', name: 'Edit', status: 'done', summary: 'public/styles.css' },
      { id: '4', role: 'user', author: 'Ken', text: 'and a toggle' },
      { id: '5', role: 'assistant', text: 'done', images: [{ id: 'x', name: 'shot.png', mime: 'image/png' }] },
      { id: '6', role: 'notice', level: 'error', text: 'bad line' },
      { id: '7', role: 'notice', text: 'stopped' },
    ],
  });
  assert.equal(overview.empty, false);
  assert.deepEqual(overview.topic, { author: 'Ada', text: 'add dark mode' });
  assert.deepEqual(overview.requests, [
    { author: 'Ada', text: 'add dark mode' },
    { author: 'Ken', text: 'and a toggle' },
  ]);
  assert.deepEqual(overview.responses, [{ text: 'on it' }, { text: 'done' }]);
  assert.deepEqual(overview.work, [{ name: 'Edit', summary: 'public/styles.css' }]);
  assert.deepEqual(overview.materials, ['mock.png', 'shot.png']);
  assert.deepEqual(overview.issues, [{ text: 'bad line' }]);
});

test('material names are deduplicated in order', () => {
  const overview = buildConversationOverview({
    items: [
      { id: '1', role: 'user', text: 'hi', attachments: [{ name: 'a.txt' }, { name: 'a.txt' }] },
      { id: '2', role: 'assistant', text: 'ok', images: [{ id: 'x', name: 'a.txt' }] },
    ],
  });
  assert.deepEqual(overview.materials, ['a.txt']);
});
