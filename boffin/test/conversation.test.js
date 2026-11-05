import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BusyError, Conversation, MembershipError, StateError } from '../src/conversation.js';

const quietLogger = { log() {}, error() {} };
const OK = { error: null, code: 0, signal: null, stderr: '' };

const init = (sessionId) => ({ type: 'system', subtype: 'init', session_id: sessionId });
const reply = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const done = (text) => ({ type: 'result', subtype: 'success', is_error: false, result: text });

function tempStateFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-conv-'));
  return { dir, stateFile: path.join(dir, 'data', 'state.json') };
}

function makeConversation(runAgent, stateFile) {
  return new Conversation({
    model: 'composer-2.5',
    workdir: path.dirname(path.dirname(stateFile)),
    agentBin: 'agent',
    force: true,
    stateFile,
    runAgent,
    logger: quietLogger,
  });
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// Replays the given events and then resolves with `outcome`.
function scriptedRunner(events, outcome = OK) {
  const calls = [];
  const runAgent = (options) => {
    calls.push(options);
    let finish;
    const handle = { done: new Promise((resolve) => (finish = resolve)), cancel() {} };
    setImmediate(() => {
      events.forEach((event) => options.onEvent(event));
      finish(outcome);
    });
    return handle;
  };
  return { runAgent, calls };
}

// Lets the test decide when a run ends and whether it was cancelled.
function manualRunner() {
  const runs = [];
  const runAgent = (options) => {
    let finish;
    const handle = {
      options,
      done: new Promise((resolve) => (finish = resolve)),
      cancel: () => finish({ error: null, code: null, signal: 'SIGTERM', stderr: '' }),
      finish: (outcome = OK) => finish(outcome),
    };
    runs.push(handle);
    return handle;
  };
  return { runAgent, runs };
}

test('streams user and assistant operations into the transcript', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent } = scriptedRunner([init('chat-1'), reply('Hi there'), done('Hi there')]);
  const conversation = makeConversation(runAgent, stateFile);
  const emitted = [];

  await conversation.start('hello', (op) => emitted.push(op));

  assert.equal(conversation.busy, false);
  assert.equal(conversation.chatId, 'chat-1');
  assert.deepEqual(
    conversation.items.map((item) => [item.role, item.text]),
    [
      ['user', 'hello'],
      ['assistant', 'Hi there'],
    ],
  );
  assert.deepEqual(
    emitted.map((op) => op.op),
    ['add', 'add'],
  );
});

test('resumes the same CLI chat for follow-up messages', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent, calls } = scriptedRunner([init('chat-7'), done('ok')]);
  const conversation = makeConversation(runAgent, stateFile);

  await conversation.start('first', () => {});
  await conversation.start('second', () => {});

  const [first, second] = calls.map((call) => call.args);
  assert.ok(!first.includes('--resume'));
  assert.deepEqual(second.slice(second.indexOf('--resume'), second.indexOf('--resume') + 2), ['--resume', 'chat-7']);
  assert.equal(second.at(-1), 'second');
  assert.equal(second[second.indexOf('--model') + 1], 'composer-2.5');
});

test('rejects overlapping messages and resets while a run is active', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent, runs } = manualRunner();
  const conversation = makeConversation(runAgent, stateFile);

  const running = conversation.start('one', () => {});
  assert.equal(conversation.busy, true);
  assert.throws(() => conversation.start('two', () => {}), BusyError);
  assert.throws(() => conversation.reset(), BusyError);

  runs[0].finish();
  await running;
  assert.equal(conversation.busy, false);
  conversation.reset();
  assert.deepEqual(conversation.items, []);
});

test('cancel before spawn skips the agent and records that it was stopped', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent, runs } = manualRunner();
  const conversation = makeConversation(runAgent, stateFile);

  const running = conversation.start('hello', (op) => {
    if (op.item?.role === 'user') {
      conversation.cancel();
    }
  });
  await running;

  assert.equal(runs.length, 0);
  assert.equal(conversation.busy, false);
  assert.equal(conversation.items.at(-1).text, 'Stopped.');
});

test('cancel stops the run and records that it was stopped', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent } = manualRunner();
  const conversation = makeConversation(runAgent, stateFile);

  const running = conversation.start('long task', () => {});
  assert.equal(conversation.cancel(), true);
  await running;

  assert.equal(conversation.cancel(), false);
  assert.equal(conversation.items.at(-1).text, 'Stopped.');
  assert.equal(conversation.items.at(-1).level, 'info');
});

test('stop() cancels an active run and waits for it to settle', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent } = manualRunner();
  const conversation = makeConversation(runAgent, stateFile);

  const running = conversation.start('long task', () => {});
  await conversation.stop();
  await running;
  assert.equal(conversation.busy, false);
  assert.equal(conversation.items.at(-1).text, 'Stopped.');
});

test('reports a crashed agent as an error notice', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent } = scriptedRunner([], { error: null, code: 2, signal: null, stderr: 'Error: connection reset\n' });
  const conversation = makeConversation(runAgent, stateFile);

  await conversation.start('hello', () => {});

  const notice = conversation.items.at(-1);
  assert.equal(notice.role, 'notice');
  assert.equal(notice.level, 'error');
  assert.equal(notice.text, 'The agent stopped (exit code 2): Error: connection reset');
});

test('persists the transcript and chat id across restarts', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent } = scriptedRunner([init('chat-keep'), reply('Saved answer'), done('Saved answer')]);
  await makeConversation(runAgent, stateFile).start('remember me', () => {});

  const restored = makeConversation(scriptedRunner([]).runAgent, stateFile);
  assert.equal(restored.chatId, 'chat-keep');
  assert.deepEqual(
    restored.items.map((item) => item.text),
    ['remember me', 'Saved answer'],
  );

  restored.reset();
  const cleared = makeConversation(scriptedRunner([]).runAgent, stateFile);
  assert.equal(cleared.chatId, null);
  assert.deepEqual(cleared.items, []);
});

test('refuses a state file that is not valid JSON so it is not overwritten', () => {
  const { stateFile } = tempStateFile();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const original = '{not json';
  fs.writeFileSync(stateFile, original);

  assert.throws(
    () => makeConversation(scriptedRunner([]).runAgent, stateFile),
    (error) => error instanceof StateError && /not overwritten/.test(error.message),
  );
  assert.equal(fs.readFileSync(stateFile, 'utf8'), original);
});

test('refuses a state file whose shape would be overwritten', () => {
  const { stateFile } = tempStateFile();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const original = JSON.stringify({ version: 2, chatId: 'future', items: [{ id: 'a', role: 'user', text: 'keep' }] });
  fs.writeFileSync(stateFile, original);

  assert.throws(
    () => makeConversation(scriptedRunner([]).runAgent, stateFile),
    (error) => error instanceof StateError && /not overwritten/.test(error.message),
  );
  assert.equal(fs.readFileSync(stateFile, 'utf8'), original);
});

test('stores a cover key on an existing state file and reuses it', () => {
  const { stateFile } = tempStateFile();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, chatId: null, items: [] }));

  makeConversation(scriptedRunner([]).runAgent, stateFile);
  const saved = fs.readFileSync(stateFile, 'utf8');
  const parsed = JSON.parse(saved);
  assert.equal(Buffer.from(parsed.coverKey, 'base64url').length, 32);
  assert.equal(Buffer.from(parsed.coverKey, 'base64url').toString('base64url'), parsed.coverKey);

  makeConversation(scriptedRunner([]).runAgent, stateFile);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), saved);
});

test('refuses a state file with an invalid cover key', () => {
  const { stateFile } = tempStateFile();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const original = JSON.stringify({ version: 1, chatId: null, items: [], coverKey: 'nope' });
  fs.writeFileSync(stateFile, original);

  assert.throws(
    () => makeConversation(scriptedRunner([]).runAgent, stateFile),
    (error) => error instanceof StateError && /invalid cover key/.test(error.message),
  );
  assert.equal(fs.readFileSync(stateFile, 'utf8'), original);
});

test('reports a state file that cannot be rewritten to store its cover key', () => {
  const { stateFile } = tempStateFile();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const original = JSON.stringify({ version: 1, chatId: null, items: [] });
  fs.writeFileSync(stateFile, original);
  // A directory where the temporary file goes makes the write fail on any system, root included.
  fs.mkdirSync(`${stateFile}.tmp`);

  assert.throws(
    () => makeConversation(scriptedRunner([]).runAgent, stateFile),
    (error) => error instanceof StateError && /cover key/.test(error.message),
  );
  assert.equal(fs.readFileSync(stateFile, 'utf8'), original);
});

test('refuses a state file with unknown fields', () => {
  const { stateFile } = tempStateFile();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const original = JSON.stringify({ version: 1, chatId: null, items: [], extra: true });
  fs.writeFileSync(stateFile, original);

  assert.throws(
    () => makeConversation(scriptedRunner([]).runAgent, stateFile),
    (error) => error instanceof StateError && /unknown field/.test(error.message),
  );
  assert.equal(fs.readFileSync(stateFile, 'utf8'), original);
});

test('tells the transcript when the conversation cannot be saved', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent } = scriptedRunner([init('chat-1'), reply('Hi'), done('Hi')]);
  const conversation = makeConversation(runAgent, stateFile);
  fs.writeFileSync(path.dirname(stateFile), 'not-a-directory');
  const emitted = [];

  await assert.rejects(() => conversation.start('hello', (op) => emitted.push(op)), /Could not save this conversation/);
  assert.equal(emitted.at(-1).item.level, 'error');
  assert.match(emitted.at(-1).item.text, /Could not save this conversation/);
});

test('sends images with --image and other files as paths in the prompt', async () => {
  const { dir, stateFile } = tempStateFile();
  const { runAgent, calls } = scriptedRunner([init('chat-files'), done('ok')]);
  const conversation = makeConversation(runAgent, stateFile);

  await conversation.start('look', () => {}, [
    { name: 'shot.png', bytes: PNG },
    { name: 'notes.txt', bytes: Buffer.from('hello') },
  ]);

  const args = calls[0].args;
  const images = args.flatMap((arg, index) => (arg === '--image' ? [args[index + 1]] : []));
  assert.equal(images.length, 1);
  assert.equal(fs.readFileSync(images[0]).equals(PNG), true);
  assert.match(args.at(-1), /^look\n\nAttached files:\n/);
  assert.match(args.at(-1), /notes\.txt$/m);
  assert.equal(args.includes('--image'), true);
  assert.ok(images[0].startsWith(dir));

  const [user] = conversation.items;
  assert.equal(user.text, 'look');
  assert.equal(user.attachments[0].mime, 'image/png');
  assert.equal(user.attachments[1].name, 'notes.txt');
  assert.equal(user.attachments[1].id, undefined);
  assert.ok(conversation.readMedia(user.attachments[0].id).bytes.equals(PNG));
  assert.equal(fs.readFileSync(stateFile, 'utf8').includes('iVBORw0KGgo'), false);
  assert.equal(fs.readFileSync(path.join(dir, '.boffin', '.gitignore'), 'utf8'), '*\n');
});

test('stores generated image bytes and refuses an image path outside the workspace', async () => {
  const { dir, stateFile } = tempStateFile();
  const outside = path.join(os.tmpdir(), `boffin-outside-${process.pid}.png`);
  fs.writeFileSync(outside, PNG);
  const link = path.join(dir, 'escape.png');
  fs.symlinkSync(outside, link);
  const inside = path.join(dir, 'inside.png');
  fs.writeFileSync(inside, PNG);

  const png = PNG.toString('base64');
  const generated = (callId, result) => ({
    type: 'tool_call',
    subtype: 'completed',
    call_id: callId,
    tool_call: { generateImageToolCall: { args: { description: 'picture' }, result: { success: result } } },
  });
  const { runAgent } = scriptedRunner([
    init('chat-img'),
    { type: 'tool_call', subtype: 'started', call_id: 'from-data', tool_call: { generateImageToolCall: { args: { description: 'picture' } } } },
    generated('from-data', { filePath: outside, imageData: png }),
    { type: 'tool_call', subtype: 'started', call_id: 'from-link', tool_call: { generateImageToolCall: { args: { description: 'linked' } } } },
    generated('from-link', { filePath: link }),
    { type: 'tool_call', subtype: 'started', call_id: 'from-file', tool_call: { generateImageToolCall: { args: { description: 'local' } } } },
    generated('from-file', { filePath: inside }),
    done('ok'),
  ]);
  const conversation = makeConversation(runAgent, stateFile);
  const emitted = [];
  await conversation.start('draw', (op) => emitted.push(op));

  const tools = conversation.items.filter((item) => item.role === 'tool');
  assert.equal(tools[0].images[0].mime, 'image/png');
  assert.equal(tools[0].images[0].name, path.basename(outside));
  assert.equal(tools[1].images, undefined);
  assert.equal(tools[2].images[0].mime, 'image/png');
  assert.equal(JSON.stringify(emitted).includes(png), false);
  assert.ok(conversation.readMedia(tools[0].images[0].id).bytes.equals(PNG));
});

test('refuses attachments while a run is active, before writing them', async () => {
  const { dir, stateFile } = tempStateFile();
  const { runAgent, runs } = manualRunner();
  const conversation = makeConversation(runAgent, stateFile);
  const running = conversation.start('wait', () => {});
  assert.throws(
    () => conversation.start('next', () => {}, [{ name: 'notes.txt', bytes: Buffer.from('x') }]),
    BusyError,
  );
  runs[0].finish();
  await running;
  assert.equal(fs.existsSync(path.join(dir, '.boffin')), false);
});

test('a user turn that cannot be saved is not reported as a crashed run', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent, calls } = scriptedRunner([init('chat-save'), done('ok')]);
  const conversation = makeConversation(runAgent, stateFile);
  // A directory where the temporary file goes makes the write fail on any system, root included.
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.mkdirSync(`${stateFile}.tmp`);
  const emitted = [];
  await assert.rejects(
    () => conversation.start('hello', (op) => emitted.push(op)),
    (error) =>
      error instanceof Error &&
      error.message === 'Could not save this conversation. It will be lost when the server restarts.',
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(
    emitted.map((op) => op.item?.text),
    ['hello', 'Could not save this conversation. It will be lost when the server restarts.'],
  );
});

test('keeps the previous transcript when reset cannot be saved', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent } = scriptedRunner([init('chat-keep'), reply('Saved'), done('Saved')]);
  const conversation = makeConversation(runAgent, stateFile);
  await conversation.start('remember', () => {});

  fs.rmSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(path.dirname(stateFile), 'not-a-directory');

  assert.throws(() => conversation.reset());
  assert.equal(conversation.chatId, 'chat-keep');
  assert.deepEqual(
    conversation.items.map((item) => item.text),
    ['remember', 'Saved'],
  );
});

test('the owner can add someone who joined a previous conversation', () => {
  const { stateFile } = tempStateFile();
  const { runAgent } = scriptedRunner([]);
  const conversation = makeConversation(runAgent, stateFile);
  const id = '11111111-1111-4111-8111-111111111111';
  conversation.identities.push({ id, name: 'Ada' });
  conversation.members.push(id);
  conversation.reset();
  assert.deepEqual(conversation.members, []);
  assert.deepEqual(conversation.alumni(), [{ id, name: 'Ada', owner: false }]);
  conversation.addMember(id, 'tester');
  assert.equal(conversation.isMember(id), true);
  assert.deepEqual(conversation.alumni(), []);
  assert.throws(
    () => conversation.addMember(id, 'tester'),
    (error) => error instanceof MembershipError && error.status === 409,
  );
  conversation.removeMember(id);
  const other = '22222222-2222-4222-8222-222222222222';
  conversation.identities.push({ id: other, name: 'Ada' });
  conversation.members.push(other);
  assert.throws(
    () => conversation.addMember(id, 'tester'),
    (error) => error instanceof MembershipError && error.message === 'That name is already used.',
  );
  assert.throws(
    () => conversation.addMember('33333333-3333-4333-8333-333333333333', 'tester'),
    (error) => error instanceof MembershipError && error.status === 404,
  );
});

test('a name stays taken after its holder leaves and after a new chat', () => {
  const { stateFile } = tempStateFile();
  const { runAgent } = scriptedRunner([]);
  const conversation = makeConversation(runAgent, stateFile);
  const id = '11111111-1111-4111-8111-111111111111';
  conversation.identities.push({ id, name: 'Ada' });
  conversation.members.push(id);
  conversation.removeMember(id);

  const invite = conversation.createInvite();
  assert.throws(
    () => conversation.prepareJoin(invite.id, 'Ada', 'tester'),
    (error) => error instanceof MembershipError && error.message === 'That name is already used.',
  );
  assert.throws(
    () => conversation.prepareJoin(invite.id, 'tester', 'tester'),
    (error) => error instanceof MembershipError && error.message === 'That name is already used.',
  );

  conversation.reset();
  const afterNewChat = conversation.createInvite();
  assert.throws(
    () => conversation.prepareJoin(afterNewChat.id, 'Ada', 'tester'),
    (error) => error instanceof MembershipError && error.message === 'That name is already used.',
  );
  assert.equal(conversation.prepareJoin(afterNewChat.id, 'Grace', 'tester'), 'Grace');
});
