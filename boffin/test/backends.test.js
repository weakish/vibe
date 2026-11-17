import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CURSOR_MODEL,
  DEFAULT_GROK_MODEL,
  DEFAULT_OPENCODE_MODEL,
  buildCursorArgs,
  buildGrokArgs,
  buildOpenCodeArgs,
  catalogFor,
  findModel,
  parseAgents,
  resolveBackends,
  spawnPlan,
} from '../src/backends.js';

test('parses cursor, grok, opencode, or a combination and ignores duplicates', () => {
  assert.deepEqual(parseAgents(undefined), ['cursor']);
  assert.deepEqual(parseAgents(['cursor']), ['cursor']);
  assert.deepEqual(parseAgents(['grok']), ['grok']);
  assert.deepEqual(parseAgents(['opencode']), ['opencode']);
  assert.deepEqual(parseAgents(['cursor', 'grok', 'opencode', 'cursor']), ['cursor', 'grok', 'opencode']);
  assert.equal(parseAgents([]), null);
  assert.equal(parseAgents(['both']), null);
});

test('lists first-party models for the enabled agents', () => {
  const backends = resolveBackends({ agents: ['cursor', 'grok', 'opencode'] });
  const catalog = catalogFor(backends);
  assert.deepEqual(
    catalog.map((entry) => entry.id),
    ['cursor', 'grok', 'opencode'],
  );
  assert.equal(catalog[0].defaultModel, DEFAULT_CURSOR_MODEL);
  assert.ok(catalog[0].models.some((entry) => entry.id === DEFAULT_CURSOR_MODEL));
  assert.equal(catalog[1].defaultModel, DEFAULT_GROK_MODEL);
  assert.ok(catalog[1].models.some((entry) => entry.id === DEFAULT_GROK_MODEL));
  assert.equal(catalog[2].defaultModel, DEFAULT_OPENCODE_MODEL);
  assert.deepEqual(catalog[2].models, [{ id: DEFAULT_OPENCODE_MODEL, label: 'Big Pickle' }]);
});

test('accepts any provider/model for OpenCode and adds it to the catalog', () => {
  const model = 'openrouter/anthropic/claude-sonnet-5.5';
  const backends = resolveBackends({ agents: ['opencode'], opencodeModel: model });
  assert.equal(findModel('opencode', model).cli, model);
  for (const id of [
    'amazon-bedrock/amazon.nova-lite-v1:0',
    'cloudflare-workers-ai/@cf/meta/llama-3.1-8b-instruct',
    'verbose/~openai/gpt-sol-latest',
  ]) {
    assert.equal(findModel('opencode', id).cli, id);
  }
  assert.equal(findModel('opencode', 'not-a-model'), null);
  const [entry] = catalogFor(backends);
  assert.equal(entry.defaultModel, model);
  assert.ok(entry.models.some((candidate) => candidate.id === model));
});

test('catalog default follows the configured model, not catalog order', () => {
  const backends = resolveBackends({ agents: ['grok'], grokModel: 'grok-4.6' });
  assert.equal(catalogFor(backends)[0].defaultModel, 'grok-4.6');
  assert.equal(catalogFor(backends)[0].models[0].id, DEFAULT_GROK_MODEL);
});

test('builds Cursor print-mode arguments', () => {
  assert.deepEqual(
    buildCursorArgs({
      spec: { cli: 'composer-2.5' },
      force: true,
      resumeId: 'chat-1',
      prompt: '-n hi',
    }),
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

test('builds Grok single-turn arguments with effort and always-approve', () => {
  const args = buildGrokArgs({
    spec: { cli: 'grok-4.7', effort: 'high' },
    force: true,
    resumeId: 'sess-9',
    prompt: 'hi',
    cwd: '/srv/boffin',
  });
  assert.deepEqual(args, [
    '--output-format',
    'streaming-json',
    '--cwd',
    '/srv/boffin',
    '--model',
    'grok-4.7',
    '--reasoning-effort',
    'high',
    '--always-approve',
    '--resume',
    'sess-9',
    '--single=hi',
  ]);
});

test('passes a leading-dash Grok prompt as the --single value', () => {
  const args = buildGrokArgs({
    spec: { cli: 'grok-4.5' },
    force: false,
    prompt: '-n hi',
    cwd: '/tmp',
  });
  assert.ok(args.includes('--single=-n hi'));
  assert.ok(!args.includes('--include-partial-messages'));
});

test('does not pass Cursor image flags to Grok', () => {
  const plan = spawnPlan({
    agent: 'grok',
    model: DEFAULT_GROK_MODEL,
    force: true,
    resumeId: null,
    prompt: 'look',
    imagePaths: ['/tmp/a.png'],
    cwd: '/tmp',
  });
  assert.equal(plan.binKey, 'grok');
  assert.ok(!plan.args.includes('--image'));
});

test('builds OpenCode run arguments with auto-approve, session, and files', () => {
  assert.deepEqual(
    buildOpenCodeArgs({
      spec: { cli: 'opencode/big-pickle' },
      force: true,
      resumeId: 'ses_123',
      prompt: '-n hi',
      imagePaths: ['/tmp/a.png'],
    }),
    [
      'run',
      '--format',
      'json',
      '--model',
      'opencode/big-pickle',
      '--auto',
      '--session',
      'ses_123',
      '--file',
      '/tmp/a.png',
      '--',
      '-n',
      'hi',
    ],
  );
});

test('passes an OpenCode prompt as separate words so the CLI does not wrap it in quotes', () => {
  const args = buildOpenCodeArgs({
    spec: { cli: 'opencode/big-pickle' },
    force: false,
    prompt: 'Ada: hello  "world"',
  });
  assert.deepEqual(args.slice(args.indexOf('--')), ['--', 'Ada:', 'hello', '', '"world"']);
});

test('plans an OpenCode spawn with its configured binary', () => {
  const plan = spawnPlan({
    agent: 'opencode',
    model: DEFAULT_OPENCODE_MODEL,
    force: false,
    resumeId: null,
    prompt: 'hi',
    cwd: '/tmp',
  });
  assert.equal(plan.binKey, 'opencode');
  assert.ok(!plan.args.includes('--auto'));
});
