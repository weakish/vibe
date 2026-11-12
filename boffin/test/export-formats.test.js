import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown.js';
import {
  buildConversationEpub,
  conversationMarkdownFilename,
  formatConversationLogMarkdown,
} from '../shared/export.js';

const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

test('names markdown exports from the UTC timestamp', () => {
  assert.equal(
    conversationMarkdownFilename(new Date('2026-10-17T03:19:00.000Z')),
    'boffin-chat-2026-10-17T031900Z.md',
  );
});

test('markdown export omits image bytes but names files', () => {
  const text = formatConversationLogMarkdown(
    [
      { role: 'user', text: 'look', attachments: [{ name: 'notes.txt' }] },
      { role: 'assistant', text: 'done', images: [{ id: '00000000-0000-4000-8000-000000000001', name: 'shot.png' }] },
    ],
    { agent: 'cursor', model: 'composer-2.5', exportedAt: '2026-10-15T11:09:30.123Z' },
  );
  assert.match(text, /^---\nagent: cursor\n/);
  assert.match(text, /notes\.txt \(not included/);
  assert.match(text, /shot\.png \(not included/);
  assert.doesNotMatch(text, /00000000/);
});

test('epub export embeds stored images', () => {
  const mediaId = '00000000-0000-4000-8000-000000000099';
  const bytes = buildConversationEpub(
    [{ role: 'assistant', text: 'see', images: [{ id: mediaId, name: 'dot.png' }] }],
    { agent: 'cursor', model: 'x', exportedAt: '2026-01-02T00:00:00.000Z' },
    (id) =>
      id === mediaId ? { bytes: PNG, mime: 'image/png', name: 'dot.png' } : null,
  );
  assert.ok(bytes.length > 200);
  const text = Buffer.from(bytes).toString('binary');
  assert.match(text, /application\/epub\+zip/);
  assert.match(text, /dot\.png/);
  assert.match(text, /PNG/);
  assert.match(text, /src="images\//);
  assert.doesNotMatch(text, /src="EPUB\//);
  assert.match(text, /href="images\//);
  assert.match(text, /media-type="image\/png"/);
  assert.match(text, /<meta property="dcterms:modified">2026-01-02T00:00:00Z<\/meta>/);
  const nameLength = bytes[26] | (bytes[27] << 8);
  const extraLength = bytes[28] | (bytes[29] << 8);
  const method = bytes[8] | (bytes[9] << 8);
  assert.equal(method, 0);
  assert.equal(extraLength, 0);
  assert.equal(Buffer.from(bytes.subarray(30, 30 + nameLength)).toString(), 'mimetype');
});

test('epub chapter uses xhtml-safe markdown', () => {
  const bytes = buildConversationEpub(
    [{ role: 'assistant', text: 'a\nb\n\n---' }],
    { exportedAt: '2026-01-02T00:00:00.000Z' },
    () => null,
    { renderMarkdown },
  );
  const text = Buffer.from(bytes).toString('binary');
  assert.match(text, /<br \/>/);
  assert.match(text, /<hr \/>/);
});
