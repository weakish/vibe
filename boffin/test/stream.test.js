import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWithStallTimeout } from '../public/stream.js';

// A reader whose reads settle only when the test says so.
function controlledReader() {
  const pending = [];
  const reader = {
    cancelled: false,
    read: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    cancel() {
      this.cancelled = true;
      // Browsers reject the in-flight read when the reader is cancelled.
      for (const entry of pending.splice(0)) {
        entry.reject(new TypeError('The read was cancelled.'));
      }
      return Promise.resolve();
    },
  };
  return { reader, pending };
}

test('returns a chunk that arrives in time without cancelling the reader', async () => {
  const { reader, pending } = controlledReader();
  const result = readWithStallTimeout(reader, 1000);
  pending[0].resolve({ done: false, value: 'chunk' });

  assert.deepEqual(await result, { done: false, value: 'chunk' });
  assert.equal(reader.cancelled, false);
});

test('rejects and cancels the reader when the stream goes silent', async () => {
  const { reader } = controlledReader();

  await assert.rejects(readWithStallTimeout(reader, 20), /The connection stalled\./);
  assert.equal(reader.cancelled, true);
});

test('does not cancel a healthy stream after its timer would have fired', async () => {
  const { reader, pending } = controlledReader();
  const first = readWithStallTimeout(reader, 30);
  pending[0].resolve({ done: false, value: 'first' });
  await first;

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(reader.cancelled, false);
});

test('a stalled read does not leave the cancelled read unhandled', async () => {
  const { reader } = controlledReader();
  const rejections = [];
  const onRejection = (error) => rejections.push(error);
  process.on('unhandledRejection', onRejection);
  try {
    await assert.rejects(readWithStallTimeout(reader, 20), /The connection stalled\./);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(rejections, []);
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

test('passes read errors through and cancels the reader', async () => {
  const { reader, pending } = controlledReader();
  const result = readWithStallTimeout(reader, 1000);
  pending[0].reject(new TypeError('network error'));

  await assert.rejects(result, TypeError);
  assert.equal(reader.cancelled, true);
});
