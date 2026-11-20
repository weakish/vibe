import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CURSOR_MODEL,
  DEFAULT_GROK_MODEL,
  buildCursorArgs,
  buildGrokArgs,
  catalogFor,
  parseAgents,
  resolveBackends,
  spawnPlan,
} from '../src/backends.js';

test('parses cursor, grok, or a combination and ignores duplicates', () => {
  assert.deepEqual(parseAgents(undefined), ['cursor']);
  assert.deepEqual(parseAgents(['cursor']), ['cursor']);
  assert.deepEqual(parseAgents(['grok']), ['grok']);
  assert.deepEqual(parseAgents(['cursor', 'grok', 'cursor']), ['cursor', 'grok']);
  assert.equal(parseAgents([]), null);
  assert.equal(parseAgents(['both']), null);
  assert.equal(parseAgents(['opencode']), null);
});

test('lists first-party models for the enabled agents', () => {
  const backends = resolveBackends({ agents: ['cursor', 'grok'] });
  const catalog = catalogFor(backends);
  assert.deepEqual(
    catalog.map((entry) => entry.id),
    ['cursor', 'grok'],
  );
  assert.equal(catalog[0].defaultModel, DEFAULT_CURSOR_MODEL);
  assert.ok(catalog[0].models.some((entry) => entry.id === DEFAULT_CURSOR_MODEL));
  assert.equal(catalog[1].defaultModel, DEFAULT_GROK_MODEL);
  assert.ok(catalog[1].models.some((entry) => entry.id === DEFAULT_GROK_MODEL));
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
