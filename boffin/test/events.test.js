import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp } from '../shared/transcript.js';
import { createRunState, describeToolCall, eventToOps, finishOps } from '../src/events.js';

function replay(events) {
  const items = [];
  const state = createRunState();
  for (const event of events) {
    for (const op of eventToOps(event, state)) {
      applyOp(items, op);
    }
  }
  return { items, state };
}

const init = (sessionId) => ({ type: 'system', subtype: 'init', session_id: sessionId, model: 'm' });
const delta = (text) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  timestamp_ms: 1,
});
const flush = (text, extra = {}) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  ...extra,
});
const complete = (text) => flush(text);
const toolStarted = (callId, tool) => ({ type: 'tool_call', subtype: 'started', call_id: callId, tool_call: tool });
const toolCompleted = (callId, tool) => ({ type: 'tool_call', subtype: 'completed', call_id: callId, tool_call: tool });
const result = (text, extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: text, ...extra });

const readTool = (path, result) => ({ readToolCall: { args: { path }, ...(result ? { result } : {}) } });

test('captures the chat id from the init event', () => {
  const { state } = replay([init('chat-42')]);
  assert.equal(state.chatId, 'chat-42');
});

test('builds one bubble from streamed deltas and finalizes it with the end-of-turn flush', () => {
  const { items } = replay([
    init('c'),
    delta('Hel'),
    delta('lo'),
    flush('Hello'),
    result('Hello'),
  ]);
  assert.deepEqual(
    items.map((item) => [item.role, item.text]),
    [['assistant', 'Hello']],
  );
});

test('does not duplicate text when a pre-tool flush and end-of-turn flush repeat streamed deltas', () => {
  const { items } = replay([
    init('c'),
    delta('Let me look.'),
    flush('Let me look.', { timestamp_ms: 2, model_call_id: 'mc-1' }),
    toolStarted('t1', readTool('README.md')),
    toolCompleted('t1', readTool('README.md', { success: { totalLines: 3 } })),
    delta('Found it.'),
    flush('Found it.'),
    result('Let me look.Found it.'),
  ]);

  assert.deepEqual(
    items.map((item) => [item.role, item.text ?? item.summary]),
    [
      ['assistant', 'Let me look.'],
      ['tool', 'README.md'],
      ['assistant', 'Found it.'],
    ],
  );
  assert.equal(items[1].status, 'done');
});

test('treats each complete assistant message as its own bubble when streaming is off', () => {
  const { items } = replay([
    init('c'),
    complete('First'),
    toolStarted('t1', readTool('a.txt')),
    toolCompleted('t1', readTool('a.txt', { success: {} })),
    complete('Second'),
    result('First Second'),
  ]);
  assert.deepEqual(
    items.map((item) => (item.role === 'tool' ? 'tool' : item.text)),
    ['First', 'tool', 'Second'],
  );
});

test('falls back to the final result text when no assistant text was emitted', () => {
  const { items } = replay([init('c'), result('Only the final answer')]);
  assert.deepEqual(
    items.map((item) => [item.role, item.text]),
    [['assistant', 'Only the final answer']],
  );
});

test('marks tools with rejected or failed results as errors', () => {
  const { items } = replay([
    init('c'),
    toolStarted('t1', { shellToolCall: { args: { command: 'rm -rf /tmp/x' } } }),
    toolCompleted('t1', { shellToolCall: { args: { command: 'rm -rf /tmp/x' }, result: { rejected: { reason: 'denied' } } } }),
  ]);
  assert.equal(items[0].name, 'Shell');
  assert.equal(items[0].summary, 'rm -rf /tmp/x');
  assert.equal(items[0].status, 'error');
});

test('shows a visible error notice when the result reports an error', () => {
  const { items } = replay([init('c'), result('Model rejected the request.', { subtype: 'error', is_error: true })]);
  assert.deepEqual(
    items.map((item) => [item.role, item.level, item.text]),
    [['notice', 'error', 'Model rejected the request.']],
  );
});

test('finishOps reports cancellation, spawn failures, and crashes without duplicating a result', () => {
  const cancelled = finishOps({ code: null, signal: 'SIGTERM', stderr: '' }, createRunState(), { cancelled: true });
  assert.deepEqual(cancelled.map((op) => op.item.text), ['Stopped.']);

  const spawnFailure = finishOps({ error: new Error('spawn agent ENOENT'), code: null, signal: null, stderr: '' }, createRunState());
  assert.equal(spawnFailure[0].item.level, 'error');
  assert.match(spawnFailure[0].item.text, /Could not start the Cursor CLI: spawn agent ENOENT/);

  const crashed = finishOps(
    { code: 2, signal: null, stderr: 'warming up\n\u001b[31mError: connection reset\u001b[0m\n' },
    createRunState(),
  );
  assert.equal(crashed[0].item.text, 'The agent stopped (exit code 2): Error: connection reset');

  const state = createRunState();
  state.sawResult = true;
  assert.deepEqual(finishOps({ code: 1, signal: null, stderr: 'late' }, state), []);
});

test('finishOps is silent for a clean exit', () => {
  assert.deepEqual(finishOps({ code: 0, signal: null, stderr: '' }, createRunState()), []);
});

test('attaches generated image bytes to the tool without using them as the summary', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const { items } = replay([
    toolStarted('t1', { generateImageToolCall: { args: { description: 'a red square' } } }),
    toolCompleted('t1', {
      generateImageToolCall: {
        args: { description: 'a red square', filePath: 'square.png' },
        result: { success: { filePath: '/tmp/square.png', imageData: png } },
      },
    }),
  ]);
  assert.equal(items[0].name, 'Generate image');
  assert.equal(items[0].summary, 'a red square');
  assert.equal(items[0].status, 'done');
  assert.deepEqual(items[0].images, [{ name: 'square.png', data: png, filePath: '/tmp/square.png' }]);
});

test('keeps an assistant image part beside the text', () => {
  const { items } = replay([
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Done' },
          { type: 'image', data: 'abc' },
        ],
      },
    },
  ]);
  assert.equal(items[0].text, 'Done');
  assert.deepEqual(items[0].images, [{ name: 'image', data: 'abc', filePath: '' }]);
});

test('describeToolCall derives readable names and summaries', () => {
  assert.deepEqual(describeToolCall({ shellToolCall: { args: { command: '  npm   test ' } } }), {
    name: 'Shell',
    summary: 'npm test',
    result: undefined,
  });
  assert.equal(describeToolCall({ updateTodosToolCall: { args: {} } }).name, 'Update todos');
  assert.deepEqual(
    describeToolCall({ function: { name: 'web_search', arguments: '{"query":"cursor cli"}' } }),
    { name: 'Web search', summary: 'cursor cli', result: undefined },
  );
});

test('turns a malformed agent line into one error notice', () => {
  const { items } = replay([{ type: 'boffin_error' }]);
  assert.equal(items[0].role, 'notice');
  assert.equal(items[0].level, 'error');
  assert.match(items[0].text, /could not read/);
});

test('ignores unknown event types and malformed shapes', () => {
  const state = createRunState();
  assert.deepEqual(eventToOps({ type: 'something_new' }, state), []);
  assert.deepEqual(eventToOps(null, state), []);
  assert.deepEqual(eventToOps({ type: 'assistant', message: { content: 42 } }, state), []);
});
