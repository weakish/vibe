import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '../src/config.js';
import { Conversation, INVITE_TTL_MS } from '../src/conversation.js';
import { runAgent } from '../src/agent.js';
import { LOGIN_CREDENTIAL_SLOTS, createServer } from '../src/server.js';
import { encodeCbor, passkeyOrigin } from '../src/webauthn.js';

const FAKE_AGENT = fileURLToPath(new URL('../fixtures/fake-agent.js', import.meta.url));
const USER = 'tester';
const PASS = 'test-password-1234';
const quietLogger = { log() {}, error() {} };

function authenticator({ idBytes = 16, flags = null, extension = null } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(idBytes);
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  let counter = 0;

  function authData(attested) {
    const header = Buffer.alloc(37);
    createHash('sha256').update('localhost').digest().copy(header, 0);
    counter += 1;
    header[32] = flags ? flags[attested ? 'attested' : 'assert'] : attested ? 0x45 : 0x05;
    header.writeUInt32BE(counter, 33);
    if (!attested) {
      return header;
    }
    const cose = encodeCbor(
      new Map([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, x],
        [-3, y],
      ]),
    );
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(credentialId.length);
    const body = Buffer.concat([header, Buffer.alloc(16), idLen, credentialId, cose]);
    return extension ? Buffer.concat([body, extension]) : body;
  }

  function clientData(type, challenge, origin) {
    return Buffer.from(
      JSON.stringify({
        type,
        challenge: Buffer.from(challenge).toString('base64url'),
        origin,
        crossOrigin: false,
      }),
    );
  }

  return {
    id: credentialId.toString('base64url'),
    register(challenge, origin) {
      const client = clientData('webauthn.create', challenge, origin);
      const attestation = encodeCbor(
        new Map([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData(true)],
        ]),
      );
      return {
        id: credentialId.toString('base64url'),
        type: 'public-key',
        response: {
          clientDataJSON: client.toString('base64url'),
          attestationObject: attestation.toString('base64url'),
        },
      };
    },
    assert(challenge, origin) {
      const client = clientData('webauthn.get', challenge, origin);
      const data = authData(false);
      const signature = sign('sha256', Buffer.concat([data, createHash('sha256').update(client).digest()]), privateKey);
      return {
        id: credentialId.toString('base64url'),
        type: 'public-key',
        response: {
          clientDataJSON: client.toString('base64url'),
          authenticatorData: data.toString('base64url'),
          signature: signature.toString('base64url'),
        },
      };
    },
  };
}

async function startServer(
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-passkey-')),
  { password = PASS } = {},
) {
  const conversation = new Conversation({
    model: 'composer-2.5',
    workdir: dir,
    agentBin: FAKE_AGENT,
    force: true,
    stateFile: path.join(dir, 'state', 'state.json'),
    runAgent: (options) => runAgent({ ...options, logger: quietLogger }),
    logger: quietLogger,
  });
  const server = createServer({ conversation, username: USER, password, logger: quietLogger });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  const origin = `http://localhost:${port}`;
  return {
    dir,
    baseUrl,
    origin,
    conversation,
    close: async () => {
      await conversation.stop();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function call(baseUrl, route, { method = 'GET', body, token, origin, host, headers: extraHeaders } = {}) {
  const url = new URL(baseUrl);
  const headers = { Host: host ?? url.host, ...extraHeaders };
  if (origin) {
    headers.Origin = origin;
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  if (payload !== null) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(payload.length);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: Number(url.port), path: route, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: async () => text,
            json: async () => JSON.parse(text),
          });
        });
      },
    );
    req.on('error', reject);
    if (payload !== null) {
      req.write(payload);
    }
    req.end();
  });
}

async function registerOwner(app, device = authenticator()) {
  const started = await call(app.baseUrl, '/api/auth/password', {
    method: 'POST',
    origin: app.origin,
    body: { username: USER, password: PASS },
  });
  assert.equal(started.status, 200);
  const options = await started.json();
  const credential = device.register(Buffer.from(options.options.challenge, 'base64url'), app.origin);
  const registered = await call(app.baseUrl, '/api/auth/register', {
    method: 'POST',
    origin: app.origin,
    body: { challengeId: options.challengeId, credential },
  });
  assert.equal(registered.status, 200);
  return { device, session: await registered.json() };
}

async function signIn(app, device, username = USER) {
  const options = await call(app.baseUrl, '/api/auth/options', { method: 'POST', origin: app.origin, body: { username } });
  assert.equal(options.status, 200);
  const body = await options.json();
  const credential = device.assert(Buffer.from(body.options.challenge, 'base64url'), app.origin);
  const loggedIn = await call(app.baseUrl, '/api/auth/login', {
    method: 'POST',
    origin: app.origin,
    body: { challengeId: body.challengeId, credential },
  });
  assert.equal(loggedIn.status, 200);
  return loggedIn.json();
}

test('the owner password works once, then the passkey signs in from another request', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  assert.deepEqual(await (await call(app.baseUrl, '/api/auth/status')).json(), { started: false, invite: null });
  assert.equal((await call(app.baseUrl, '/api/auth/password', { method: 'POST', body: { username: USER, password: PASS } })).status, 400);

  const owner = await registerOwner(app);
  assert.equal(owner.session.you.owner, true);
  assert.equal(owner.session.home, 'chat');
  assert.equal(owner.session.canManage, true);
  assert.equal(owner.session.people.length, 1);
  assert.equal(owner.session.people[0].owner, true);

  const basic = await call(app.baseUrl, '/api/session', {
    headers: { Authorization: `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}` },
  });
  assert.equal(basic.status, 401);
  assert.equal((await basic.json()).error, 'Invalid or missing username or password.');

  const again = await call(app.baseUrl, '/api/auth/password', {
    method: 'POST',
    origin: app.origin,
    body: { username: USER, password: PASS },
  });
  assert.equal(again.status, 401);

  const returned = await signIn(app, owner.device);
  assert.equal(returned.you.name, USER);
  assert.equal(returned.home, 'chat');
  assert.equal(returned.canManage, true);
  assert.equal((await call(app.baseUrl, '/api/session', { method: 'DELETE', token: returned.token })).status, 200);
  assert.equal((await call(app.baseUrl, '/api/session', { token: returned.token })).status, 401);
  const afterLogout = await signIn(app, owner.device);
  assert.equal(afterLogout.home, 'chat');
  assert.equal(afterLogout.canManage, true);
  assert.equal((await call(app.baseUrl, '/api/auth/options', { method: 'POST', origin: app.origin, body: {} })).status, 400);
  const unknown = await call(app.baseUrl, '/api/auth/options', {
    method: 'POST',
    origin: app.origin,
    body: { username: 'nobody' },
  });
  assert.equal(unknown.status, 200);
  const unknownBody = await unknown.json();
  assert.equal(unknownBody.options.allowCredentials.length, LOGIN_CREDENTIAL_SLOTS);
  const repeated = await call(app.baseUrl, '/api/auth/options', {
    method: 'POST',
    origin: app.origin,
    body: { username: 'nobody' },
  });
  assert.deepEqual((await repeated.json()).options.allowCredentials, unknownBody.options.allowCredentials);
  const known = await call(app.baseUrl, '/api/auth/options', {
    method: 'POST',
    origin: app.origin,
    body: { username: USER },
  });
  const knownIds = (await known.json()).options.allowCredentials.map((item) => item.id);
  assert.equal(knownIds.length, LOGIN_CREDENTIAL_SLOTS);
  assert.equal(knownIds.includes(owner.device.id), true);
  assert.notDeepEqual(knownIds, unknownBody.options.allowCredentials.map((item) => item.id));
  const refused = await call(app.baseUrl, '/api/auth/login', {
    method: 'POST',
    origin: app.origin,
    body: {
      challengeId: unknownBody.challengeId,
      credential: owner.device.assert(Buffer.from(unknownBody.options.challenge, 'base64url'), app.origin),
    },
  });
  assert.equal(refused.status, 401);
  assert.equal((await refused.json()).error, 'The passkey was not accepted.');
});

test('placeholder ids do not depend on the password', async (t) => {
  const apps = [await startServer(), await startServer()];
  t.after(() => Promise.all(apps.map((app) => app.close())));
  const lists = [];
  for (const app of apps) {
    await registerOwner(app);
    const response = await call(app.baseUrl, '/api/auth/options', {
      method: 'POST',
      origin: app.origin,
      body: { username: 'nobody' },
    });
    lists.push((await response.json()).options.allowCredentials.map((item) => item.id));
  }
  assert.equal(lists[0].length, LOGIN_CREDENTIAL_SLOTS);
  assert.equal(lists[1].length, LOGIN_CREDENTIAL_SLOTS);
  assert.notDeepEqual(lists[0], lists[1]);
});

test('placeholder ids stay the same after a restart', async (t) => {
  let open = await startServer();
  t.after(() => open?.close());
  await registerOwner(open);

  async function ids(app, username) {
    const response = await call(app.baseUrl, '/api/auth/options', {
      method: 'POST',
      origin: app.origin,
      body: { username },
    });
    assert.equal(response.status, 200);
    return (await response.json()).options.allowCredentials.map((item) => item.id);
  }

  const beforeNobody = await ids(open, 'nobody');
  const beforeOwner = await ids(open, USER);
  const dir = open.dir;
  await open.close();
  open = null;
  open = await startServer(dir);
  assert.deepEqual(await ids(open, 'nobody'), beforeNobody);
  assert.deepEqual(await ids(open, USER), beforeOwner);
});

test('an invitation passkey joins, and a removed person exports only the earlier log', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await registerOwner(app);

  const invite = await call(app.baseUrl, '/api/invites', { method: 'POST', token: owner.session.token, body: {} });
  assert.equal(invite.status, 200);
  const { id, path: invitePath } = await invite.json();
  assert.equal(invitePath, `/#join=${id}`);
  assert.deepEqual(await (await call(app.baseUrl, `/api/auth/status?join=${id}`)).json(), {
    started: true,
    invite: null,
  });
  assert.deepEqual(
    await (await call(app.baseUrl, '/api/auth/status', { method: 'POST', body: { join: id } })).json(),
    {
      started: true,
      invite: { ownerName: USER },
    },
  );

  const guest = authenticator();
  const joining = await call(app.baseUrl, '/api/join', {
    method: 'POST',
    origin: app.origin,
    body: { inviteId: id, name: 'Ada' },
  });
  assert.equal(joining.status, 200);
  const joinOptions = await joining.json();
  const credential = guest.register(Buffer.from(joinOptions.options.challenge, 'base64url'), app.origin);
  const finished = await call(app.baseUrl, '/api/join/finish', {
    method: 'POST',
    origin: app.origin,
    body: { challengeId: joinOptions.challengeId, credential },
  });
  assert.equal(finished.status, 200);
  const member = await finished.json();
  assert.equal(member.you.name, 'Ada');
  assert.equal(member.home, 'chat');
  assert.equal(member.canManage, false);
  assert.equal(member.canSwitchConversation, false);
  assert.deepEqual(member.invites, []);
  assert.deepEqual(member.alumni, []);

  const guestInvite = await call(app.baseUrl, '/api/invites', { method: 'POST', token: member.token, body: {} });
  assert.equal(guestInvite.status, 403);
  assert.equal((await guestInvite.json()).error, 'Only the owner can do that.');

  const sent = await call(app.baseUrl, '/api/messages', {
    method: 'POST',
    token: member.token,
    body: { text: 'hello' },
  });
  assert.equal(sent.status, 200);
  await sent.text();
  assert.equal(app.conversation.items[0].author, 'Ada');

  const used = await call(app.baseUrl, '/api/join', {
    method: 'POST',
    origin: app.origin,
    body: { inviteId: id, name: 'Bea' },
  });
  assert.equal(used.status, 404);

  const removed = await call(app.baseUrl, `/api/members/${member.you.id}`, { method: 'DELETE', token: owner.session.token });
  assert.equal(removed.status, 200);
  await call(app.baseUrl, '/api/messages', { method: 'POST', token: owner.session.token, body: { text: 'after' } }).then((response) => response.text());

  const guestAgain = await signIn(app, guest, 'Ada');
  assert.equal(guestAgain.home, 'list');
  assert.equal(guestAgain.conversations.length, 1);
  assert.equal(guestAgain.conversations[0].active, false);
  const log = await call(app.baseUrl, `/api/logs/${guestAgain.conversations[0].id}`, { token: guestAgain.token });
  assert.equal(log.status, 200);
  const body = await log.json();
  assert.match(body.filename, /^boffin-chat-.*\.json$/);
  const kept = JSON.parse(body.text);
  assert.equal(kept.agent, 'cursor');
  assert.equal(kept.model, 'composer-2.5');
  assert.equal(kept.project, undefined);
  assert.deepEqual(
    kept.items.filter((item) => item.role === 'user').map((item) => item.text),
    ['hello'],
  );
  assert.equal(kept.items.some((item) => item.author === 'Ada'), true);
  assert.equal(body.text.includes('after'), false);

  const source = await call(app.baseUrl, `/api/logs/${guestAgain.conversations[0].id}?format=source`, { token: guestAgain.token });
  assert.equal(source.status, 200);
  const sourceBody = await source.json();
  assert.equal(sourceBody.items.some((item) => item.role === 'user' && item.text === 'hello' && item.id), true);
  assert.equal(sourceBody.text, undefined);

  const ended = await call(app.baseUrl, '/api/new', { method: 'POST', token: owner.session.token });
  assert.equal(ended.status, 200);
  const ownerAgain = await signIn(app, owner.device);
  assert.equal(ownerAgain.home, 'chat');
  assert.deepEqual(ownerAgain.items, []);

  const closed = await call(app.baseUrl, '/api/session?open=active', { token: guestAgain.token });
  assert.equal(closed.status, 403);
  const forbidden = await call(app.baseUrl, '/api/new', { method: 'POST', token: member.token });
  assert.equal(forbidden.status, 403);

  assert.deepEqual(ownerAgain.alumni, [{ id: member.you.id, name: 'Ada', owner: false }]);
  assert.equal((await call(app.baseUrl, `/api/members/${member.you.id}`, {
    method: 'POST',
    token: guestAgain.token,
    body: {},
  })).status, 403);
  const restored = await call(app.baseUrl, `/api/members/${member.you.id}`, {
    method: 'POST',
    token: ownerAgain.token,
    body: {},
  });
  assert.equal(restored.status, 200);
  const afterAdd = await call(app.baseUrl, '/api/session', { token: ownerAgain.token });
  assert.equal(afterAdd.status, 200);
  const roster = await afterAdd.json();
  assert.equal(roster.people.some((person) => person.id === member.you.id), true);
  assert.deepEqual(roster.alumni, []);
  const opened = await call(app.baseUrl, '/api/session?open=active', { token: guestAgain.token });
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).home, 'chat');
});

test('a name stays taken after its holder leaves, and the owner adds them back', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await registerOwner(app);

  async function join(name, device = authenticator()) {
    const invite = await call(app.baseUrl, '/api/invites', { method: 'POST', token: owner.session.token, body: {} });
    assert.equal(invite.status, 200);
    const { id } = await invite.json();
    const joining = await call(app.baseUrl, '/api/join', {
      method: 'POST',
      origin: app.origin,
      body: { inviteId: id, name },
    });
    assert.equal(joining.status, 200);
    const joinOptions = await joining.json();
    const credential = device.register(Buffer.from(joinOptions.options.challenge, 'base64url'), app.origin);
    const finished = await call(app.baseUrl, '/api/join/finish', {
      method: 'POST',
      origin: app.origin,
      body: { challengeId: joinOptions.challengeId, credential },
    });
    assert.equal(finished.status, 200);
    return { device, session: await finished.json() };
  }

  const first = await join('Ada');
  assert.equal((await call(app.baseUrl, `/api/members/${first.session.you.id}`, {
    method: 'DELETE',
    token: owner.session.token,
  })).status, 200);
  const invitation = await call(app.baseUrl, '/api/invites', { method: 'POST', token: owner.session.token, body: {} });
  assert.equal(invitation.status, 200);
  const { id: inviteId } = await invitation.json();
  const refused = await call(app.baseUrl, '/api/join', {
    method: 'POST',
    origin: app.origin,
    body: { inviteId, name: 'Ada' },
  });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error, 'That name is already used.');

  const readded = await call(app.baseUrl, `/api/members/${first.session.you.id}`, {
    method: 'POST',
    token: owner.session.token,
    body: {},
  });
  assert.equal(readded.status, 200);

  const options = await call(app.baseUrl, '/api/auth/options', {
    method: 'POST',
    origin: app.origin,
    body: { username: 'Ada' },
  });
  assert.equal(options.status, 200);
  const listed = (await options.json()).options.allowCredentials.map((item) => item.id);
  assert.equal(listed.length, LOGIN_CREDENTIAL_SLOTS);
  assert.equal(listed.includes(first.device.id), true);

  // She also has the log from when she was removed, so sign-in lists both conversations.
  const back = await signIn(app, first.device, 'Ada');
  assert.equal(back.you.id, first.session.you.id);
  assert.equal(back.home, 'list');
  assert.equal(back.conversations.length, 2);
  assert.equal(back.conversations.some((item) => item.active), true);

  const active = await call(app.baseUrl, '/api/session?open=active', { token: back.token });
  assert.equal(active.status, 200);
  const activeBody = await active.json();
  assert.equal(activeBody.home, 'chat');
  assert.equal(activeBody.canSwitchConversation, true);

  const listAgain = await call(app.baseUrl, '/api/session?open=list', { token: back.token });
  assert.equal(listAgain.status, 200);
  const listBody = await listAgain.json();
  assert.equal(listBody.home, 'list');
  assert.equal(listBody.conversations.length, 2);
});

test('someone already in the conversation cannot join again through a link', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await registerOwner(app);
  assert.equal(owner.session.you.inConversation, true);

  async function createInvite() {
    const response = await call(app.baseUrl, '/api/invites', { method: 'POST', token: owner.session.token, body: {} });
    assert.equal(response.status, 200);
    return (await response.json()).id;
  }

  const firstId = await createInvite();
  const ada = authenticator();
  const joining = await call(app.baseUrl, '/api/join', {
    method: 'POST',
    origin: app.origin,
    body: { inviteId: firstId, name: 'Ada' },
  });
  assert.equal(joining.status, 200);
  const joinOptions = await joining.json();
  const credential = ada.register(Buffer.from(joinOptions.options.challenge, 'base64url'), app.origin);
  const finished = await call(app.baseUrl, '/api/join/finish', {
    method: 'POST',
    origin: app.origin,
    body: { challengeId: joinOptions.challengeId, credential },
  });
  assert.equal(finished.status, 200);
  const member = await finished.json();
  assert.equal(member.you.inConversation, true);

  // The browser is told which passkeys already exist, so the same device cannot register another.
  const secondId = await createInvite();
  const anonymous = await call(app.baseUrl, '/api/join', {
    method: 'POST',
    origin: app.origin,
    body: { inviteId: secondId, name: 'Bea' },
  });
  assert.equal(anonymous.status, 200);
  const excluded = (await anonymous.json()).options.excludeCredentials.map((item) => item.id).sort();
  const ownerAndMember = app.conversation.passkeys
    .filter((passkey) => passkey.personId === 'owner' || passkey.personId === member.you.id)
    .map((passkey) => passkey.credentialId)
    .sort();
  assert.deepEqual(excluded, ownerAndMember);
  assert.equal(excluded.length, 2);

  // A signed-in member, or the owner, is refused. Without a session the server cannot tell who is asking.
  const memberAgain = await call(app.baseUrl, '/api/join', {
    method: 'POST',
    origin: app.origin,
    token: member.token,
    body: { inviteId: secondId, name: 'Bea' },
  });
  assert.equal(memberAgain.status, 403);
  assert.equal((await memberAgain.json()).error, 'That person is already in the conversation.');
  const ownerAgain = await call(app.baseUrl, '/api/join', {
    method: 'POST',
    origin: app.origin,
    token: owner.session.token,
    body: { inviteId: secondId, name: 'Bea' },
  });
  assert.equal(ownerAgain.status, 403);
  assert.equal(app.conversation.identities.length, 1);
  assert.equal(app.conversation.invites.some((invite) => invite.id === secondId), true);

  // Once removed, Ada is no longer in the conversation: her passkeys are no longer excluded,
  // and she may join again under a new name.
  assert.equal((await call(app.baseUrl, `/api/members/${member.you.id}`, {
    method: 'DELETE',
    token: owner.session.token,
  })).status, 200);
  const removed = await (await call(app.baseUrl, '/api/session', { token: member.token })).json();
  assert.equal(removed.you.inConversation, false);
  const afterRemoval = await call(app.baseUrl, '/api/join', {
    method: 'POST',
    origin: app.origin,
    body: { inviteId: secondId, name: 'Cy' },
  });
  const excludedAfterRemoval = (await afterRemoval.json()).options.excludeCredentials.map((item) => item.id);
  assert.deepEqual(
    excludedAfterRemoval,
    app.conversation.passkeys.filter((passkey) => passkey.personId === 'owner').map((passkey) => passkey.credentialId),
  );
  const rejoining = await call(app.baseUrl, '/api/join', {
    method: 'POST',
    origin: app.origin,
    token: member.token,
    body: { inviteId: secondId, name: 'Ada again' },
  });
  assert.equal(rejoining.status, 200);
});

async function addPasskey(app, token, device = authenticator(), label = '') {
  const started = await call(app.baseUrl, '/api/passkeys', {
    method: 'POST',
    origin: app.origin,
    token,
    body: { label },
  });
  assert.equal(started.status, 200);
  const options = await started.json();
  const credential = device.register(Buffer.from(options.options.challenge, 'base64url'), app.origin);
  const finished = await call(app.baseUrl, '/api/passkeys/finish', {
    method: 'POST',
    origin: app.origin,
    token,
    body: { challengeId: options.challengeId, credential },
  });
  assert.equal(finished.status, 200);
  return { device, passkeys: (await finished.json()).passkeys };
}

test('adding a passkey warns once a person already has as many as sign-in lists', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await registerOwner(app);

  async function warnsBeforeAdd() {
    const started = await call(app.baseUrl, '/api/passkeys', {
      method: 'POST',
      origin: app.origin,
      token: owner.session.token,
      body: { label: '' },
    });
    assert.equal(started.status, 200);
    return (await started.json()).warnBeforeAdd;
  }

  // The owner starts with one passkey. Add until the sign-in list is full.
  for (let i = 1; i < LOGIN_CREDENTIAL_SLOTS; i += 1) {
    assert.equal(await warnsBeforeAdd(), false);
    await addPasskey(app, owner.session.token);
  }
  assert.equal(await warnsBeforeAdd(), true);
  // The warning is advice only: the ninth passkey is still saved.
  const ninth = await addPasskey(app, owner.session.token);
  assert.equal(ninth.passkeys.length, LOGIN_CREDENTIAL_SLOTS + 1);
});

test('a person can add a passkey and cannot remove the last one', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await registerOwner(app);

  const listed = await call(app.baseUrl, '/api/passkeys', { token: owner.session.token });
  assert.equal(listed.status, 200);
  const first = (await listed.json()).passkeys;
  assert.equal(first.length, 1);

  const extra = await addPasskey(app, owner.session.token);
  assert.equal(extra.passkeys.length, 2);
  const second = await signIn(app, extra.device);
  assert.equal(second.you.owner, true);

  const duplicate = await call(app.baseUrl, '/api/passkeys', {
    method: 'POST',
    origin: app.origin,
    token: owner.session.token,
    body: {},
  });
  const duplicateOptions = await duplicate.json();
  const again = owner.device.register(Buffer.from(duplicateOptions.options.challenge, 'base64url'), app.origin);
  const rejected = await call(app.baseUrl, '/api/passkeys/finish', {
    method: 'POST',
    origin: app.origin,
    token: owner.session.token,
    body: { challengeId: duplicateOptions.challengeId, credential: again },
  });
  assert.equal(rejected.status, 409);

  const removed = await call(app.baseUrl, `/api/passkeys/${first[0].id}`, {
    method: 'DELETE',
    token: owner.session.token,
  });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).passkeys[0].id, extra.passkeys[1].id);

  const staleOptions = await call(app.baseUrl, '/api/auth/options', {
    method: 'POST',
    origin: app.origin,
    body: { username: USER },
  });
  const staleBody = await staleOptions.json();
  const staleCredential = owner.device.assert(Buffer.from(staleBody.options.challenge, 'base64url'), app.origin);
  const stale = await call(app.baseUrl, '/api/auth/login', {
    method: 'POST',
    origin: app.origin,
    body: { challengeId: staleBody.challengeId, credential: staleCredential },
  });
  assert.equal(stale.status, 401);

  const kept = await signIn(app, extra.device);
  assert.equal(kept.home, 'chat');
  const last = await call(app.baseUrl, `/api/passkeys/${extra.passkeys[1].id}`, {
    method: 'DELETE',
    token: kept.token,
  });
  assert.equal(last.status, 400);
  assert.equal((await last.json()).error, 'Keep at least one passkey.');
  assert.equal((await signIn(app, extra.device)).you.owner, true);
});

test('a passkey label is set when adding and cannot change later', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const owner = await registerOwner(app);
  const listed = await call(app.baseUrl, '/api/passkeys', { token: owner.session.token });
  const saved = (await listed.json()).passkeys;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].label, '');

  const tooLong = await call(app.baseUrl, '/api/passkeys', {
    method: 'POST',
    origin: app.origin,
    token: owner.session.token,
    body: { label: 'a'.repeat(41) },
  });
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error, 'A label may be up to 40 characters.');

  const broken = await call(app.baseUrl, '/api/passkeys', {
    method: 'POST',
    origin: app.origin,
    token: owner.session.token,
    body: { label: 'ok\n' },
  });
  assert.equal(broken.status, 400);
  assert.equal((await broken.json()).error, 'That label is not valid.');

  const notText = await call(app.baseUrl, '/api/passkeys', {
    method: 'POST',
    origin: app.origin,
    token: owner.session.token,
    body: { label: 1 },
  });
  assert.equal(notText.status, 400);
  assert.equal((await notText.json()).error, 'That label is not valid.');

  const extra = await addPasskey(app, owner.session.token, authenticator(), '  Phone  ');
  assert.equal(extra.passkeys.length, 2);
  assert.equal(extra.passkeys[1].label, 'Phone');

  const renamed = await call(app.baseUrl, `/api/passkeys/${extra.passkeys[1].id}`, {
    method: 'PATCH',
    token: owner.session.token,
    body: { label: 'Tablet' },
  });
  assert.equal(renamed.status, 404);

  const stored = JSON.parse(fs.readFileSync(app.conversation.stateFile, 'utf8'));
  delete stored.passkeys[0].label;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-passkey-'));
  const stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify(stored));
  const loaded = new Conversation({
    model: 'composer-2.5',
    workdir: dir,
    agentBin: FAKE_AGENT,
    force: true,
    stateFile,
    runAgent: (options) => runAgent({ ...options, logger: quietLogger }),
    logger: quietLogger,
  });
  t.after(() => loaded.stop());
  assert.equal(loaded.listPasskeys('owner')[0].label, '');
  assert.equal(loaded.listPasskeys('owner')[1].label, 'Phone');
});

test('a previous owner passkey is kept when the state file is loaded', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-passkey-'));
  const stateFile = path.join(dir, 'state', 'state.json');
  const device = authenticator();
  const app = await startServer();
  t.after(() => app.close());
  const owner = await registerOwner(app, device);
  const saved = JSON.parse(fs.readFileSync(app.conversation.stateFile, 'utf8'));
  const legacy = saved.passkeys[0];
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({
    version: 1,
    chatId: null,
    items: [],
    ownerPasskey: {
      credentialId: legacy.credentialId,
      publicKey: legacy.publicKey,
      signCount: legacy.signCount,
    },
  }));
  const loaded = new Conversation({
    model: 'composer-2.5',
    workdir: dir,
    agentBin: FAKE_AGENT,
    force: true,
    stateFile,
    runAgent: (options) => runAgent({ ...options, logger: quietLogger }),
    logger: quietLogger,
  });
  assert.equal(loaded.hasOwnerPasskey, true);
  assert.equal(loaded.listPasskeys('owner').length, 1);
  assert.equal(loaded.listPasskeys('owner')[0].label, '');
  loaded.noteSignCount(legacy.credentialId, legacy.signCount);
  const rewritten = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(rewritten.ownerPasskey, undefined);
  assert.equal(rewritten.passkeys.length, 1);
  assert.equal(rewritten.passkeys[0].credentialId, legacy.credentialId);
});

test('placeholder ids use the real credential length', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  await registerOwner(app, authenticator({ idBytes: 32 }));

  async function lengths(username) {
    const response = await call(app.baseUrl, '/api/auth/options', {
      method: 'POST',
      origin: app.origin,
      body: { username },
    });
    assert.equal(response.status, 200);
    const ids = (await response.json()).options.allowCredentials.map((item) => item.id);
    return ids.map((id) => Buffer.from(id, 'base64url').length);
  }

  assert.deepEqual(new Set(await lengths(USER)), new Set([32]));
  assert.deepEqual(new Set(await lengths('nobody')), new Set([32]));
});

async function joinMember(app, owner, name, idBytes) {
  const invite = await (
    await call(app.baseUrl, '/api/invites', { method: 'POST', token: owner.session.token, body: {} })
  ).json();
  const joinOptions = await (
    await call(app.baseUrl, '/api/join', {
      method: 'POST',
      origin: app.origin,
      body: { inviteId: invite.id, name },
    })
  ).json();
  const device = authenticator({ idBytes });
  const joined = await call(app.baseUrl, '/api/join/finish', {
    method: 'POST',
    origin: app.origin,
    body: {
      challengeId: joinOptions.challengeId,
      credential: device.register(Buffer.from(joinOptions.options.challenge, 'base64url'), app.origin),
    },
  });
  assert.equal(joined.status, 200);
  return { device, session: await joined.json() };
}

async function allowIds(app, username) {
  const response = await call(app.baseUrl, '/api/auth/options', {
    method: 'POST',
    origin: app.origin,
    body: { username },
  });
  assert.equal(response.status, 200);
  return (await response.json()).options.allowCredentials.map((item) => item.id);
}

function sortedLengths(ids) {
  return ids.map((id) => Buffer.from(id, 'base64url').length).sort((a, b) => a - b);
}

test('mixed credential lengths produce the same length distribution for known and unknown usernames', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const owner = await registerOwner(app, authenticator({ idBytes: 32 }));
  const { device: adaDevice } = await joinMember(app, owner, 'Ada', 64);

  const ownerIds = await allowIds(app, USER);
  const adaIds = await allowIds(app, 'Ada');
  const unknownIds = await allowIds(app, 'nobody');

  assert.equal(ownerIds.includes(owner.device.id), true);
  assert.equal(adaIds.includes(adaDevice.id), true);
  assert.deepEqual(sortedLengths(ownerIds), [32, 32, 32, 32, 64, 64, 64, 64]);
  assert.deepEqual(sortedLengths(adaIds), [32, 32, 32, 32, 64, 64, 64, 64]);
  assert.deepEqual(sortedLengths(unknownIds), [32, 32, 32, 32, 64, 64, 64, 64]);
  assert.deepEqual(await allowIds(app, USER), ownerIds);
  assert.deepEqual(await allowIds(app, 'Ada'), adaIds);
  assert.deepEqual(await allowIds(app, 'nobody'), unknownIds);

  const lengthSequences = new Set();
  for (let i = 0; i < 6; i += 1) {
    const ids = await allowIds(app, `nobody-${i}`);
    assert.deepEqual(sortedLengths(ids), [32, 32, 32, 32, 64, 64, 64, 64]);
    lengthSequences.add(ids.map((id) => Buffer.from(id, 'base64url').length).join(','));
  }
  assert.ok(lengthSequences.size > 1, 'slot order should vary across usernames');
});

test('a skewed passkey count keeps one length mix for every username', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const owner = await registerOwner(app, authenticator({ idBytes: 32 }));
  const ownerIds = [owner.device.id];
  for (let i = 0; i < 4; i += 1) {
    const extra = await addPasskey(app, owner.session.token, authenticator({ idBytes: 32 }));
    ownerIds.push(extra.device.id);
  }

  const { device: adaDevice, session: ada } = await joinMember(app, owner, 'Ada', 64);

  const balanced = [32, 32, 32, 32, 32, 64, 64, 64];

  const ownerList = await allowIds(app, USER);
  const adaList = await allowIds(app, 'Ada');
  const unknownList = await allowIds(app, 'nobody');
  for (const id of ownerIds) {
    assert.equal(ownerList.includes(id), true);
  }
  assert.equal(adaList.includes(adaDevice.id), true);
  assert.equal(unknownList.includes(owner.device.id), false);
  assert.deepEqual(sortedLengths(ownerList), balanced);
  assert.deepEqual(sortedLengths(adaList), balanced);
  assert.deepEqual(sortedLengths(unknownList), balanced);

  for (let i = 0; i < 4; i += 1) {
    await addPasskey(app, ada.token, authenticator({ idBytes: 64 }));
  }
  const wide = [32, 32, 32, 32, 32, 64, 64, 64, 64, 64];
  assert.deepEqual(sortedLengths(await allowIds(app, USER)), wide);
  assert.deepEqual(sortedLengths(await allowIds(app, 'Ada')), wide);
  assert.deepEqual(sortedLengths(await allowIds(app, 'nobody')), wide);
});

test('an account past the sign-in cap does not split the length mix of other names', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const owner = await registerOwner(app, authenticator({ idBytes: 32 }));
  const ownerIds = [owner.device.id];
  // Stored directly so the extra ids do not use up the passkey attempt limit.
  for (let i = 1; i < LOGIN_CREDENTIAL_SLOTS + 1; i += 1) {
    const credentialId = randomBytes(32).toString('base64url');
    app.conversation.addPasskey('owner', { credentialId, publicKey: 'test', signCount: 0 });
    ownerIds.push(credentialId);
  }
  assert.equal(ownerIds.length, LOGIN_CREDENTIAL_SLOTS + 1);

  const { device: adaDevice, session: ada } = await joinMember(app, owner, 'Ada', 64);
  const adaIds = [adaDevice.id];
  for (let i = 1; i < 6; i += 1) {
    const credentialId = randomBytes(64).toString('base64url');
    app.conversation.addPasskey(ada.you.id, { credentialId, publicKey: 'test', signCount: 0 });
    adaIds.push(credentialId);
  }

  const covered = [32, 32, 64, 64, 64, 64, 64, 64];

  const ownerList = await allowIds(app, USER);
  const adaList = await allowIds(app, 'Ada');
  const unknownList = await allowIds(app, 'nobody');
  assert.deepEqual(sortedLengths(ownerList), Array(LOGIN_CREDENTIAL_SLOTS + 1).fill(32));
  for (const id of ownerIds) {
    assert.equal(ownerList.includes(id), true);
  }
  for (const id of adaIds) {
    assert.equal(adaList.includes(id), true);
  }
  assert.equal(unknownList.includes(owner.device.id), false);
  assert.equal(unknownList.includes(adaDevice.id), false);
  assert.deepEqual(sortedLengths(adaList), covered);
  assert.deepEqual(sortedLengths(unknownList), covered);
  assert.deepEqual(await allowIds(app, 'Ada'), adaList);
  assert.deepEqual(await allowIds(app, 'nobody'), unknownList);
});

test('registration requires user verification and allows an extension suffix', async (t) => {
  const extension = Buffer.from('ext');
  const ok = await startServer();
  t.after(async () => {
    await ok.close();
  });
  const owner = await registerOwner(
    ok,
    authenticator({ flags: { attested: 0xc5, assert: 0x05 }, extension }),
  );
  assert.equal(owner.session.you.owner, true);

  const denied = await startServer();
  t.after(() => denied.close());
  const started = await call(denied.baseUrl, '/api/auth/password', {
    method: 'POST',
    origin: denied.origin,
    body: { username: USER, password: PASS },
  });
  assert.equal(started.status, 200);
  const options = await started.json();
  const noUv = authenticator({ flags: { attested: 0x41, assert: 0x01 } });
  const credential = noUv.register(Buffer.from(options.options.challenge, 'base64url'), denied.origin);
  const registered = await call(denied.baseUrl, '/api/auth/register', {
    method: 'POST',
    origin: denied.origin,
    body: { challengeId: options.challengeId, credential },
  });
  assert.equal(registered.status, 401);

  const trailing = await startServer();
  t.after(() => trailing.close());
  const startedTrailing = await call(trailing.baseUrl, '/api/auth/password', {
    method: 'POST',
    origin: trailing.origin,
    body: { username: USER, password: PASS },
  });
  const trailingOptions = await startedTrailing.json();
  const extra = authenticator({ extension });
  const extraCredential = extra.register(
    Buffer.from(trailingOptions.options.challenge, 'base64url'),
    trailing.origin,
  );
  const extraRegistered = await call(trailing.baseUrl, '/api/auth/register', {
    method: 'POST',
    origin: trailing.origin,
    body: { challengeId: trailingOptions.challengeId, credential: extraCredential },
  });
  assert.equal(extraRegistered.status, 401);
});

test('passkeyOrigin requires Origin to match the request Host', () => {
  assert.deepEqual(passkeyOrigin('https://boffin.example.com', 'boffin.example.com'), {
    origin: 'https://boffin.example.com',
    rpId: 'boffin.example.com',
  });
  assert.deepEqual(passkeyOrigin('https://boffin.example.com', 'boffin.example.com:443'), {
    origin: 'https://boffin.example.com',
    rpId: 'boffin.example.com',
  });
  assert.deepEqual(passkeyOrigin('https://boffin.example.com:8443', 'boffin.example.com:8443'), {
    origin: 'https://boffin.example.com:8443',
    rpId: 'boffin.example.com',
  });
  assert.deepEqual(passkeyOrigin('http://localhost:8080', 'localhost:8080'), {
    origin: 'http://localhost:8080',
    rpId: 'localhost',
  });
  assert.deepEqual(passkeyOrigin('http://localhost', 'localhost:80'), {
    origin: 'http://localhost',
    rpId: 'localhost',
  });
  assert.deepEqual(passkeyOrigin('https://BOFFIN.EXAMPLE.COM', 'boffin.example.com'), {
    origin: 'https://boffin.example.com',
    rpId: 'boffin.example.com',
  });

  for (const [origin, host] of [
    ['https://evil.example', 'boffin.example.com'],
    ['http://localhost:8080', 'boffin.example.com'],
    ['http://localhost:8080', '127.0.0.1:8080'],
    ['http://localhost:8080', 'localhost:9090'],
    ['https://boffin.example.com:8443', 'boffin.example.com'],
    ['https://boffin.example.com', 'boffin.example.com:80'],
    ['http://boffin.example.com', 'boffin.example.com'],
    ['https://boffin.example.com', ''],
    ['https://boffin.example.com', undefined],
    ['https://boffin.example.com/', 'boffin.example.com'],
    ['https://boffin.example.com/path', 'boffin.example.com'],
    ['https://user@boffin.example.com', 'boffin.example.com'],
    ['https://boffin.example.com', 'boffin.example.com:'],
    ['https://boffin.example.com', 'user@boffin.example.com'],
    ['https://boffin.example.com', 'boffin.example.com/path'],
    [' https://boffin.example.com', 'boffin.example.com'],
  ]) {
    assert.equal(passkeyOrigin(origin, host), null, `expected null for (${origin}, ${host})`);
  }
});

test('passkey ceremonies reject Origin headers that do not match Host', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const badBootstrap = await call(app.baseUrl, '/api/auth/password', {
    method: 'POST',
    host: 'boffin.example.com',
    origin: 'https://evil.example',
    body: { username: USER, password: PASS },
  });
  assert.equal(badBootstrap.status, 400);

  const badLocalhost = await call(app.baseUrl, '/api/auth/password', {
    method: 'POST',
    host: 'boffin.example.com',
    origin: app.origin,
    body: { username: USER, password: PASS },
  });
  assert.equal(badLocalhost.status, 400);

  const owner = await registerOwner(app);

  const badOptions = await call(app.baseUrl, '/api/auth/options', {
    method: 'POST',
    host: 'boffin.example.com',
    origin: 'https://evil.example',
    body: { username: USER },
  });
  assert.equal(badOptions.status, 400);

  const okOptions = await call(app.baseUrl, '/api/auth/options', {
    method: 'POST',
    host: 'boffin.example.com',
    origin: 'https://boffin.example.com',
    body: { username: USER },
  });
  assert.equal(okOptions.status, 200);
  assert.equal((await okOptions.json()).options.rpId, 'boffin.example.com');

  const badAdd = await call(app.baseUrl, '/api/passkeys', {
    method: 'POST',
    token: owner.session.token,
    host: 'boffin.example.com',
    origin: 'https://evil.example',
    body: { label: 'Laptop' },
  });
  assert.equal(badAdd.status, 400);

  const invite = await (
    await call(app.baseUrl, '/api/invites', { method: 'POST', token: owner.session.token, body: {} })
  ).json();
  const badJoin = await call(app.baseUrl, '/api/join', {
    method: 'POST',
    host: 'boffin.example.com',
    origin: 'https://evil.example',
    body: { inviteId: invite.id, name: 'Ada' },
  });
  assert.equal(badJoin.status, 400);
});

test('removed members cannot access usage or static-assets endpoints', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const owner = await registerOwner(app);
  const invite = await (
    await call(app.baseUrl, '/api/invites', { method: 'POST', token: owner.session.token, body: {} })
  ).json();
  const joinOptions = await (
    await call(app.baseUrl, '/api/join', {
      method: 'POST',
      origin: app.origin,
      body: { inviteId: invite.id, name: 'Ada' },
    })
  ).json();
  const guest = authenticator();
  const member = await (
    await call(app.baseUrl, '/api/join/finish', {
      method: 'POST',
      origin: app.origin,
      body: {
        challengeId: joinOptions.challengeId,
        credential: guest.register(Buffer.from(joinOptions.options.challenge, 'base64url'), app.origin),
      },
    })
  ).json();

  assert.equal((await call(app.baseUrl, '/api/usage', { token: member.token })).status, 200);
  assert.equal((await call(app.baseUrl, '/api/usage/refresh', { method: 'POST', token: member.token })).status, 404);
  assert.equal((await call(app.baseUrl, '/api/static-assets', { token: member.token })).status, 200);

  const removed = await call(app.baseUrl, `/api/members/${member.you.id}`, {
    method: 'DELETE',
    token: owner.session.token,
  });
  assert.equal(removed.status, 200);

  assert.equal((await call(app.baseUrl, '/api/usage', { token: member.token })).status, 403);
  assert.equal((await call(app.baseUrl, '/api/usage/refresh', { method: 'POST', token: member.token })).status, 403);
  assert.equal((await call(app.baseUrl, '/api/static-assets', { token: member.token })).status, 403);
});

test('active non-owner members can only read media from their active or kept conversations', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const owner = await registerOwner(app);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const prior = app.conversation.media.save({ bytes: png, name: 'prior.png' });
  const current = app.conversation.media.save({ bytes: png, name: 'current.png' });
  const keptMine = app.conversation.media.save({ bytes: png, name: 'kept.png' });

  // Prior conversation happened before Ada ever joined.
  app.conversation.items.push({ id: 'prior-1', role: 'user', text: 'secret', attachments: [prior] });
  app.conversation.reset();

  // Invite Ada into conversation 2, add an image, then start conversation 3 and re-add Ada.
  const invite = await (
    await call(app.baseUrl, '/api/invites', { method: 'POST', token: owner.session.token, body: {} })
  ).json();
  const joinOptions = await (
    await call(app.baseUrl, '/api/join', {
      method: 'POST',
      origin: app.origin,
      body: { inviteId: invite.id, name: 'Ada' },
    })
  ).json();
  const guest = authenticator();
  const member = await (
    await call(app.baseUrl, '/api/join/finish', {
      method: 'POST',
      origin: app.origin,
      body: {
        challengeId: joinOptions.challengeId,
        credential: guest.register(Buffer.from(joinOptions.options.challenge, 'base64url'), app.origin),
      },
    })
  ).json();

  app.conversation.items.push({ id: 'kept-1', role: 'user', text: 'shared', attachments: [keptMine] });
  app.conversation.reset();
  const readded = await call(app.baseUrl, `/api/members/${member.you.id}`, {
    method: 'POST',
    token: owner.session.token,
  });
  assert.equal(readded.status, 200);
  app.conversation.items.push({ id: 'current-1', role: 'user', text: 'now', attachments: [current] });

  assert.equal((await call(app.baseUrl, `/api/media/${prior.id}`, { token: owner.session.token })).status, 200);
  assert.equal((await call(app.baseUrl, `/api/media/${prior.id}`, { token: member.token })).status, 403);
  assert.equal((await call(app.baseUrl, `/api/media/${keptMine.id}`, { token: member.token })).status, 200);
  assert.equal((await call(app.baseUrl, `/api/media/${current.id}`, { token: member.token })).status, 200);
});

test('removing a passkey revokes every session signed in with it', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const owner = await registerOwner(app);
  const ownerInitial = await (await call(app.baseUrl, '/api/passkeys', { token: owner.session.token })).json();
  const firstId = ownerInitial.passkeys[0].id;
  const firstLogin = await signIn(app, owner.device);

  const extra = await addPasskey(app, owner.session.token, authenticator(), 'Backup');
  const secondId = extra.passkeys.find((entry) => entry.id !== firstId).id;
  const secondLogin = await signIn(app, extra.device);

  // Removing the first passkey from the second passkey's session revokes all sessions from the first.
  const removedFirst = await call(app.baseUrl, `/api/passkeys/${firstId}`, {
    method: 'DELETE',
    token: secondLogin.token,
  });
  assert.equal(removedFirst.status, 200);
  const removedFirstBody = await removedFirst.json();
  assert.equal(removedFirstBody.signedOut, false);
  assert.deepEqual(
    removedFirstBody.passkeys.map((entry) => entry.id),
    [secondId],
  );
  assert.equal((await call(app.baseUrl, '/api/session', { token: owner.session.token })).status, 401);
  assert.equal((await call(app.baseUrl, '/api/session', { token: firstLogin.token })).status, 401);
  assert.equal((await call(app.baseUrl, '/api/session', { token: secondLogin.token })).status, 200);

  // Failing to remove the last passkey leaves the active session intact.
  const refusedLast = await call(app.baseUrl, `/api/passkeys/${secondId}`, {
    method: 'DELETE',
    token: secondLogin.token,
  });
  assert.equal(refusedLast.status, 400);
  assert.equal((await call(app.baseUrl, '/api/session', { token: secondLogin.token })).status, 200);

  // Removing the passkey that signed in the current session reports signedOut and invalidates it.
  const third = await addPasskey(app, secondLogin.token, authenticator(), 'Phone');
  const thirdId = third.passkeys.find((entry) => entry.id !== secondId).id;
  const thirdLogin = await signIn(app, third.device);
  const removedSelf = await call(app.baseUrl, `/api/passkeys/${secondId}`, {
    method: 'DELETE',
    token: secondLogin.token,
  });
  assert.equal(removedSelf.status, 200);
  const removedSelfBody = await removedSelf.json();
  assert.equal(removedSelfBody.signedOut, true);
  assert.deepEqual(
    removedSelfBody.passkeys.map((entry) => entry.id),
    [thirdId],
  );
  assert.equal((await call(app.baseUrl, '/api/session', { token: secondLogin.token })).status, 401);
  assert.equal((await call(app.baseUrl, '/api/session', { token: thirdLogin.token })).status, 200);

  // Invited member's join session is also bound to their join passkey.
  const invite = await (
    await call(app.baseUrl, '/api/invites', { method: 'POST', token: thirdLogin.token, body: {} })
  ).json();
  const joinOptions = await (
    await call(app.baseUrl, '/api/join', {
      method: 'POST',
      origin: app.origin,
      body: { inviteId: invite.id, name: 'Ada' },
    })
  ).json();
  const adaFirst = authenticator();
  const adaJoin = await (
    await call(app.baseUrl, '/api/join/finish', {
      method: 'POST',
      origin: app.origin,
      body: {
        challengeId: joinOptions.challengeId,
        credential: adaFirst.register(Buffer.from(joinOptions.options.challenge, 'base64url'), app.origin),
      },
    })
  ).json();
  const adaInitial = await (await call(app.baseUrl, '/api/passkeys', { token: adaJoin.token })).json();
  const adaFirstId = adaInitial.passkeys[0].id;
  const adaSecond = await addPasskey(app, adaJoin.token, authenticator(), 'Ada backup');
  const adaSecondLogin = await signIn(app, adaSecond.device, 'Ada');

  const removedAdaFirst = await call(app.baseUrl, `/api/passkeys/${adaFirstId}`, {
    method: 'DELETE',
    token: adaSecondLogin.token,
  });
  assert.equal(removedAdaFirst.status, 200);
  assert.equal((await removedAdaFirst.json()).signedOut, false);
  assert.equal((await call(app.baseUrl, '/api/session', { token: adaJoin.token })).status, 401);
  assert.equal((await call(app.baseUrl, '/api/session', { token: adaSecondLogin.token })).status, 200);
  assert.equal((await call(app.baseUrl, '/api/session', { token: thirdLogin.token })).status, 200);
});

test('a second pending owner bootstrap challenge cannot register after enrollment', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const firstStart = await call(app.baseUrl, '/api/auth/password', {
    method: 'POST',
    origin: app.origin,
    body: { username: USER, password: PASS },
  });
  const secondStart = await call(app.baseUrl, '/api/auth/password', {
    method: 'POST',
    origin: app.origin,
    body: { username: USER, password: PASS },
  });
  assert.equal(firstStart.status, 200);
  assert.equal(secondStart.status, 200);
  const firstOptions = await firstStart.json();
  const secondOptions = await secondStart.json();

  const firstDevice = authenticator();
  const firstReg = await call(app.baseUrl, '/api/auth/register', {
    method: 'POST',
    origin: app.origin,
    body: {
      challengeId: firstOptions.challengeId,
      credential: firstDevice.register(Buffer.from(firstOptions.options.challenge, 'base64url'), app.origin),
    },
  });
  assert.equal(firstReg.status, 200);
  const owner = await firstReg.json();

  const secondDevice = authenticator();
  const secondReg = await call(app.baseUrl, '/api/auth/register', {
    method: 'POST',
    origin: app.origin,
    body: {
      challengeId: secondOptions.challengeId,
      credential: secondDevice.register(Buffer.from(secondOptions.options.challenge, 'base64url'), app.origin),
    },
  });
  assert.equal(secondReg.status, 401);
  assert.equal((await secondReg.json()).error, 'The password is no longer used.');

  const listed = await (await call(app.baseUrl, '/api/passkeys', { token: owner.token })).json();
  assert.equal(listed.passkeys.length, 1);

  assert.throws(
    () =>
      app.conversation.setOwnerPasskey({
        credentialId: 'extra-owner-credential',
        publicKey: { alg: -7, jwk: {} },
        signCount: 0,
      }),
    { status: 401, message: 'The password is no longer used.' },
  );
});

test('server starts without a password after owner enrollment and refuses to start without either', async (t) => {
  const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-nopass-'));
  const freshConversation = new Conversation({
    model: 'composer-2.5',
    workdir: freshDir,
    agentBin: FAKE_AGENT,
    force: true,
    stateFile: path.join(freshDir, 'state', 'state.json'),
    runAgent: (options) => runAgent({ ...options, logger: quietLogger }),
    logger: quietLogger,
  });
  assert.throws(
    () => createServer({ conversation: freshConversation, username: USER, password: null, logger: quietLogger }),
    ConfigError,
  );
  assert.throws(
    () => createServer({ conversation: freshConversation, username: USER, password: '', logger: quietLogger }),
    ConfigError,
  );

  fs.writeFileSync(
    path.join(freshDir, 'config.json'),
    JSON.stringify({ model: 'composer-2.5', username: USER }),
  );
  const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));
  const cli = spawnSync(process.execPath, [entry, freshDir], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /A password is required/);

  const app = await startServer();
  const owner = await registerOwner(app);
  await app.close();

  const restarted = await startServer(app.dir, { password: null });
  t.after(() => restarted.close());

  const session = await signIn(restarted, owner.device);
  assert.equal((await call(restarted.baseUrl, '/api/session', { token: session.token })).status, 200);

  const pwAttempt = await call(restarted.baseUrl, '/api/auth/password', {
    method: 'POST',
    origin: restarted.origin,
    body: { username: USER, password: 'null' },
  });
  assert.equal(pwAttempt.status, 401);
  assert.equal((await pwAttempt.json()).error, 'The password is no longer used.');

  const basicAttempt = await call(restarted.baseUrl, '/api/session', {
    headers: { Authorization: `Basic ${Buffer.from(`${USER}:null`).toString('base64')}` },
  });
  assert.equal(basicAttempt.status, 401);
});

test('invites expire after 30 days and are pruned', async (t) => {
  const app = await startServer();
  const owner = await registerOwner(app);
  const created = await (
    await call(app.baseUrl, '/api/invites', { method: 'POST', token: owner.session.token, body: {} })
  ).json();
  await app.close();

  const stateFile = path.join(app.dir, 'state', 'state.json');
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  saved.invites[0].createdAt = new Date(Date.now() - INVITE_TTL_MS - 1000).toISOString();
  fs.writeFileSync(stateFile, JSON.stringify(saved));

  const restarted = await startServer(app.dir, { password: null });
  t.after(() => restarted.close());

  const status = await call(restarted.baseUrl, '/api/auth/status', {
    method: 'POST',
    body: { join: created.id },
  });
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { started: true, invite: null });

  const joinAttempt = await call(restarted.baseUrl, '/api/join', {
    method: 'POST',
    origin: restarted.origin,
    body: { inviteId: created.id, name: 'Ada' },
  });
  assert.equal(joinAttempt.status, 404);

  const session = await signIn(restarted, owner.device);
  const current = await (await call(restarted.baseUrl, '/api/session', { token: session.token })).json();
  assert.deepEqual(current.invites, []);

  const cancelExpired = await call(restarted.baseUrl, `/api/invites/${created.id}`, {
    method: 'DELETE',
    token: session.token,
  });
  assert.equal(cancelExpired.status, 404);

  const fresh = await (
    await call(restarted.baseUrl, '/api/invites', { method: 'POST', token: session.token, body: {} })
  ).json();
  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.deepEqual(
    persisted.invites.map((item) => item.id),
    [fresh.id],
  );
});
