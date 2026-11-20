import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BusyError, ChoiceError, Conversation, MembershipError, StateError } from '../src/conversation.js';

const quietLogger = { log() {}, error() {} };
const OK = { error: null, code: 0, signal: null, stderr: '' };

const init = (sessionId) => ({ type: 'system', subtype: 'init', session_id: sessionId });
const reply = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const done = (text) => ({ type: 'result', subtype: 'success', is_error: false, result: text });

function tempStateFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-conv-'));
  return { dir, stateFile: path.join(dir, 'data', 'state.json') };
}

function makeConversation(runAgent, stateFile, extra = {}) {
  return new Conversation({
    model: 'composer-2.5',
    workdir: path.dirname(path.dirname(stateFile)),
    agentBin: 'agent',
    force: true,
    stateFile,
    runAgent,
    logger: quietLogger,
    ...extra,
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
  assert.match(second.at(-1), /^second\n\nShopping list:/);
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
  assert.match(args.at(-1), /data\/shopping-list\.json/);
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

test('offers a file the reply names, and a file the run changes, for download', async () => {
  const { dir, stateFile } = tempStateFile();
  const uploadDir = path.join(dir, '.boffin', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const named = path.join(uploadDir, '公司印章管理规定（依法修订稿）.docx');
  fs.writeFileSync(named, Buffer.from('revised-docx'));
  fs.writeFileSync(path.join(dir, 'config.json'), '{"password":"no"}');

  const { runAgent } = scriptedRunner([
    init('chat-file'),
    reply('修订稿在 `.boffin/uploads/公司印章管理规定（依法修订稿）.docx`。'),
    done('done'),
  ]);
  const conversation = makeConversation(runAgent, stateFile);
  const changed = path.join(dir, 'notes.txt');
  const originalRun = conversation.runAgent;
  conversation.runAgent = (options) => {
    fs.writeFileSync(changed, 'created during the run');
    fs.writeFileSync(path.join(dir, 'config.json'), '{"password":"still-no"}');
    return originalRun(options);
  };
  await conversation.start('revise', () => {});

  const assistant = conversation.items.find((item) => item.role === 'assistant');
  const names = assistant.images.map((file) => file.name).sort();
  assert.deepEqual(names, ['notes.txt', '公司印章管理规定（依法修订稿）.docx']);
  const doc = assistant.images.find((file) => file.name.endsWith('.docx'));
  assert.equal(conversation.readMedia(doc.id).inline, false);
  assert.equal(conversation.readMedia(doc.id).bytes.toString(), 'revised-docx');
  assert.equal(JSON.stringify(assistant.images).includes('config.json'), false);
});

test('does not attach a cited workdir file to an older turn when the process starts', () => {
  const { dir, stateFile } = tempStateFile();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'old');
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      version: 1,
      chatId: 'chat-old',
      items: [
        { id: 'u1', role: 'user', text: 'go' },
        { id: 'a1', role: 'assistant', text: 'see `notes.txt`' },
      ],
    }),
  );
  const conversation = makeConversation(() => {
    throw new Error('no run');
  }, stateFile);
  const assistant = conversation.items.find((item) => item.role === 'assistant');
  assert.equal(assistant.images, undefined);
});

test('keeps a file the run changed when the reply already names eight other files', async () => {
  const { dir, stateFile } = tempStateFile();
  const cited = [];
  for (let index = 1; index <= 8; index += 1) {
    const file = path.join(dir, `old-${index}.txt`);
    fs.writeFileSync(file, 'prior');
    const past = new Date(Date.now() - 500);
    fs.utimesSync(file, past, past);
    cited.push(`old-${index}.txt`);
  }
  const { runAgent } = scriptedRunner([
    init('chat-cap'),
    reply(`see ${cited.map((name) => `\`${name}\``).join(' ')}`),
    done('done'),
  ]);
  const conversation = makeConversation(runAgent, stateFile);
  const originalRun = conversation.runAgent;
  conversation.runAgent = (options) => {
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'created during the run');
    return originalRun(options);
  };
  await conversation.start('revise', () => {});

  const assistant = conversation.items.find((item) => item.role === 'assistant');
  const names = assistant.images.map((file) => file.name);
  assert.equal(names.length, 8);
  assert.equal(names.includes('notes.txt'), true);
});

test('skips state outside data/, a deleted upload, a stale file, and a second copy of a sanitized name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-conv-'));
  const stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(path.join(dir, 'foo#1.txt'), 'once');
  const stale = path.join(dir, 'stale.txt');
  fs.writeFileSync(stale, 'old');
  const { runAgent } = scriptedRunner([
    init('chat-private'),
    reply('see `foo#1.txt` and `state.json`'),
    done('done'),
  ]);
  const conversation = makeConversation(runAgent, stateFile, { workdir: dir });
  const originalRun = conversation.runAgent;
  conversation.runAgent = (options) => {
    const past = new Date(Date.now() - 500);
    fs.utimesSync(stale, past, past);
    fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'media', 'secret.bin'), 'secret');
    fs.rmSync(path.join(dir, '.boffin', 'uploads'), { recursive: true, force: true });
    return originalRun(options);
  };
  await conversation.start('go', () => {}, [{ name: 'pic.png', bytes: PNG }]);

  const assistant = conversation.items.find((item) => item.role === 'assistant');
  assert.deepEqual(
    assistant.images.map((file) => file.name),
    ['foo_1.txt'],
  );
  assert.equal(
    conversation.items.some((item) => item.role === 'notice' && /Unexpected server error/.test(item.text ?? '')),
    false,
  );

  const again = makeConversation(() => {
    throw new Error('no run');
  }, stateFile, { workdir: dir });
  const reloaded = again.items.find((item) => item.role === 'assistant');
  assert.deepEqual(
    reloaded.images.map((file) => file.name),
    ['foo_1.txt'],
  );
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

test('spawns Grok for a new chat and does not resume a Cursor session id', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent, calls } = scriptedRunner([init('cursor-chat'), done('ok')]);
  const conversation = makeConversation(runAgent, stateFile, { agents: ['cursor', 'grok'] });

  await conversation.start('first', () => {});
  conversation.reset(new Date().toISOString(), { agent: 'grok', model: 'grok-4.7/high' });
  await conversation.start('second', () => {});

  assert.equal(calls[0].bin, 'agent');
  assert.equal(calls[1].bin, 'grok');
  assert.ok(!calls[1].args.includes('--resume'));
  assert.equal(calls[1].args[calls[1].args.indexOf('--model') + 1], 'grok-4.7');
  assert.ok(calls[1].args.includes('--always-approve'));
  assert.equal(conversation.agent, 'grok');
  assert.equal(conversation.model, 'grok-4.7/high');
});

test('spawns Pi for a new chat and resumes its session id', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent, calls } = scriptedRunner([
    { type: 'session', version: 3, id: 'pi-sess-9' },
    { type: 'message_start', message: { role: 'assistant', content: [], stopReason: 'pending' } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hi' } },
    { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }], stopReason: 'stop' } },
    { type: 'agent_end', messages: [], willRetry: false },
    { type: 'agent_settled', aborted: false },
  ]);
  const conversation = makeConversation(runAgent, stateFile, { agents: ['pi'], piBin: 'pi-test' });

  await conversation.start('first', () => {});
  await conversation.start('second', () => {});

  assert.equal(conversation.chatId, 'pi-sess-9');
  const [first, second] = calls;
  assert.equal(first.bin, 'pi-test');
  assert.ok(first.args.includes('--approve'));
  assert.ok(!first.args.includes('--model'));
  assert.ok(!first.args.includes('--session-id'));
  assert.deepEqual(
    second.args.slice(second.args.indexOf('--session-id'), second.args.indexOf('--session-id') + 2),
    ['--session-id', 'pi-sess-9'],
  );
  assert.deepEqual(
    conversation.items.map((item) => [item.role, item.text]),
    [
      ['user', 'first'],
      ['assistant', 'Hi'],
      ['user', 'second'],
      ['assistant', 'Hi'],
    ],
  );
});

test('persists the chosen agent and model across restarts', async () => {
  const { stateFile } = tempStateFile();
  const conversation = makeConversation(scriptedRunner([]).runAgent, stateFile, { agents: ['cursor', 'grok'] });
  conversation.reset(new Date().toISOString(), { agent: 'grok', model: 'grok-4.7/medium' });

  const restored = makeConversation(scriptedRunner([]).runAgent, stateFile, { agents: ['cursor', 'grok'] });
  assert.equal(restored.agent, 'grok');
  assert.equal(restored.model, 'grok-4.7/medium');
});

test('kept log records the agent that ended, not the new chat', async () => {
  const { stateFile } = tempStateFile();
  const { runAgent } = scriptedRunner([init('cursor-chat'), reply('ok'), done('ok')]);
  const conversation = makeConversation(runAgent, stateFile, { agents: ['cursor', 'grok'] });
  await conversation.start('hello', () => {});
  conversation.reset(new Date().toISOString(), { agent: 'grok', model: 'grok-4.7/high' });

  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(saved.agent, 'grok');
  assert.equal(saved.model, 'grok-4.7/high');
  assert.equal(saved.kept[0].agent, 'cursor');
  assert.equal(saved.kept[0].model, 'composer-2.5');
});

test('does not resume a legacy Cursor chat id on Grok or Pi', () => {
  const { stateFile } = tempStateFile();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, chatId: 'cursor-1', items: [] }));

  const grokOnly = makeConversation(scriptedRunner([]).runAgent, stateFile, { agents: ['grok'] });
  assert.equal(grokOnly.agent, 'grok');
  assert.equal(grokOnly.chatId, null);

  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, chatId: 'cursor-1', items: [] }));
  const piOnly = makeConversation(scriptedRunner([]).runAgent, stateFile, { agents: ['pi'] });
  assert.equal(piOnly.agent, 'pi');
  assert.equal(piOnly.chatId, null);

  fs.writeFileSync(
    stateFile,
    JSON.stringify({ version: 1, agent: 'grok', model: 'grok-4.7/low', chatId: 'sess-9', items: [] }),
  );
  const restored = makeConversation(scriptedRunner([]).runAgent, stateFile, { agents: ['grok'] });
  assert.equal(restored.chatId, 'sess-9');
  assert.equal(restored.model, 'grok-4.7/low');

  fs.writeFileSync(
    stateFile,
    JSON.stringify({ version: 1, agent: 'grok', model: 'grok-4.7/high', chatId: 'sess-9', items: [] }),
  );
  const switched = makeConversation(scriptedRunner([]).runAgent, stateFile, { agents: ['pi'] });
  assert.equal(switched.agent, 'pi');
  assert.equal(switched.model, 'default');
  assert.equal(switched.chatId, null);
});

test('treats a kept log without agent or model as a Cursor Composer 2.5 chat', () => {
  const { stateFile } = tempStateFile();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const recordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const personId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      version: 1,
      chatId: null,
      items: [],
      agent: 'grok',
      model: 'grok-4.7/high',
      identities: [{ id: personId, name: 'Ada' }],
      kept: [
        {
          id: recordId,
          at: '2026-11-01T00:00:00.000Z',
          items: [{ id: 'm1', role: 'user', text: 'hello' }],
          personIds: [personId],
        },
      ],
    }),
  );

  const conversation = makeConversation(scriptedRunner([]).runAgent, stateFile, { agents: ['cursor', 'grok'] });
  assert.deepEqual(conversation.logFor(personId, recordId), {
    at: '2026-11-01T00:00:00.000Z',
    items: [{ id: 'm1', role: 'user', text: 'hello' }],
    agent: 'cursor',
    model: 'composer-2.5',
  });
});

test('refuses an agent or model that is not enabled', () => {
  const { stateFile } = tempStateFile();
  const conversation = makeConversation(scriptedRunner([]).runAgent, stateFile);
  assert.throws(
    () => conversation.reset(new Date().toISOString(), { agent: 'grok' }),
    (error) => error instanceof ChoiceError && error.message === 'That agent is not available.',
  );
  assert.throws(
    () => conversation.reset(new Date().toISOString(), { agent: 'cursor', model: 'mystery' }),
    (error) => error instanceof ChoiceError && error.message === 'That model is not available.',
  );
});
