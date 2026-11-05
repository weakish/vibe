import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJoinPasskey, JoinDeclinedError } from '../public/passkey.js';

const options = {
  challenge: 'Y2hhbGxlbmdl',
  user: { id: 'dXNlcg', name: 'Ada', displayName: 'Ada' },
  excludeCredentials: [{ type: 'public-key', id: 'ZXhpc3Rpbmc' }],
};
const credential = { id: 'new-credential', type: 'public-key', response: {} };

function alreadyOnDevice() {
  return Object.assign(new Error('The authenticator already holds one of these credentials.'), {
    name: 'InvalidStateError',
  });
}

test('creates the passkey without asking when the device holds none of the excluded ones', async () => {
  const seen = [];
  let asked = 0;
  const result = await createJoinPasskey(options, {
    create: async (value) => {
      seen.push(value);
      return credential;
    },
    confirmSameDevice: async () => {
      asked += 1;
      return true;
    },
  });
  assert.equal(result, credential);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], options);
  assert.equal(asked, 0);
});

test('asks before creating another passkey on a device that already holds one', async () => {
  const seen = [];
  const result = await createJoinPasskey(options, {
    create: async (value) => {
      seen.push(value);
      if (seen.length === 1) {
        throw alreadyOnDevice();
      }
      return credential;
    },
    confirmSameDevice: async () => true,
  });
  assert.equal(result, credential);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1].excludeCredentials, []);
  assert.equal(seen[1].challenge, options.challenge);
});

test('cancelling the warning creates nothing more', async () => {
  let attempts = 0;
  await assert.rejects(
    createJoinPasskey(options, {
      create: async () => {
        attempts += 1;
        throw alreadyOnDevice();
      },
      confirmSameDevice: async () => false,
    }),
    JoinDeclinedError,
  );
  assert.equal(attempts, 1);
});

test('other failures are reported without asking', async () => {
  let asked = 0;
  await assert.rejects(
    createJoinPasskey(options, {
      create: async () => {
        throw Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
      },
      confirmSameDevice: async () => {
        asked += 1;
        return true;
      },
    }),
    { name: 'NotAllowedError' },
  );
  assert.equal(asked, 0);
});
