import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttachmentError, parseAttachments } from '../src/attachments.js';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../shared/limits.js';

test('decodes a list of base64 files', () => {
  const files = parseAttachments([{ name: ' notes.txt ', data: Buffer.from('hello').toString('base64') }]);
  assert.equal(files[0].name, 'notes.txt');
  assert.equal(files[0].bytes.toString(), 'hello');
  assert.deepEqual(parseAttachments(undefined), []);
});

test('rejects a bad list, bad bytes, and files past the cap', () => {
  assert.throws(() => parseAttachments('nope'), AttachmentError);
  assert.throws(() => parseAttachments([{ name: 'a.txt', data: '@@@' }]), /not valid/);
  assert.throws(
    () => parseAttachments(Array.from({ length: MAX_ATTACHMENTS + 1 }, () => ({ name: 'a.txt', data: 'aGk=' }))),
    /up to 8 files/,
  );
  const tooBig = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1).toString('base64');
  assert.throws(() => parseAttachments([{ name: 'big.bin', data: tooBig }]), (error) => error.status === 413);
});
