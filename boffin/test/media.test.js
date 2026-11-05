import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_MEDIA_BYTES, createMediaStore, decodeImageBytes, readWorkspaceImage, safeFileName, sniffImage } from '../src/media.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('keeps letters from any language and drops path tricks', () => {
  assert.equal(safeFileName('../shot.png'), 'shot.png');
  assert.equal(safeFileName('メモ.txt'), 'メモ.txt');
  assert.equal(safeFileName('வணக்கம்.md'), 'வணக்கம்.md');
  assert.equal(safeFileName('a/b?.txt'), 'b_.txt');
  assert.equal(safeFileName('..'), 'file');
});

test('recognises PNG bytes and rejects other files', () => {
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(Buffer.from('hello')), null);
  assert.equal(decodeImageBytes(`data:image/png;base64,${PNG.toString('base64')}`)?.equals(PNG), true);
  assert.equal(decodeImageBytes('not an image'), null);
});

test('stores an image under an id and will not read a path outside the workspace', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-media-'));
  const store = createMediaStore(path.join(dir, 'media'));
  const saved = store.save({ bytes: PNG, name: '../shot.png' });
  assert.equal(saved.name, 'shot.png');
  assert.equal(saved.mime, 'image/png');
  assert.ok(store.read(saved.id).bytes.equals(PNG));
  assert.equal(store.read('../shot.png'), null);
  assert.equal(store.save({ bytes: Buffer.from('hello'), name: 'notes.txt' }), null);

  const outside = path.join(os.tmpdir(), `boffin-media-outside-${process.pid}.png`);
  fs.writeFileSync(outside, PNG);
  const link = path.join(dir, 'escape.png');
  fs.symlinkSync(outside, link);
  assert.equal(readWorkspaceImage(dir, link), null);
  const inside = path.join(dir, 'inside.png');
  fs.writeFileSync(inside, PNG);
  assert.ok(readWorkspaceImage(dir, inside).equals(PNG));
  assert.ok(readWorkspaceImage(dir, 'inside.png').equals(PNG));
  const dotted = path.join(dir, '..hidden.png');
  fs.writeFileSync(dotted, PNG);
  assert.ok(readWorkspaceImage(dir, '..hidden.png').equals(PNG));
  assert.ok(readWorkspaceImage(dir, dotted).equals(PNG));
});

test('refuses a replaced media symlink and a file over the cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-media-'));
  const store = createMediaStore(path.join(dir, 'media'));
  const saved = store.save({ bytes: PNG, name: 'shot.png' });
  const mediaFile = path.join(dir, 'media', saved.id);
  fs.rmSync(mediaFile);
  const outside = path.join(dir, 'outside.bin');
  fs.writeFileSync(outside, Buffer.alloc(64));
  fs.symlinkSync(outside, mediaFile);
  assert.equal(store.read(saved.id), null);

  fs.rmSync(mediaFile);
  fs.writeFileSync(mediaFile, PNG);
  fs.rmSync(`${mediaFile}.json`);
  fs.symlinkSync(outside, `${mediaFile}.json`);
  assert.equal(store.read(saved.id), null);

  const id = '01234567-89ab-4cde-8fab-0123456789ab';
  const huge = path.join(dir, 'media', id);
  fs.writeFileSync(huge, PNG);
  fs.truncateSync(huge, MAX_MEDIA_BYTES + 1);
  fs.writeFileSync(`${huge}.json`, JSON.stringify({ name: 'big.png', mime: 'image/png' }));
  assert.equal(store.read(id), null);
});
