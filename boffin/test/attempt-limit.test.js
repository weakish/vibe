import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientAddress, createAttemptLimiter, requestAddress } from '../src/attempt-limit.js';

function fakeRequest(remoteAddress, forwarded) {
  return { socket: { remoteAddress }, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } };
}

test('a loopback peer is charged to the last X-Forwarded-For entry', () => {
  assert.equal(requestAddress(fakeRequest('127.0.0.1', '203.0.113.7')), '203.0.113.7');
  assert.equal(requestAddress(fakeRequest('::ffff:127.0.0.1', '203.0.113.7')), '203.0.113.7');
  assert.equal(requestAddress(fakeRequest('::1', '203.0.113.7')), '203.0.113.7');
  assert.equal(requestAddress(fakeRequest('127.0.0.1', '198.51.100.1, 203.0.113.7')), '203.0.113.7');
});

test('forwarded IPv6 clients still share one /64 budget', () => {
  assert.equal(
    requestAddress(fakeRequest('127.0.0.1', '2001:db8:1:2::1')),
    requestAddress(fakeRequest('127.0.0.1', '2001:db8:1:2::ffff')),
  );
  assert.notEqual(
    requestAddress(fakeRequest('127.0.0.1', '2001:db8:1:2::1')),
    requestAddress(fakeRequest('127.0.0.1', '2001:db8:1:3::1')),
  );
});

test('a non-loopback peer cannot pick its bucket with X-Forwarded-For', () => {
  assert.equal(requestAddress(fakeRequest('203.0.113.7', '198.51.100.9')), '203.0.113.7');
  assert.equal(requestAddress(fakeRequest('::ffff:203.0.113.7', '198.51.100.9')), '203.0.113.7');
  assert.equal(requestAddress(fakeRequest('2001:db8:1:2::5', '198.51.100.9')), clientAddress('2001:db8:1:2::5'));
});

test('a missing or malformed X-Forwarded-For falls back to the peer', () => {
  assert.equal(requestAddress(fakeRequest('127.0.0.1')), '127.0.0.1');
  assert.equal(requestAddress(fakeRequest('127.0.0.1', '')), '127.0.0.1');
  assert.equal(requestAddress(fakeRequest('127.0.0.1', 'not-an-ip')), '127.0.0.1');
  assert.equal(requestAddress(fakeRequest('127.0.0.1', '203.0.113.7, ')), '127.0.0.1');
  assert.equal(requestAddress({ socket: undefined, headers: {} }), 'unknown');
});

test('allows a fixed number of attempts, then the same window again', () => {
  const limiter = createAttemptLimiter(2, 1000);
  assert.equal(limiter.record('a', 0).ok, true);
  assert.equal(limiter.record('a', 10).ok, true);
  assert.equal(limiter.record('a', 20).ok, false);
  assert.equal(limiter.record('b', 20).ok, true);
  assert.equal(limiter.status('a', 20).retryAfter, 1);
  assert.equal(limiter.record('a', 1000).ok, true);
});

test('folds IPv4-mapped addresses onto the IPv4 form', () => {
  assert.equal(clientAddress('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(clientAddress('::ffff:7f00:1'), '127.0.0.1');
  assert.equal(clientAddress('0:0:0:0:0:ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(clientAddress('0:0:0:0:0:ffff:cb00:7107'), '203.0.113.7');
  assert.equal(requestAddress(fakeRequest('127.0.0.1', '0:0:0:0:0:ffff:203.0.113.7')), '203.0.113.7');
  assert.equal(requestAddress(fakeRequest('127.0.0.1', '::ffff:cb00:7107')), '203.0.113.7');
  assert.equal(clientAddress('127.0.0.1'), '127.0.0.1');
  assert.equal(clientAddress('::1'), '::1');
  assert.equal(clientAddress(''), 'unknown');
  assert.equal(clientAddress(undefined), 'unknown');
});

test('counts a routed IPv6 prefix as one /64', () => {
  const prefix = clientAddress('2001:db8:1:2::1');
  assert.equal(prefix, '2001:db8:1:2::/64');
  assert.equal(prefix, clientAddress('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'));
  assert.equal(prefix, clientAddress('2001:db8:1:2::203.0.113.7'));
  assert.notEqual(prefix, clientAddress('2001:db8:1:3::1'));
  assert.equal(clientAddress('fd12:3456:789a:1::1'), clientAddress('FD12:3456:789a:1::2'));
  assert.notEqual(clientAddress('fe80::1'), clientAddress('fe80::2'));

  const limiter = createAttemptLimiter(1, 1000);
  assert.equal(limiter.record(clientAddress('2001:db8:1:2::1'), 0).ok, true);
  assert.equal(limiter.record(clientAddress('2001:db8:1:2::2'), 0).ok, false);
});

test('treats malformed IPv6 text as its own address', () => {
  assert.equal(clientAddress('2001:db8::1::2'), '2001:db8::1::2');
  assert.equal(clientAddress('2001:db8:1:2:3:4:5:6:7'), '2001:db8:1:2:3:4:5:6:7');
  assert.equal(clientAddress('0:0:0:0:0:0:0:1'), '::1');
});

test('keeps a malformed dotted IPv4 tail as its own address', () => {
  for (const text of [
    '::ffff:999.1.1.1',
    '::ffff:01.2.3.4',
    '::ffff:1.2.3',
    '::ffff:1.2.3.4.5',
    '::ffff:garbage.x',
    '1:2:3:4:5:6:7:1.2.3.4',
  ]) {
    assert.equal(clientAddress(text), text);
  }
});

test('drops addresses whose window has passed', () => {
  const limiter = createAttemptLimiter(1, 1000);
  for (let i = 0; i < 1000; i++) {
    limiter.record(`old-${i}`, 0);
  }
  assert.equal(limiter.size, 1000);
  limiter.record('fresh', 5000);
  assert.equal(limiter.size, 1);
  assert.equal(limiter.record('fresh', 5000).ok, false);
});

test('a status check opens no window', () => {
  const limiter = createAttemptLimiter(1, 1000);
  assert.equal(limiter.status('x', 0).ok, true);
  assert.equal(limiter.size, 0);
  assert.equal(limiter.record('x', 900).ok, true);
  assert.equal(limiter.record('x', 1000).ok, false);
});
