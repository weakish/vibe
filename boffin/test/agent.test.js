import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KILL_GRACE_MS, buildAgentArgs, runAgent } from '../src/agent.js';

const FAKE_AGENT = fileURLToPath(new URL('../fixtures/fake-agent.js', import.meta.url));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-agent-'));
}

test('builds print-mode arguments and passes the prompt after a separator', () => {
  assert.deepEqual(
    buildAgentArgs({ model: 'composer-2.5', force: true, resumeId: 'chat-1', prompt: '-n hi' }),
    [
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--trust',
      '--model',
      'composer-2.5',
      '--force',
      '--resume',
      'chat-1',
      '--',
      '-n hi',
    ],
  );
});

test('passes each image before the prompt separator', () => {
  const args = buildAgentArgs({
    model: 'm',
    force: false,
    resumeId: null,
    prompt: 'look',
    imagePaths: ['/tmp/a.png', '/tmp/b.png'],
  });
  assert.deepEqual(args.slice(-6), ['--image', '/tmp/a.png', '--image', '/tmp/b.png', '--', 'look']);
});

test('omits --force and --resume when they are not requested', () => {
  const args = buildAgentArgs({ model: 'm', force: false, resumeId: null, prompt: 'p' });
  assert.ok(!args.includes('--force'));
  assert.ok(!args.includes('--resume'));
  assert.deepEqual(args.slice(-2), ['--', 'p']);
});

test('streams parsed events and resolves with a clean exit', async () => {
  const events = [];
  const handle = runAgent({
    bin: FAKE_AGENT,
    args: buildAgentArgs({ model: 'm', force: true, resumeId: null, prompt: 'hello' }),
    cwd: tempDir(),
    onEvent: (event) => events.push(event),
    logger: { error() {} },
  });
  const outcome = await handle.done;

  assert.equal(outcome.code, 0);
  assert.equal(outcome.error, null);
  assert.equal(events[0].type, 'system');
  assert.equal(events.at(-1).type, 'result');
  assert.equal(events.at(-1).result, 'Echo: hello');
});

test('runs in the configured working directory and forwards the resume id', async () => {
  const dir = tempDir();
  const logFile = path.join(dir, 'calls.jsonl');
  const handle = runAgent({
    bin: FAKE_AGENT,
    args: buildAgentArgs({ model: 'm', force: true, resumeId: 'chat-9', prompt: 'hi' }),
    cwd: dir,
    env: { ...process.env, FAKE_AGENT_LOG: logFile },
    onEvent: () => {},
  });
  await handle.done;

  const [call] = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(dir));
  assert.deepEqual(call.argv.slice(call.argv.indexOf('--resume'), call.argv.indexOf('--resume') + 2), ['--resume', 'chat-9']);
  assert.equal(call.prompt, 'hi');
});

test('sets PWD to the configured working directory', async () => {
  const dir = tempDir();
  const events = [];
  const handle = runAgent({
    bin: process.execPath,
    args: [
      '-e',
      'process.stdout.write(JSON.stringify({type:"system",pwd:process.env.PWD,cwd:process.cwd()})+"\\n")',
    ],
    cwd: dir,
    env: { ...process.env, PWD: process.cwd() },
    onEvent: (event) => events.push(event),
    logger: { error() {} },
  });
  const outcome = await handle.done;

  assert.equal(outcome.code, 0);
  assert.equal(events[0].pwd, path.resolve(dir));
  assert.equal(events[0].cwd, fs.realpathSync(dir));
});

test('reports one malformed-line signal and keeps later events', async () => {
  const events = [];
  const handle = runAgent({
    bin: FAKE_AGENT,
    args: buildAgentArgs({ model: 'm', force: true, resumeId: null, prompt: 'GARBAGE please' }),
    cwd: tempDir(),
    onEvent: (event) => events.push(event),
    logger: { error() {} },
  });
  await handle.done;

  assert.equal(events.filter((event) => event.type === 'boffin_error').length, 1);
  assert.equal(events.at(-1).type, 'result');
});

test('does not pass boffin sign-in secrets to the agent', async () => {
  const events = [];
  const handle = runAgent({
    bin: process.execPath,
    args: [
      '-e',
      'process.stdout.write(JSON.stringify({type:"system",password:process.env.BOFFIN_PASSWORD??null,username:process.env.BOFFIN_USERNAME??null,token:process.env.BOFFIN_ACCESS_TOKEN??null,keep:process.env.BOFFIN_KEEP??null})+"\\n")',
    ],
    cwd: tempDir(),
    env: {
      ...process.env,
      BOFFIN_PASSWORD: 'secret-password',
      BOFFIN_USERNAME: 'secret-user',
      BOFFIN_ACCESS_TOKEN: 'secret-token',
      BOFFIN_KEEP: 'keep-me',
    },
    onEvent: (event) => events.push(event),
    logger: { error() {} },
  });
  const outcome = await handle.done;

  assert.equal(outcome.code, 0);
  assert.equal(events[0].password, null);
  assert.equal(events[0].username, null);
  assert.equal(events[0].token, null);
  assert.equal(events[0].keep, 'keep-me');
});

test('reports a missing binary as a spawn error', async () => {
  const handle = runAgent({
    bin: path.join(tempDir(), 'no-such-agent'),
    args: [],
    cwd: tempDir(),
    onEvent: () => {},
  });
  const outcome = await handle.done;
  assert.equal(outcome.error.code, 'ENOENT');
  assert.equal(outcome.code, null);
});

test('a handler failure SIGKILLs a CLI that ignores SIGTERM', { timeout: KILL_GRACE_MS + 10_000 }, async () => {
  const handle = runAgent({
    bin: process.execPath,
    args: [
      '-e',
      'process.on("SIGTERM", () => {}); process.stdout.write(JSON.stringify({type:"system"})+"\\n"); setInterval(() => {}, 1000);',
    ],
    cwd: tempDir(),
    onEvent: () => {
      throw new Error('boom');
    },
    logger: { error() {} },
  });
  const outcome = await handle.done;
  assert.equal(outcome.error?.message, 'boom');
  assert.equal(outcome.error?.handledEvent, true);
  assert.equal(outcome.signal, 'SIGKILL');
});

test('cancel terminates a running agent', async () => {
  const events = [];
  const handle = runAgent({
    bin: FAKE_AGENT,
    args: buildAgentArgs({ model: 'm', force: true, resumeId: null, prompt: 'SLOW' }),
    cwd: tempDir(),
    onEvent: (event) => events.push(event),
  });

  await waitFor(() => events.some((event) => event.type === 'assistant'));
  handle.cancel();
  const outcome = await handle.done;

  assert.equal(outcome.signal, 'SIGTERM');
  assert.ok(!events.some((event) => event.type === 'result'));
});

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
