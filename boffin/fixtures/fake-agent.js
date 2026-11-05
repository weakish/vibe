#!/usr/bin/env node
// Test double for `agent -p --output-format stream-json`. It mirrors the documented
// event shapes so the server can be tested end to end without the real CLI or credentials.
// Behaviour is selected by keywords in the prompt:
//   STREAM  - partial deltas followed by flushes
//   TOOL    - a tool call between two streamed segments
//   SLOW    - streams one delta and then hangs until killed
//   ERROR   - terminal result with is_error
//   GARBAGE - a non-JSON stdout line before the normal reply
//   CRASH   - writes to stderr and exits without a result
//   IMAGE   - a completed GenerateImage tool call with PNG bytes
// Passing `--resume missing` simulates an unknown chat id.
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
const flags = separator === -1 ? argv : argv.slice(0, separator);
const prompt = separator === -1 ? '' : argv.slice(separator + 1).join(' ');
const flagValue = (name) => {
  const index = flags.indexOf(name);
  return index === -1 ? undefined : flags[index + 1];
};
const resumeId = flagValue('--resume');
const model = flagValue('--model');

if (process.env.FAKE_AGENT_LOG) {
  appendFileSync(process.env.FAKE_AGENT_LOG, `${JSON.stringify({ argv: flags, prompt, cwd: process.cwd() })}\n`);
}

const sessionId = resumeId ?? `chat-${randomUUID()}`;
const emit = (event) => process.stdout.write(`${JSON.stringify({ ...event, session_id: sessionId })}\n`);
const assistant = (text, extra = {}) =>
  emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, ...extra });
const delta = (text) => assistant(text, { timestamp_ms: Date.now() });
const flush = (text, extra = {}) => assistant(text, extra);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const resultEvent = (text, extra = {}) =>
  emit({
    type: 'result',
    subtype: 'success',
    duration_ms: 5,
    duration_api_ms: 5,
    is_error: false,
    result: text,
    request_id: randomUUID(),
    ...extra,
  });

async function main() {
  if (resumeId === 'missing') {
    process.stderr.write('Error: Chat not found\n');
    process.exitCode = 1;
    return;
  }

  emit({ type: 'system', subtype: 'init', apiKeySource: 'env', cwd: process.cwd(), model, permissionMode: 'default' });
  emit({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } });

  if (prompt.includes('CRASH')) {
    process.stderr.write('Error: connection reset\n');
    process.exitCode = 2;
    return;
  }

  if (prompt.includes('SLOW')) {
    delta('Thinking');
    await sleep(60000);
    return;
  }

  if (prompt.includes('STREAM')) {
    delta('Hel');
    delta('lo ');
    delta('world');
    flush('Hello world');
    resultEvent('Hello world');
    return;
  }

  if (prompt.includes('TOOL')) {
    delta('Let me check. ');
    flush('Let me check. ', { timestamp_ms: Date.now(), model_call_id: 'mc-1' });
    const callId = `call-${randomUUID()}`;
    emit({ type: 'tool_call', subtype: 'started', call_id: callId, tool_call: { readToolCall: { args: { path: 'README.md' } } } });
    emit({
      type: 'tool_call',
      subtype: 'completed',
      call_id: callId,
      tool_call: {
        readToolCall: {
          args: { path: 'README.md' },
          result: { success: { content: '# Demo', isEmpty: false, totalLines: 1 } },
        },
      },
    });
    delta('Found it.');
    flush('Found it.');
    resultEvent('Let me check. Found it.');
    return;
  }

  if (prompt.includes('GARBAGE')) {
    process.stdout.write('not json\n');
    process.stdout.write('also not json\n');
    assistant(`Echo: ${prompt}`);
    resultEvent(`Echo: ${prompt}`);
    return;
  }

  if (prompt.includes('IMAGE')) {
    const callId = `call-${randomUUID()}`;
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    emit({
      type: 'tool_call',
      subtype: 'started',
      call_id: callId,
      tool_call: { generateImageToolCall: { args: { description: 'a red square', filePath: 'square.png' } } },
    });
    emit({
      type: 'tool_call',
      subtype: 'completed',
      call_id: callId,
      tool_call: {
        generateImageToolCall: {
          args: { description: 'a red square', filePath: 'square.png' },
          result: { success: { filePath: 'square.png', imageData: png } },
        },
      },
    });
    assistant('Here is the image.');
    resultEvent('Here is the image.');
    return;
  }

  if (prompt.includes('ERROR')) {
    assistant('Partial answer');
    resultEvent('Model rejected the request.', { subtype: 'error', is_error: true });
    process.exitCode = 1;
    return;
  }

  assistant(`Echo: ${prompt}`);
  resultEvent(`Echo: ${prompt}`);
}

main();
