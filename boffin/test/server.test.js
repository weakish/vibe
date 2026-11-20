import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Conversation } from '../src/conversation.js';
import { runAgent } from '../src/agent.js';
import { DEFAULT_SPEC, MAX_SPEC_CHARS } from '../shared/default-spec.js';
import { PASSKEY_ATTEMPT_LIMIT, PASSWORD_ATTEMPT_LIMIT, STATUS_ATTEMPT_LIMIT } from '../src/attempt-limit.js';
import { entityTag, httpDate } from '../src/http-encode.js';
import {
  MAX_BODY_BYTES,
  MAX_MESSAGE_CHARS,
  SHOPPING_BODY_BYTES,
  SMALL_BODY_BYTES,
  SPEC_BODY_BYTES,
  createServer,
} from '../src/server.js';
import { UPDATE_NOT_FAST_FORWARD, UpdateError } from '../src/repo-update.js';

const FAKE_AGENT = fileURLToPath(new URL('../fixtures/fake-agent.js', import.meta.url));
const USER = 'tester';
const PASS = 'test-password-1234';
const quietLogger = { log() {}, error() {} };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function basicHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

async function startServer({ username = USER, password = PASS, beforeStart, conversation: conversationFields, ...serverFields } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-http-'));
  beforeStart?.(dir);
  const logFile = path.join(dir, 'calls.jsonl');
  const conversation = new Conversation({
    model: 'composer-2.5',
    workdir: dir,
    agentBin: FAKE_AGENT,
    force: true,
    stateFile: path.join(dir, 'state', 'state.json'),
    runAgent: (options) => runAgent({ ...options, env: { ...process.env, FAKE_AGENT_LOG: logFile }, logger: quietLogger }),
    logger: quietLogger,
    ...conversationFields,
  });
  const server = createServer({ conversation, username, password, logger: quietLogger, ...serverFields });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    conversation,
    calls: () => readCalls(logFile),
    close: async () => {
      await conversation.stop();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function readCalls(logFile) {
  if (!fs.existsSync(logFile)) {
    return [];
  }
  return fs
    .readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

function api(baseUrl, route, { method = 'GET', body, credentials = { username: USER, password: PASS }, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (credentials !== null) {
    requestHeaders.Authorization = basicHeader(credentials.username, credentials.password);
  }
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// Sends the path exactly as written, because fetch() normalises dot segments first.
function rawStatus(baseUrl, requestPath) {
  return rawRequest(baseUrl, requestPath).then((response) => response.status);
}

function rawRequest(baseUrl, requestPath, { method = 'GET', headers = {}, body } = {}) {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname, port, path: requestPath, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function sendMessage(baseUrl, text, attachments) {
  const body = attachments ? { text, attachments } : { text };
  const response = await api(baseUrl, '/api/messages', { method: 'POST', body });
  const raw = await response.text();
  const ops = raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  return { status: response.status, ops };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('requires username and password for every API call', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  assert.equal((await api(app.baseUrl, '/api/session', { credentials: null })).status, 401);
  assert.equal((await api(app.baseUrl, '/api/session', { credentials: { username: USER, password: 'wrong-password' } })).status, 401);
  assert.equal((await api(app.baseUrl, '/api/session', { credentials: { username: 'other', password: PASS } })).status, 401);
  assert.equal(
    (await api(app.baseUrl, '/api/session', { credentials: null, headers: { Authorization: 'Bearer leftover' } })).status,
    401,
  );
  assert.equal((await api(app.baseUrl, '/api/session')).status, 200);
  assert.equal((await api(app.baseUrl, '/api/session', { method: 'DELETE' })).status, 401);
});

test('accepts a password that contains a colon', async (t) => {
  const password = 'pre:mid:end';
  const app = await startServer({ password });
  t.after(() => app.close());

  assert.equal((await api(app.baseUrl, '/api/session', { credentials: { username: USER, password } })).status, 200);
});

test('returns the fixed model, project name, and transcript', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await api(app.baseUrl, '/api/session');
  const session = await response.json();
  assert.equal(session.model, 'composer-2.5');
  assert.equal(session.agent, 'cursor');
  assert.equal(session.agents[0].id, 'cursor');
  assert.equal(session.project, path.basename(app.conversation.workdir));
  assert.equal(session.busy, false);
  assert.deepEqual(session.items, []);
});

test('streams a reply as NDJSON and records it in the session', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const { status, ops } = await sendMessage(app.baseUrl, 'hello');
  assert.equal(status, 200);
  assert.deepEqual(ops[0], { op: 'add', item: ops[0].item });
  assert.equal(ops[0].item.role, 'user');
  assert.equal(ops[0].item.text, 'hello');

  const session = await (await api(app.baseUrl, '/api/session')).json();
  assert.equal(session.items[0].role, 'user');
  assert.equal(session.items[0].text, 'hello');
  assert.equal(session.items[1].role, 'assistant');
  assert.match(session.items[1].text, /^Echo: tester: hello\n\nShopping list:/);
});

test('uses the saved chat id for follow-up messages', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await sendMessage(app.baseUrl, 'first');
  const chatId = app.conversation.chatId;
  assert.ok(chatId);
  await sendMessage(app.baseUrl, 'second');

  const [first, second] = app.calls();
  assert.ok(!first.argv.includes('--resume'));
  assert.equal(second.argv[second.argv.indexOf('--resume') + 1], chatId);
  assert.match(second.prompt, /^tester: second\n\nShopping list:/);
  assert.equal(second.argv.includes('--force'), true);
});

test('tells the transcript when the agent emits a malformed line', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const { status, ops } = await sendMessage(app.baseUrl, 'GARBAGE please');
  const notices = ops.filter((op) => op.item?.role === 'notice');
  assert.equal(status, 200);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].item.level, 'error');
  assert.ok(ops.some((op) => op.item?.role === 'assistant'));
});

test('surfaces CLI crashes and error results to the transcript', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const crash = await sendMessage(app.baseUrl, 'CRASH now');
  const crashNotice = crash.ops.find((op) => op.item?.role === 'notice');
  assert.equal(crashNotice.item.level, 'error');
  assert.match(crashNotice.item.text, /exit code 2\): Error: connection reset/);

  const rejected = await sendMessage(app.baseUrl, 'ERROR please');
  const rejectedNotice = rejected.ops.find((op) => op.item?.role === 'notice');
  assert.equal(rejectedNotice.item.text, 'Model rejected the request.');
});

test('returns 409 while a run is active and can stop it', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const running = sendMessage(app.baseUrl, 'SLOW task');
  await waitFor(() => app.conversation.busy);

  assert.equal((await api(app.baseUrl, '/api/messages', { method: 'POST', body: { text: 'again' } })).status, 409);
  assert.equal((await api(app.baseUrl, '/api/new', { method: 'POST' })).status, 409);

  const stop = await (await api(app.baseUrl, '/api/cancel', { method: 'POST' })).json();
  assert.deepEqual(stop, { stopping: true });

  const { ops } = await running;
  assert.equal(ops.at(-1).item.text, 'Stopped.');
  assert.equal(app.conversation.busy, false);
});

test('keeps the agent running when the browser disconnects mid-stream', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await api(app.baseUrl, '/api/messages', { method: 'POST', body: { text: 'STREAM please' } });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();

  await waitFor(() => !app.conversation.busy);
  assert.equal(app.conversation.items.at(-1).text, 'Hello world');
});

test('clears the transcript and starts a fresh chat on reset', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await sendMessage(app.baseUrl, 'before reset');
  assert.equal((await api(app.baseUrl, '/api/new', { method: 'POST' })).status, 200);
  assert.deepEqual((await (await api(app.baseUrl, '/api/session')).json()).items, []);

  await sendMessage(app.baseUrl, 'after reset');
  const calls = app.calls();
  assert.ok(!calls.at(-1).argv.includes('--resume'));
});

test('lets the owner pick a first-party model when starting a new chat', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const ok = await api(app.baseUrl, '/api/new', {
    method: 'POST',
    body: { agent: 'cursor', model: 'composer-2.5' },
  });
  assert.equal(ok.status, 200);

  const bad = await api(app.baseUrl, '/api/new', {
    method: 'POST',
    body: { agent: 'grok', model: 'grok-4.7/high' },
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'That agent is not available.');
});

test('offers Pi and accepts its model when starting a new chat', async (t) => {
  const app = await startServer({
    conversation: { agents: ['cursor', 'pi'], piBin: FAKE_AGENT },
  });
  t.after(() => app.close());

  const session = await (await api(app.baseUrl, '/api/session')).json();
  assert.deepEqual(
    session.agents.map((entry) => entry.id),
    ['cursor', 'pi'],
  );
  const pi = session.agents[1];
  assert.equal(pi.defaultModel, 'default');
  assert.ok(pi.models.some((entry) => entry.id === 'default'));

  const ok = await api(app.baseUrl, '/api/new', {
    method: 'POST',
    body: { agent: 'pi', model: 'openai/gpt-5.6:high' },
  });
  assert.equal(ok.status, 200);
  assert.equal(app.conversation.agent, 'pi');
  assert.equal(app.conversation.model, 'openai/gpt-5.6:high');

  const bad = await api(app.baseUrl, '/api/new', {
    method: 'POST',
    body: { agent: 'pi', model: 'not-a-model' },
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'That model is not available.');

  const withThinking = await api(app.baseUrl, '/api/new', {
    method: 'POST',
    body: { agent: 'pi', model: 'opencode-go/beam-free', thinking: 'HIGH' },
  });
  assert.equal(withThinking.status, 200);
  assert.equal(app.conversation.model, 'opencode-go/beam-free');
  assert.equal(app.conversation.thinking, 'high');

  const updatedSession = await (await api(app.baseUrl, '/api/session')).json();
  assert.equal(updatedSession.model, 'opencode-go/beam-free');
  assert.equal(updatedSession.thinking, 'high');

  const emptyDefaults = await api(app.baseUrl, '/api/new', {
    method: 'POST',
    body: { agent: 'pi', model: '', thinking: '' },
  });
  assert.equal(emptyDefaults.status, 200);
  assert.equal(app.conversation.model, 'default');
  assert.equal(app.conversation.thinking, null);

  const badThinking = await api(app.baseUrl, '/api/new', {
    method: 'POST',
    body: { agent: 'pi', model: 'default', thinking: 'extreme' },
  });
  assert.equal(badThinking.status, 400);
  assert.equal((await badThinking.json()).error, 'That thinking effort is not available.');
});

test('returns 500 when a new chat cannot be saved', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await sendMessage(app.baseUrl, 'keep me');
  fs.rmSync(path.dirname(app.conversation.stateFile), { recursive: true });
  fs.writeFileSync(path.dirname(app.conversation.stateFile), 'not-a-directory');

  const response = await api(app.baseUrl, '/api/new', { method: 'POST' });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /could not be saved/);
  assert.equal(app.conversation.items[0].text, 'keep me');
});

test('validates message payloads', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const invalidJson = await api(app.baseUrl, '/api/messages', { method: 'POST', body: '{nope' });
  assert.equal(invalidJson.status, 400);

  const empty = await api(app.baseUrl, '/api/messages', { method: 'POST', body: { text: '   ' } });
  assert.equal(empty.status, 400);

  const tooLong = await api(app.baseUrl, '/api/messages', {
    method: 'POST',
    body: { text: 'x'.repeat(40 * 1024) },
  });
  assert.equal(tooLong.status, 413);
  assert.match((await tooLong.json()).error, /limited to/);
});

test('accepts a message whose JSON encoding is larger than 64 KiB', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const text = '\u0001'.repeat(12_000);
  assert.ok(text.length <= MAX_MESSAGE_CHARS);
  assert.ok(Buffer.byteLength(JSON.stringify({ text })) > 64 * 1024);

  const { status, ops } = await sendMessage(app.baseUrl, text);
  assert.equal(status, 200);
  assert.equal(ops[0].item.text, text);
});

test('returns JSON when the body exceeds the byte cap', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await api(app.baseUrl, '/api/messages', {
    method: 'POST',
    body: 'x'.repeat(MAX_BODY_BYTES + 1),
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /too large/);
});

test('non-attachment endpoints enforce smaller body byte caps', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const cases = [
    ['POST', '/api/new', SMALL_BODY_BYTES],
    ['PUT', '/api/static-assets', SMALL_BODY_BYTES],
    ['PUT', '/api/spec', SPEC_BODY_BYTES],
    ['PUT', '/api/shopping', SHOPPING_BODY_BYTES],
  ];
  for (const [method, route, limit] of cases) {
    assert.ok(limit < MAX_BODY_BYTES, `${route} limit should stay well below MAX_BODY_BYTES`);
    const response = await api(app.baseUrl, route, {
      method,
      body: 'x'.repeat(limit + 1),
    });
    assert.equal(response.status, 413, `${method} ${route} should reject bodies past ${limit} bytes`);
    assert.match((await response.json()).error, /too large/);
  }
});

test('serves the built-in spec and keeps edits beside the state file', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const anon = await api(app.baseUrl, '/api/spec', { credentials: null });
  assert.equal(anon.status, 401);
  assert.equal((await api(app.baseUrl, '/api/spec', { method: 'PUT', credentials: null, body: { text: 'no' } })).status, 401);

  const first = await api(app.baseUrl, '/api/spec');
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { text: DEFAULT_SPEC, canEdit: true });
  assert.equal(fs.existsSync(path.join(path.dirname(app.conversation.stateFile), 'spec.md')), false);

  const saved = await api(app.baseUrl, '/api/spec', { method: 'PUT', body: { text: '# House rules\n\nBe brief.\n' } });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).text, '# House rules\n\nBe brief.\n');
  assert.equal((await (await api(app.baseUrl, '/api/spec')).json()).text, '# House rules\n\nBe brief.\n');

  const cleared = await api(app.baseUrl, '/api/spec', { method: 'PUT', body: { text: '' } });
  assert.equal(cleared.status, 200);
  assert.equal((await (await api(app.baseUrl, '/api/spec')).json()).text, '');

  assert.equal((await api(app.baseUrl, '/api/spec', { method: 'PUT', body: { text: 12 } })).status, 400);
  const tooLong = await api(app.baseUrl, '/api/spec', { method: 'PUT', body: { text: 'x'.repeat(MAX_SPEC_CHARS + 1) } });
  assert.equal(tooLong.status, 413);
  assert.match((await tooLong.json()).error, /limited to/);
  assert.equal((await (await api(app.baseUrl, '/api/spec')).json()).text, '');
});

test('serves the shopping list and lets the agent find its file path', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const anon = await api(app.baseUrl, '/api/shopping', { credentials: null });
  assert.equal(anon.status, 401);
  assert.equal((await api(app.baseUrl, '/api/shopping', { method: 'PUT', credentials: null, body: { items: [] } })).status, 401);

  const first = await api(app.baseUrl, '/api/shopping');
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { version: 1, items: [] });
  assert.equal(fs.existsSync(path.join(path.dirname(app.conversation.stateFile), 'shopping-list.json')), false);

  const saved = await api(app.baseUrl, '/api/shopping', {
    method: 'PUT',
    body: { items: [{ name: 'Milk', wantedBy: 'Ada', bought: false }] },
  });
  assert.equal(saved.status, 200);
  const body = await saved.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].name, 'Milk');
  assert.match(body.items[0].id, /^[0-9a-f-]{36}$/);
  assert.equal((await (await api(app.baseUrl, '/api/shopping')).json()).items[0].name, 'Milk');

  const bought = await api(app.baseUrl, '/api/shopping', {
    method: 'PUT',
    body: { items: [{ ...body.items[0], bought: true, boughtBy: 'Ken' }] },
  });
  assert.equal((await bought.json()).items[0].bought, true);

  assert.equal((await api(app.baseUrl, '/api/shopping', { method: 'PUT', body: { items: [{ name: '', bought: false }] } })).status, 400);
  assert.equal((await (await api(app.baseUrl, '/api/shopping', { method: 'PUT', body: { items: [{ name: '', bought: false }] } })).json()).error, 'The shopping list is not valid.');

  const { status } = await sendMessage(app.baseUrl, 'We need milk');
  assert.equal(status, 200);
  const [call] = app.calls();
  assert.match(call.prompt, /We need milk/);
  assert.match(call.prompt, /state\/shopping-list\.json/);
  assert.match(call.prompt, /already bought/);
});

test('returns 404 for unknown API routes', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  assert.equal((await api(app.baseUrl, '/api/unknown')).status, 404);
});

test('serves the web app without requiring credentials', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await api(app.baseUrl, '/', { credentials: null });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
  assert.match(response.headers.get('content-security-policy'), /img-src 'self' data: blob:/);
  const html = await response.text();
  assert.doesNotMatch(html, /theme-init\.js/);
  assert.match(html, /<script>\s*try \{/);
  const themeInit = html.match(/<script>([^]*?)<\/script>/)[1];
  const themeInitHash = `'sha256-${createHash('sha256').update(themeInit).digest('base64')}'`;
  assert.ok(response.headers.get('content-security-policy').includes(themeInitHash));
  assert.doesNotMatch(html, /id="app"/);
  assert.doesNotMatch(html, /id="new-chat"/);
  assert.doesNotMatch(html, /id="demo-input"/);
  assert.match(html, /<script type="module" src="\/landing\.js"><\/script>/);
  assert.doesNotMatch(html, /src="\/app\.js"/);
  assert.match(html, /<div class="landing" id="landing">/);
  assert.match(html, /id="landing-signin" disabled/);
  assert.match(html, /id="landing-demo"/);
  assert.match(html, /id="demo-play"/);
  assert.match(html, /id="landing-demo"[^>]*>\s*<button type="button" class="demo-play"/);
  assert.match(html, /id="previous-people"/);
  assert.match(html, /id="passkey-warning-dialog"[^>]*aria-describedby="passkey-warning-text"/);
  assert.match(html, /id="passkey-warning-continue"/);
  assert.doesNotMatch(html, /id="subtitle"/);
  assert.doesNotMatch(html, /id="demo-subtitle"/);
  assert.doesNotMatch(html, /landing-features/);

  const spec = await api(app.baseUrl, '/spec', { credentials: null });
  const specHtml = await spec.text();
  assert.doesNotMatch(specHtml, /theme-init\.js/);
  assert.equal(specHtml.match(/<script>([^]*?)<\/script>/)[1], themeInit);
  assert.ok(spec.headers.get('content-security-policy').includes(themeInitHash));

  const appShell = await (await api(app.baseUrl, '/app-shell.html', { credentials: null })).text();
  assert.match(appShell, /<div class="app" id="app" inert>/);
  assert.match(appShell, /<button type="button" class="menu-action" id="log-out">/);
  assert.match(appShell, /id="passkey-label"/);
  assert.match(appShell, /id="new-chat"/);
  assert.match(appShell, /id="conversation-switch" hidden/);
  assert.match(appShell, /id="view-open"/);
  assert.match(appShell, /id="view-panel"/);
  assert.match(appShell, /id="view-chat"/);
  assert.match(appShell, /id="view-shopping"/);
  assert.match(appShell, /id="view-files"/);
  assert.match(appShell, /id="view-overview"/);
  assert.match(appShell, /id="shopping"/);
  assert.doesNotMatch(appShell, /id="shopping-add-form"/);
  assert.match(appShell, /id="files-view"/);
  assert.match(appShell, /id="overview-view"/);

  const demoShell = await (await api(app.baseUrl, '/demo-shell.html', { credentials: null })).text();
  assert.match(demoShell, /id="demo-input"/);
  assert.doesNotMatch(demoShell, /id="demo-input"[^>]*disabled/);
  assert.match(demoShell, /id="demo-send" disabled/);
  assert.match(demoShell, /id="demo-members"/);
  assert.match(demoShell, /<button type="button" class="menu-action" id="demo-passkeys">/);
  assert.match(demoShell, /id="demo-passkeys-dialog"[^>]*aria-describedby="demo-passkeys-body"/);
  assert.match(demoShell, /id="demo-passkeys-body"/);
  assert.doesNotMatch(demoShell, /id="demo-attach"[^>]*disabled/);
  assert.match(demoShell, /id="demo-attach-dialog"[^>]*aria-describedby="demo-attach-body"/);
  assert.match(demoShell, /id="demo-invite-dialog"[^>]*aria-describedby="demo-invite-body"/);
  assert.match(demoShell, /id="demo-log-out-dialog"[^>]*aria-describedby="demo-log-out-body"/);
  assert.match(demoShell, /<button type="button" class="menu-action" id="demo-spec">/);
  assert.match(demoShell, /id="demo-spec-edit" hidden/);
  assert.match(demoShell, /id="demo-spec-view" hidden/);
  assert.doesNotMatch(demoShell, /id="demo-spec" href="\/spec"/);
});

test('serves front-end assets with the right content types', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const expected = [
    ['/app.js', /^text\/javascript/],
    ['/landing.js', /^text\/javascript/],
    ['/chrome.js', /^text\/javascript/],
    ['/join-link.js', /^text\/javascript/],
    ['/markdown.js', /^text\/javascript/],
    ['/stream.js', /^text\/javascript/],
    ['/i18n.js', /^text\/javascript/],
    ['/locales/en.js', /^text\/javascript/],
    ['/locales/ja.js', /^text\/javascript/],
    ['/locales/ms.js', /^text\/javascript/],
    ['/locales/kxd.js', /^text\/javascript/],
    ['/locales/ms-BN-Arab.js', /^text\/javascript/],
    ['/locales/id.js', /^text\/javascript/],
    ['/locales/ta.js', /^text\/javascript/],
    ['/locales/yue.js', /^text\/javascript/],
    ['/locales/zh-Hans.js', /^text\/javascript/],
    ['/locales/nan-Latn.js', /^text\/javascript/],
    ['/flags.js', /^text\/javascript/],
    ['/theme.js', /^text\/javascript/],
    ['/member-color.js', /^text\/javascript/],
    ['/passkey.js', /^text\/javascript/],
    ['/shared/transcript.js', /^text\/javascript/],
    ['/shared/export.js', /^text\/javascript/],
    ['/shared/limits.js', /^text\/javascript/],
    ['/app-shell.html', /^text\/html/],
    ['/demo-shell.html', /^text\/html/],
    ['/styles.css', /^text\/css/],
    ['/manifest.webmanifest', /^application\/manifest\+json/],
    ['/icon.svg', /^image\/svg\+xml/],
    ['/spec', /^text\/html/],
    ['/spec.js', /^text\/javascript/],
  ];
  for (const [route, contentType] of expected) {
    const response = await api(app.baseUrl, route, { credentials: null });
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), contentType, route);
    assert.ok((await response.text()).length > 0, route);
  }
});

test('answers HEAD for assets without sending a body', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/app.js`, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.ok(Number(response.headers.get('content-length')) > 0);
  assert.equal(await response.text(), '');
});

test('revalidates static files with ETag and Last-Modified', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const file = new URL('../public/app.js', import.meta.url);
  const body = fs.readFileSync(file);
  const mtime = fs.statSync(file).mtime;
  const etag = entityTag(body);

  const fresh = await rawRequest(app.baseUrl, '/app.js', { headers: { 'accept-encoding': 'gzip, deflate, br' } });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers.etag, etag);
  assert.equal(fresh.headers['last-modified'], httpDate(mtime));
  assert.equal(fresh.headers['cache-control'], 'no-cache');
  assert.equal(fresh.headers['content-encoding'], undefined);
  assert.equal(fresh.headers.vary, undefined);
  assert.equal(Number(fresh.headers['content-length']), body.length);
  assert.equal(fresh.body.equals(body), true);

  const matched = await rawRequest(app.baseUrl, '/app.js', {
    headers: { 'accept-encoding': 'gzip', 'if-none-match': etag },
  });
  assert.equal(matched.status, 304);
  assert.equal(matched.headers.etag, etag);
  assert.equal(matched.headers['cache-control'], 'no-cache');
  assert.equal(matched.headers['content-encoding'], undefined);
  assert.equal(matched.headers['content-length'], undefined);
  assert.equal(matched.body.length, 0);

  const stale = await rawRequest(app.baseUrl, '/app.js', {
    headers: { 'if-none-match': '"deadbeef"' },
  });
  assert.equal(stale.status, 200);
  assert.equal(stale.body.equals(body), true);

  const unmodified = await rawRequest(app.baseUrl, '/app.js', {
    headers: { 'if-modified-since': httpDate(mtime) },
  });
  assert.equal(unmodified.status, 304);

  const older = await rawRequest(app.baseUrl, '/app.js', {
    headers: {
      'if-modified-since': httpDate(new Date(mtime.getTime() - 2000)),
    },
  });
  assert.equal(older.status, 200);

  const head = await rawRequest(app.baseUrl, '/app.js', {
    method: 'HEAD',
    headers: { 'accept-encoding': 'gzip' },
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.etag, etag);
  assert.equal(head.headers['content-encoding'], undefined);
  assert.equal(Number(head.headers['content-length']), body.length);
  assert.equal(head.body.length, 0);

  const headMatched = await rawRequest(app.baseUrl, '/app.js', {
    method: 'HEAD',
    headers: { 'if-none-match': etag },
  });
  assert.equal(headMatched.status, 304);
  assert.equal(headMatched.headers.etag, etag);
  assert.equal(headMatched.headers['last-modified'], httpDate(mtime));
  assert.equal(headMatched.body.length, 0);

  const spec = await rawRequest(app.baseUrl, '/api/spec', {
    headers: {
      authorization: basicHeader(USER, PASS),
      'accept-encoding': 'gzip, br',
    },
  });
  assert.equal(spec.status, 200);
  assert.equal(spec.headers['content-encoding'], undefined);
  assert.equal(spec.headers['cache-control'], 'no-store');
  assert.equal(spec.headers.etag, undefined);
  assert.equal(JSON.parse(spec.body.toString('utf8')).text, DEFAULT_SPEC);
});

test('does not compress media or streamed replies', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const { ops } = await sendMessage(app.baseUrl, 'look', [
    { name: 'shot.png', data: PNG.toString('base64') },
  ]);
  const media = await rawRequest(app.baseUrl, `/api/media/${ops[0].item.attachments[0].id}`, {
    headers: {
      authorization: basicHeader(USER, PASS),
      'accept-encoding': 'gzip, br',
    },
  });
  assert.equal(media.status, 200);
  assert.equal(media.headers['content-encoding'], undefined);
  assert.equal(media.body.equals(PNG), true);

  const stream = await rawRequest(app.baseUrl, '/api/messages', {
    method: 'POST',
    headers: {
      authorization: basicHeader(USER, PASS),
      'content-type': 'application/json',
      'accept-encoding': 'gzip, br',
    },
    body: JSON.stringify({ text: 'hello again' }),
  });
  assert.equal(stream.status, 200);
  assert.equal(stream.headers['content-type'], 'application/x-ndjson; charset=utf-8');
  assert.equal(stream.headers['content-encoding'], undefined);
  const lines = stream.body
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim());
  assert.equal(JSON.parse(lines[0]).item.text, 'hello again');
});

test('serves only the allowlisted files', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const blocked = [
    '/package.json',
    '/src/server.js',
    '/app.js/',
    '/shared/transcript.js/',
    '/shared/../package.json',
    '/public/../package.json',
    '/%2e%2e/package.json',
    '/..%2fpackage.json',
    '/app.js%00.html',
    '/locales/nope.js',
    '/locales/',
    '/theme-init.js',
  ];
  for (const requestPath of blocked) {
    assert.equal(await rawStatus(app.baseUrl, requestPath), 404, requestPath);
  }
  assert.equal((await api(app.baseUrl, '/app.js', { method: 'POST', credentials: null })).status, 404);
});

test('accepts attached files and serves image previews only to a signed-in client', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const { status, ops } = await sendMessage(app.baseUrl, 'look', [
    { name: 'shot.png', data: PNG.toString('base64') },
    { name: 'notes.txt', data: Buffer.from('hello').toString('base64') },
  ]);
  assert.equal(status, 200);
  const user = ops[0].item;
  assert.equal(user.text, 'look');
  assert.equal(user.attachments[0].mime, 'image/png');
  assert.equal(user.attachments[1].name, 'notes.txt');
  assert.equal(JSON.stringify(ops).includes(PNG.toString('base64')), false);

  const [call] = app.calls();
  assert.equal(call.argv.includes('--image'), true);
  assert.match(call.prompt, /Attached files:/);
  assert.match(call.prompt, /notes\.txt/);

  const mediaUrl = `/api/media/${user.attachments[0].id}`;
  assert.equal((await api(app.baseUrl, mediaUrl, { credentials: null })).status, 401);
  const media = await api(app.baseUrl, mediaUrl);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'image/png');
  assert.match(media.headers.get('content-disposition'), /^inline;/);
  assert.equal(Buffer.from(await media.arrayBuffer()).equals(PNG), true);
  assert.equal((await api(app.baseUrl, '/api/media/not-a-uuid')).status, 404);
});

test('shows an image the agent generated', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await api(app.baseUrl, '/api/messages', { method: 'POST', body: { text: 'IMAGE please' } });
  const raw = await response.text();
  assert.equal(response.status, 200);
  assert.equal(raw.includes(PNG.toString('base64')), false);
  const ops = raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const tool = ops.map((op) => op.item ?? op.patch).find((item) => item?.images);
  assert.equal(tool.images[0].name, 'square.png');
  const media = await api(app.baseUrl, `/api/media/${tool.images[0].id}`);
  assert.equal(Buffer.from(await media.arrayBuffer()).equals(PNG), true);
});

test('rejects attachments that are missing, too many, or too large', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const empty = await api(app.baseUrl, '/api/messages', { method: 'POST', body: { text: '  ', attachments: [] } });
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /attach a file/);

  const invalid = await api(app.baseUrl, '/api/messages', {
    method: 'POST',
    body: { text: 'hi', attachments: [{ name: 'a.txt', data: '@@@' }] },
  });
  assert.equal(invalid.status, 400);

  const tooMany = await api(app.baseUrl, '/api/messages', {
    method: 'POST',
    body: {
      text: 'hi',
      attachments: Array.from({ length: 9 }, () => ({ name: 'a.txt', data: Buffer.from('hi').toString('base64') })),
    },
  });
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).error, /up to 8 files/);
});

test('refuses password guesses after the attempt limit', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  for (let i = 0; i < PASSWORD_ATTEMPT_LIMIT; i++) {
    const response = await api(app.baseUrl, '/api/auth/password', {
      method: 'POST',
      credentials: null,
      body: { username: USER, password: 'wrong-password' },
    });
    assert.equal(response.status, 401);
  }

  const blocked = await api(app.baseUrl, '/api/auth/password', {
    method: 'POST',
    credentials: null,
    body: { username: USER, password: PASS },
  });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, 'Too many attempts. Try again later.');
  assert.match(blocked.headers.get('retry-after'), /^[1-9]\d*$/);

  const basic = await api(app.baseUrl, '/api/session', {
    credentials: { username: USER, password: 'wrong-password' },
  });
  assert.equal(basic.status, 429);

  const ceremony = await api(app.baseUrl, '/api/auth/register', {
    method: 'POST',
    credentials: null,
    body: {},
  });
  assert.equal(ceremony.status, 401);

  assert.equal((await api(app.baseUrl, '/api/auth/status', { credentials: null })).status, 200);
});

test('proxied clients get separate attempt budgets by X-Forwarded-For', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const guess = (forwarded) => api(app.baseUrl, '/api/auth/password', {
    method: 'POST',
    credentials: null,
    headers: { 'X-Forwarded-For': forwarded },
    body: { username: USER, password: 'wrong-password' },
  });

  for (let i = 0; i < PASSWORD_ATTEMPT_LIMIT; i++) {
    assert.equal((await guess('203.0.113.7')).status, 401);
  }
  assert.equal((await guess('203.0.113.7')).status, 429);
  assert.equal((await guess('198.51.100.9')).status, 401);
  // The proxy appends the real client last; an earlier, client-supplied entry is not trusted.
  assert.equal((await guess('198.51.100.1, 203.0.113.7')).status, 429);
});

test('a correct Basic password does not spend a password attempt', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  for (let i = 0; i < PASSWORD_ATTEMPT_LIMIT; i++) {
    assert.equal((await api(app.baseUrl, '/api/session')).status, 200);
  }
  const wrong = await api(app.baseUrl, '/api/session', {
    credentials: { username: USER, password: 'wrong-password' },
  });
  assert.equal(wrong.status, 401);
});

test('refuses passkey ceremonies after the attempt limit', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  for (let i = 0; i < PASSKEY_ATTEMPT_LIMIT; i++) {
    const response = await api(app.baseUrl, '/api/auth/register', {
      method: 'POST',
      credentials: null,
      body: {},
    });
    assert.equal(response.status, 401);
  }
  const blocked = await api(app.baseUrl, '/api/auth/options', {
    method: 'POST',
    credentials: null,
    body: { username: USER },
  });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, 'Too many attempts. Try again later.');

  const blockedInviteStatus = await api(app.baseUrl, '/api/auth/status', {
    method: 'POST',
    credentials: null,
    body: { join: '00000000-0000-4000-8000-000000000000' },
  });
  assert.equal(blockedInviteStatus.status, 429);
});

test('refuses GET /api/auth/status after the status attempt limit', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  for (let i = 0; i < STATUS_ATTEMPT_LIMIT; i++) {
    const response = await api(app.baseUrl, '/api/auth/status', { credentials: null });
    assert.equal(response.status, 200);
  }
  const blocked = await api(app.baseUrl, '/api/auth/status', { credentials: null });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, 'Too many attempts. Try again later.');
  assert.match(blocked.headers.get('retry-after'), /^[1-9]\d*$/);
});

test('records a switch to development static assets', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await api(app.baseUrl, '/api/static-assets', {
    method: 'PUT',
    body: { mode: 'dev' },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, 'dev');
  assert.equal(body.bundling, false);
  const after = await api(app.baseUrl, '/api/static-assets');
  const reported = await after.json();
  assert.equal(reported.mode, 'dev');
  assert.equal(reported.bundling, false);
});

test('reports static asset mode to signed-in clients', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const response = await api(app.baseUrl, '/api/static-assets');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, 'dev');
  assert.equal(body.stale, false);
  assert.equal(body.canManage, true);
});

test('rejects release bundling when bun is missing', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-http-'));
  const logFile = path.join(dir, 'calls.jsonl');
  const conversation = new Conversation({
    model: 'composer-2.5',
    workdir: dir,
    agentBin: FAKE_AGENT,
    force: true,
    stateFile: path.join(dir, 'state', 'state.json'),
    runAgent: (options) => runAgent({ ...options, env: { ...process.env, FAKE_AGENT_LOG: logFile }, logger: quietLogger }),
    logger: quietLogger,
  });
  const server = createServer({
    conversation,
    username: USER,
    password: PASS,
    bunBin: 'definitely-missing-bun-binary',
    logger: quietLogger,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await conversation.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const response = await api(baseUrl, '/api/static-assets', {
    method: 'PUT',
    body: { mode: 'release' },
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Bun was not found on the server.');
  const after = await api(baseUrl, '/api/static-assets');
  assert.equal((await after.json()).mode, 'dev');
});

test('falls back to development when the release bundle is missing', async (t) => {
  const app = await startServer({
    beforeStart: (dir) => {
      fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'data', 'static-assets.json'),
        JSON.stringify({
          version: 1,
          mode: 'release',
          manifest: {
            builtAt: '2026-01-01T00:00:00.000Z',
            fingerprint: 'x',
            app: '/dist/app-x.js',
            spec: '/dist/spec-x.js',
            styles: '/dist/styles-x.css',
          },
        }),
      );
    },
  });
  t.after(() => app.close());

  const state = await api(app.baseUrl, '/api/static-assets');
  assert.equal((await state.json()).mode, 'dev');
  const page = await fetch(`${app.baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /src="\/landing\.js"/);
});

test('release mode serves only manifest bundles and refuses non-regular files', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-release-root-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const dist = path.join(projectRoot, 'public', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ok</title>');
  fs.writeFileSync(path.join(dist, 'spec.html'), '<!doctype html><title>spec</title>');
  fs.writeFileSync(path.join(dist, 'landing-111.js'), 'console.log("app");');
  fs.writeFileSync(path.join(dist, 'spec-222.js'), 'console.log("spec");');
  fs.writeFileSync(path.join(dist, 'styles-333.css'), 'body{}');
  fs.writeFileSync(path.join(dist, 'manifest.json'), '{"secret":"no"}');
  fs.writeFileSync(path.join(dist, 'stray.txt'), 'stray');

  const app = await startServer({
    projectRoot,
    beforeStart: (dir) => {
      fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'data', 'static-assets.json'),
        JSON.stringify({
          version: 1,
          mode: 'release',
          manifest: {
            builtAt: '2026-01-01T00:00:00.000Z',
            fingerprint: 'x',
            app: '/dist/landing-111.js',
            spec: '/dist/spec-222.js',
            styles: '/dist/styles-333.css',
          },
        }),
      );
    },
  });
  t.after(() => app.close());

  const bundle = await fetch(`${app.baseUrl}/dist/landing-111.js`);
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(`${app.baseUrl}/dist/manifest.json`)).status, 404);
  assert.equal((await fetch(`${app.baseUrl}/dist/index.html`)).status, 404);
  assert.equal((await fetch(`${app.baseUrl}/dist/stray.txt`)).status, 404);

  // Replacing a served file with a symlink or directory returns 404 instead of reading or 500.
  const target = path.join(projectRoot, 'outside.txt');
  fs.writeFileSync(target, 'outside');
  fs.unlinkSync(path.join(dist, 'spec-222.js'));
  fs.symlinkSync(target, path.join(dist, 'spec-222.js'));
  assert.equal((await fetch(`${app.baseUrl}/dist/spec-222.js`)).status, 404);

  fs.unlinkSync(path.join(dist, 'styles-333.css'));
  fs.mkdirSync(path.join(dist, 'styles-333.css'));
  assert.equal((await fetch(`${app.baseUrl}/dist/styles-333.css`)).status, 404);

  // A FIFO must 404 without blocking a libuv thread. A socket open fails with ENXIO.
  fs.unlinkSync(path.join(dist, 'landing-111.js'));
  execFileSync('mkfifo', [path.join(dist, 'landing-111.js')]);
  const fifo = await fetch(`${app.baseUrl}/dist/landing-111.js`, { signal: AbortSignal.timeout(2000) });
  assert.equal(fifo.status, 404);

  fs.unlinkSync(path.join(dist, 'spec-222.js'));
  const socketPath = path.join(dist, 'spec-222.js');
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(socketPath, resolve);
  });
  t.after(() => socket.close());
  assert.equal((await fetch(`${app.baseUrl}/dist/spec-222.js`)).status, 404);

  // The theme snippet is inlined, not served, so a symlink there must not be copied into the page.
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><!-- theme-init --><title>ok</title>');
  fs.writeFileSync(path.join(projectRoot, 'public', 'theme-init.js'), 'try { window.theme = 1; } catch (e) {}\n');
  const themed = await fetch(`${app.baseUrl}/`);
  assert.equal(themed.status, 200);
  assert.match(await themed.text(), /window\.theme = 1/);

  const secret = path.join(projectRoot, 'secret.txt');
  fs.writeFileSync(secret, 'SECRET-THEME');
  fs.unlinkSync(path.join(projectRoot, 'public', 'theme-init.js'));
  fs.symlinkSync(secret, path.join(projectRoot, 'public', 'theme-init.js'));
  const leaked = await fetch(`${app.baseUrl}/`);
  assert.equal(leaked.status, 404);
  assert.equal((await leaked.text()).includes('SECRET-THEME'), false);
});

test('hides Grok usage when that CLI is not enabled', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  assert.equal((await api(app.baseUrl, '/api/usage', { credentials: null })).status, 401);
  const response = await api(app.baseUrl, '/api/usage');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { grok: null });
});

test('returns the Grok weekly quota percentage', async (t) => {
  const grok = { available: true, percent: 26, period: 'weekly', resetsAt: '2026-11-15T08:53:12.261+00:00' };
  let fresh = false;
  const app = await startServer({
    conversation: { agents: ['cursor', 'grok'], grokBin: FAKE_AGENT },
    readGrokUsage: async (options = {}) => {
      fresh = Boolean(options.fresh);
      return { grok };
    },
  });
  t.after(() => app.close());

  assert.equal(app.conversation.agent, 'cursor');
  const response = await api(app.baseUrl, '/api/usage');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { grok });
  assert.equal(fresh, false);
  await api(app.baseUrl, '/api/usage?fresh=1');
  assert.equal(fresh, true);
});

test('refreshes Grok usage for signed-in members', async (t) => {
  const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-grok-http-'));
  const FAKE_GROK_ACP = fileURLToPath(new URL('../fixtures/fake-grok-acp.js', import.meta.url));
  const { createGrokUsage } = await import('../src/grok-usage.js');
  const grokUsage = createGrokUsage({
    grokEnabled: true,
    grokHome,
    grokBin: FAKE_GROK_ACP,
    fetchBilling: (options) =>
      import('../src/grok-usage.js').then(({ fetchGrokBillingViaAcp }) =>
        fetchGrokBillingViaAcp({
          ...options,
          env: { ...process.env, FAKE_GROK_USAGE_PERCENT: '18' },
          timeoutMs: 5_000,
        }),
      ),
  });
  const app = await startServer({
    conversation: { agents: ['grok'] },
    grokUsage,
  });
  t.after(() => app.close());

  assert.equal(
    (await api(app.baseUrl, '/api/usage/refresh', { method: 'POST', credentials: null })).status,
    401,
  );
  const response = await api(app.baseUrl, '/api/usage/refresh', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).grok, {
    available: true,
    percent: 18,
    period: 'weekly',
    resetsAt: '2026-11-15T08:53:12.261+00:00',
  });
  const limited = await api(app.baseUrl, '/api/usage/refresh', { method: 'POST' });
  assert.equal(limited.status, 429);
  assert.match(await limited.text(), /Too many attempts/);
});

test('lists conversation files and serves workdir reads for the owner only', async (t) => {
  const app = await startServer({
    beforeStart(dir) {
      fs.writeFileSync(path.join(dir, 'listed.txt'), 'workdir bytes');
    },
  });
  t.after(() => app.close());

  const { ops } = await sendMessage(app.baseUrl, 'attach', [
    { name: 'shot.png', data: PNG.toString('base64') },
    { name: 'notes.txt', data: Buffer.from('hello stash').toString('base64') },
  ]);
  const mediaId = ops[0].item.attachments[0].id;

  const list = await api(app.baseUrl, '/api/files');
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.ok(Array.isArray(body.conversation));
  assert.ok(body.conversation.some((entry) => entry.kind === 'media' && entry.id === mediaId));
  const stashEntry = body.conversation.find((entry) => entry.kind === 'stash' && entry.name === 'notes.txt');
  assert.ok(stashEntry?.path);
  const stashOk = await api(app.baseUrl, `/api/files/stash?path=${encodeURIComponent(stashEntry.path)}`);
  assert.equal(stashOk.status, 200);
  assert.equal(await stashOk.text(), 'hello stash');
  assert.ok(Array.isArray(body.workdir));
  assert.ok(body.workdir.some((entry) => entry.path === 'listed.txt'));

  const media = await api(app.baseUrl, `/api/media/${mediaId}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('cache-control'), 'private, max-age=31536000, immutable');

  const workdir = await api(app.baseUrl, '/api/files/workdir?path=listed.txt');
  assert.equal(workdir.status, 200);
  assert.equal(await workdir.text(), 'workdir bytes');
  assert.equal(workdir.headers.get('cache-control'), 'private, max-age=60');

  const denied = await api(app.baseUrl, '/api/files/workdir?path=config.json');
  assert.equal(denied.status, 404);

  const guest = await api(app.baseUrl, '/api/files/workdir?path=listed.txt', { credentials: null });
  assert.equal(guest.status, 401);

  const stash = await api(app.baseUrl, '/api/files/stash?path=.boffin/uploads/nope.txt');
  assert.equal(stash.status, 404);
});

test('summarizes the conversation content over GET /api/overview', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const { ops } = await sendMessage(app.baseUrl, 'attach the logo', [
    { name: 'shot.png', data: PNG.toString('base64') },
    { name: 'notes.txt', data: Buffer.from('hello stash').toString('base64') },
  ]);
  const mediaId = ops[0].item.attachments[0].id;
  assert.ok(typeof mediaId === 'string' && mediaId);
  assert.equal(ops[0].item.attachments[1].name, 'notes.txt');
  assert.ok(!ops[0].item.attachments[1].id);

  const owner = await api(app.baseUrl, '/api/overview');
  assert.equal(owner.status, 200);
  const body = await owner.json();
  assert.equal(body.empty, false);
  assert.match(body.story, /tester/);
  assert.match(body.story, /attach the logo/);
  assert.match(body.story, /notes\.txt/);
  assert.match(body.story, /shot\.png/);

  const unauthenticated = await api(app.baseUrl, '/api/overview', { credentials: null });
  assert.equal(unauthenticated.status, 401);
});

test('resets shopping and overview on new chat while keeping closed conversation views readable', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await sendMessage(app.baseUrl, 'planning a camping trip', [
    { name: 'shot.png', data: PNG.toString('base64') },
  ]);
  await api(app.baseUrl, '/api/shopping', {
    method: 'PUT',
    body: { items: [{ name: 'Tent', wantedBy: 'tester', bought: false, boughtBy: '', note: '' }] },
  });
  fs.writeFileSync(
    path.join(path.dirname(app.conversation.stateFile), 'overview.md'),
    'Everyone planned a weekend camping trip and noted they still needed a tent.\n',
  );

  const reset = await api(app.baseUrl, '/api/new', { method: 'POST', body: {} });
  assert.equal(reset.status, 200);

  const freshShop = await (await api(app.baseUrl, '/api/shopping')).json();
  assert.deepEqual(freshShop.items, []);
  const freshOverview = await (await api(app.baseUrl, '/api/overview')).json();
  assert.equal(freshOverview.empty, true);

  const keptId = app.conversation.kept[0].id;
  const closed = await api(app.baseUrl, `/api/conversations/${keptId}`);
  assert.equal(closed.status, 200);
  const body = await closed.json();
  assert.equal(body.id, keptId);
  assert.ok(body.items.length >= 1);
  assert.equal(body.shopping.items.length, 1);
  assert.equal(body.shopping.items[0].name, 'Tent');
  assert.ok(body.files.some((file) => file.name === 'shot.png'));
  assert.equal(body.overview.empty, false);
  assert.match(body.overview.story, /weekend camping trip/);

  const unauth = await api(app.baseUrl, `/api/conversations/${keptId}`, { credentials: null });
  assert.equal(unauth.status, 401);

  for (const [query, ext] of [
    ['', 'json'],
    ['?format=markdown', 'md'],
    ['?format=print', 'html'],
    ['?format=epub', 'epub'],
  ]) {
    const res = await api(app.baseUrl, `/api/logs/${keptId}${query}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') || '', /immutable/);
    const cacheFile = path.join(path.dirname(app.conversation.stateFile), 'exports', `${keptId}.${ext}`);
    assert.equal(fs.existsSync(cacheFile), true);
  }
});

test('serves /api/update for the owner and triggers onRestart only when server code changed', async (t) => {
  let restarted = 0;
  let nextOutcome = { updated: true, restart: false, rebuildBundle: false, head: 'abc1234' };
  const app = await startServer({
    inspectRepoUpdate: async () => ({ enabled: true, repoRoot: '/repo', repoUrl: 'https://example.com/a/b.git' }),
    pullRepoUpdate: async () => {
      if (nextOutcome instanceof Error) {
        throw nextOutcome;
      }
      return nextOutcome;
    },
    onRestart: () => {
      restarted += 1;
    },
  });
  t.after(() => app.close());

  assert.equal((await api(app.baseUrl, '/api/update', { credentials: null })).status, 401);
  const status = await api(app.baseUrl, '/api/update');
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { enabled: true, updating: false });
  const boot = status.headers.get('x-boffin-boot');
  assert.equal(typeof boot, 'string');
  assert.ok(boot);
  const authStatus = await api(app.baseUrl, '/api/auth/status', { credentials: null });
  assert.equal(authStatus.headers.get('x-boffin-boot'), boot);

  const publicOnly = await api(app.baseUrl, '/api/update', { method: 'POST', body: {} });
  assert.equal(publicOnly.status, 200);
  assert.deepEqual(await publicOnly.json(), { updated: true, restart: false, head: 'abc1234' });
  assert.equal(restarted, 0);

  nextOutcome = { updated: true, restart: true, rebuildBundle: false, head: 'def5678' };
  const serverUpdate = await api(app.baseUrl, '/api/update', { method: 'POST', body: {} });
  assert.equal(serverUpdate.status, 200);
  assert.deepEqual(await serverUpdate.json(), { updated: true, restart: true, head: 'def5678' });
  assert.equal(restarted, 1);

  nextOutcome = new UpdateError(409, UPDATE_NOT_FAST_FORWARD);
  const conflict = await api(app.baseUrl, '/api/update', { method: 'POST', body: {} });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: UPDATE_NOT_FAST_FORWARD });
  assert.equal(restarted, 1);
});
