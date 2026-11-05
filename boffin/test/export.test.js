import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SPEC } from '../shared/default-spec.js';
import { AGENT, conversationLogFilename, formatConversationLog } from '../shared/export.js';

test('names the download from a UTC timestamp', () => {
  const name = conversationLogFilename(new Date('2026-10-17T03:19:00.000Z'));
  assert.equal(name, 'boffin-chat-2026-10-17T031900Z.json');
  assert.match(DEFAULT_SPEC, new RegExp(name.replaceAll('.', '\\.')));
});

test('formats a conversation as JSON with agent and model', () => {
  const log = JSON.parse(
    formatConversationLog(
      [
        { id: '1', role: 'user', text: 'List files' },
        { id: '2', role: 'tool', name: 'Shell', summary: 'ls', status: 'done' },
        { id: '3', role: 'assistant', text: 'Here they are.' },
        { id: '4', role: 'notice', level: 'info', text: 'Stopped.' },
        { id: '5', role: 'assistant', text: '' },
      ],
      { model: 'composer-2.5', exportedAt: '2026-10-15T11:09:30.123Z' },
    ),
  );

  assert.equal(AGENT, 'cursor');
  assert.deepEqual(log, {
    agent: 'cursor',
    model: 'composer-2.5',
    exportedAt: '2026-10-15T11:09:30.123Z',
    items: [
      { role: 'user', text: 'List files' },
      { role: 'tool', name: 'Shell', status: 'done', summary: 'ls' },
      { role: 'assistant', text: 'Here they are.' },
      { role: 'notice', text: 'Stopped.', level: 'info' },
    ],
  });
});

test('records attachment and image names in the log', () => {
  const log = JSON.parse(
    formatConversationLog([
      { id: '1', role: 'user', text: 'See this', attachments: [{ name: 'shot.png' }, { name: 'notes.txt' }] },
      { id: '2', role: 'tool', name: 'Generate image', summary: 'a red square', status: 'done', images: [{ name: 'square.png' }] },
      { id: '3', role: 'assistant', text: 'Done', images: [{ name: 'square.png' }] },
    ]),
  );
  assert.deepEqual(log.items[0].attachments, ['shot.png', 'notes.txt']);
  assert.deepEqual(log.items[1].images, ['square.png']);
  assert.deepEqual(log.items[2].images, ['square.png']);
});

test('omits workdir, empty metadata, and unknown roles', () => {
  const text = formatConversationLog(
    [
      { id: '1', role: 'user', text: 'hi' },
      { id: '2', role: 'system' },
      { id: '3', role: 'tool', status: 'done', summary: 'ls' },
    ],
    {
      model: 'composer-2.5',
      project: 'garden',
    },
  );
  const log = JSON.parse(text);
  assert.equal(log.agent, 'cursor');
  assert.equal(log.model, 'composer-2.5');
  assert.equal(log.project, undefined);
  assert.doesNotMatch(text, /garden/);
  assert.deepEqual(log.items, [
    { role: 'user', text: 'hi' },
    { role: 'tool', status: 'done', summary: 'ls' },
  ]);
});

test('refuses a log whose items are not an array', () => {
  assert.throws(() => formatConversationLog(null), /array/);
  assert.throws(() => formatConversationLog(undefined), /array/);
});
