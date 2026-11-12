import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Conversation } from '../src/conversation.js';
import { listConversationFiles, listWorkdirFiles, readStashFile, readWorkdirFileForOwner } from '../src/file-view.js';

const quietLogger = { log() {}, error() {} };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function makeConversation(dir) {
  const stateFile = path.join(dir, 'data', 'state.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const conversation = new Conversation({
    model: 'composer-2.5',
    workdir: dir,
    agentBin: 'agent',
    force: true,
    stateFile,
    runAgent: async () => {},
    logger: quietLogger,
  });
  return conversation;
}

test('lists media and stash uploads referenced in the transcript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-files-'));
  const conversation = makeConversation(dir);
  const uploadDir = path.join(dir, '.boffin', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const stashName = `${randomUUID()}-notes.txt`;
  fs.writeFileSync(path.join(uploadDir, stashName), 'hello stash');
  const saved = conversation.media.save({ bytes: PNG, name: 'dot.png' });
  conversation.items = [
    {
      id: '1',
      role: 'user',
      text: 'files',
      attachments: [{ name: 'notes.txt' }, { id: saved.id, name: 'dot.png', mime: 'image/png' }],
    },
    { id: '2', role: 'assistant', text: 'ok', images: [{ id: saved.id, name: 'dot.png' }] },
  ];

  const listed = listConversationFiles(conversation);
  assert.equal(listed.length, 2);
  assert.ok(listed.some((entry) => entry.kind === 'media' && entry.id === saved.id));
  assert.ok(listed.some((entry) => entry.kind === 'stash' && entry.name === 'notes.txt'));

  const stash = listed.find((entry) => entry.kind === 'stash');
  const read = readStashFile(conversation, stash.path);
  assert.equal(read.bytes.toString('utf8'), 'hello stash');
  assert.equal(read.name, 'notes.txt');
});

test('stash lookup does not treat a longer upload name as the same file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-files-'));
  const conversation = makeConversation(dir);
  const uploadDir = path.join(dir, '.boffin', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, `${randomUUID()}-notes.txt`), 'hello stash');
  fs.writeFileSync(path.join(uploadDir, `${randomUUID()}-x-notes.txt`), 'other');
  fs.writeFileSync(path.join(uploadDir, `${randomUUID()}-page.pdf`), '%PDF-1.1');
  conversation.items = [
    {
      id: '1',
      role: 'user',
      text: 'files',
      attachments: [{ name: 'notes.txt' }, { name: 'page.pdf' }],
    },
  ];

  const listed = listConversationFiles(conversation);
  const notes = listed.find((entry) => entry.name === 'notes.txt');
  const pdf = listed.find((entry) => entry.name === 'page.pdf');
  assert.equal(readStashFile(conversation, notes.path).bytes.toString('utf8'), 'hello stash');
  assert.equal(pdf.inline, true);
  assert.equal(pdf.mime, 'application/pdf');
});

test('workdir listing skips private paths and serves owner reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-files-'));
  fs.writeFileSync(path.join(dir, 'config.json'), '{"x":1}');
  fs.writeFileSync(path.join(dir, 'visible.txt'), 'peek');
  fs.writeFileSync(path.join(dir, 'shot'), PNG);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  const conversation = makeConversation(dir);

  const listed = listWorkdirFiles(conversation.workdir);
  assert.deepEqual(
    listed.map((entry) => entry.path),
    ['shot', 'visible.txt'],
  );
  const shot = listed.find((entry) => entry.path === 'shot');
  assert.equal(shot.mime, 'image/png');
  assert.equal(shot.inline, true);

  const file = readWorkdirFileForOwner(conversation, 'visible.txt');
  assert.equal(file.bytes.toString('utf8'), 'peek');
  assert.equal(readWorkdirFileForOwner(conversation, 'config.json'), null);
  assert.equal(readWorkdirFileForOwner(conversation, '../outside'), null);
  assert.equal(listWorkdirFiles(conversation.workdir, { limit: 1 }).length, 1);
});
