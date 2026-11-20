import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_CURSOR_MODEL,
  DEFAULT_GROK_MODEL,
  DEFAULT_PI_MODEL,
  buildCursorArgs,
  buildGrokArgs,
  buildPiArgs,
  catalogFor,
  findModel,
  normalizePiThinking,
  parseAgents,
  readPiDefaults,
  resolveBackends,
  spawnPlan,
} from '../src/backends.js';

test('parses cursor, grok, pi, or a combination and ignores duplicates', () => {
  assert.deepEqual(parseAgents(undefined), ['cursor']);
  assert.deepEqual(parseAgents(['cursor']), ['cursor']);
  assert.deepEqual(parseAgents(['grok']), ['grok']);
  assert.deepEqual(parseAgents(['pi']), ['pi']);
  assert.deepEqual(parseAgents(['cursor', 'grok', 'pi', 'cursor']), ['cursor', 'grok', 'pi']);
  assert.equal(parseAgents([]), null);
  assert.equal(parseAgents(['both']), null);
  assert.equal(parseAgents(['opencode']), null);
});

test('lists first-party models for the enabled agents', () => {
  const backends = resolveBackends({ agents: ['cursor', 'grok', 'pi'] });
  const catalog = catalogFor(backends);
  assert.deepEqual(
    catalog.map((entry) => entry.id),
    ['cursor', 'grok', 'pi'],
  );
  assert.equal(catalog[0].defaultModel, DEFAULT_CURSOR_MODEL);
  assert.ok(catalog[0].models.some((entry) => entry.id === DEFAULT_CURSOR_MODEL));
  assert.equal(catalog[1].defaultModel, DEFAULT_GROK_MODEL);
  assert.ok(catalog[1].models.some((entry) => entry.id === DEFAULT_GROK_MODEL));
  assert.equal(catalog[2].defaultModel, DEFAULT_PI_MODEL);
  assert.deepEqual(catalog[2].models, [{ id: DEFAULT_PI_MODEL, label: 'Pi default' }]);
});

test('accepts default or any provider/model for Pi and adds it to the catalog', () => {
  const model = 'openrouter/anthropic/claude-sonnet-5.5:high';
  const backends = resolveBackends({ agents: ['pi'], piModel: model });
  assert.equal(findModel('pi', DEFAULT_PI_MODEL).cli, null);
  assert.equal(findModel('pi', model).cli, model);
  for (const id of [
    'amazon-bedrock/amazon.nova-lite-v1:0',
    'cloudflare-workers-ai/@cf/meta/llama-3.1-8b-instruct',
    'verbose/~openai/gpt-sol-latest',
  ]) {
    assert.equal(findModel('pi', id).cli, id);
  }
  assert.equal(findModel('pi', 'not-a-model'), null);
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

test('builds Pi json-mode arguments with session-id and @image files', () => {
  assert.deepEqual(
    buildPiArgs({
      spec: { cli: 'openai/gpt-5.6:high' },
      resumeId: 'sess-123',
      prompt: '-n hi',
      imagePaths: ['/tmp/a.png'],
    }),
    ['--mode', 'json', '--approve', '--model', 'openai/gpt-5.6:high', '--session-id', 'sess-123', '--', '@/tmp/a.png', '-n hi'],
  );
});

test('omits --model for Pi default and escapes a leading-@ prompt', () => {
  const plan = spawnPlan({
    agent: 'pi',
    model: DEFAULT_PI_MODEL,
    force: true,
    resumeId: null,
    prompt: '@note hi',
    imagePaths: [],
    cwd: '/tmp',
  });
  assert.equal(plan.binKey, 'pi');
  assert.deepEqual(plan.args, ['--mode', 'json', '--approve', '--', ' @note hi']);
});

test('normalizes Pi thinking effort and passes --thinking when set', () => {
  assert.equal(normalizePiThinking(undefined), null);
  assert.equal(normalizePiThinking(null), null);
  assert.equal(normalizePiThinking('   '), null);
  assert.equal(normalizePiThinking(' HIGH '), 'high');
  assert.equal(normalizePiThinking('extreme'), undefined);

  const defaultModelWithThinking = spawnPlan({
    agent: 'pi',
    model: DEFAULT_PI_MODEL,
    thinking: 'high',
    resumeId: null,
    prompt: 'hi',
    imagePaths: [],
    cwd: '/tmp',
  });
  assert.deepEqual(defaultModelWithThinking.args, ['--mode', 'json', '--approve', '--thinking', 'high', '--', 'hi']);

  const namedModelWithThinking = spawnPlan({
    agent: 'pi',
    model: 'opencode-go/beam-free',
    thinking: 'medium',
    resumeId: null,
    prompt: 'hi',
    imagePaths: [],
    cwd: '/tmp',
  });
  assert.deepEqual(namedModelWithThinking.args, [
    '--mode',
    'json',
    '--approve',
    '--model',
    'opencode-go/beam-free',
    '--thinking',
    'medium',
    '--',
    'hi',
  ]);
});

test('reads Pi default model and thinking effort from global and project settings', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-pi-defaults-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agentDir = path.join(root, 'agent');
  const workdir = path.join(root, 'repo');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(path.join(workdir, '.pi'), { recursive: true });

  assert.deepEqual(readPiDefaults(workdir, { PI_CODING_AGENT_DIR: agentDir }), { model: '', thinking: '' });

  fs.writeFileSync(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({
      defaultProvider: 'opencode-go',
      defaultModel: 'iceman-contributor-free',
      defaultThinkingLevel: 'high',
    }),
  );
  assert.deepEqual(readPiDefaults(workdir, { PI_CODING_AGENT_DIR: agentDir }), {
    model: 'opencode-go/iceman-contributor-free',
    thinking: 'high',
  });

  fs.writeFileSync(
    path.join(workdir, '.pi', 'settings.json'),
    JSON.stringify({ defaultModel: 'beam-free', defaultThinkingLevel: 'medium' }),
  );
  assert.deepEqual(readPiDefaults(workdir, { PI_CODING_AGENT_DIR: agentDir }), {
    model: 'opencode-go/beam-free',
    thinking: 'medium',
  });
});

test('joins a slashed Pi model id and prefers that model\'s thinking level', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-pi-defaults-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agentDir = path.join(root, 'agent');
  const workdir = path.join(root, 'repo');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(path.join(workdir, '.pi'), { recursive: true });
  const modelId = '@cf/meta/llama-3.1-8b-instruct';
  const fullModel = `cloudflare-workers-ai/${modelId}`;

  fs.writeFileSync(
    path.join(agentDir, 'settings.json'),
    `\ufeff${JSON.stringify({
      defaultProvider: 'cloudflare-workers-ai',
      defaultModel: modelId,
      defaultThinkingLevel: 'high',
      modelThinkingLevels: {
        [fullModel]: 'low',
        'opencode-go/beam-free': 'xhigh',
      },
    })}`,
  );
  assert.deepEqual(readPiDefaults(workdir, { PI_CODING_AGENT_DIR: agentDir }), {
    model: fullModel,
    thinking: 'low',
  });

  fs.writeFileSync(
    path.join(workdir, '.pi', 'settings.json'),
    JSON.stringify({
      defaultProvider: '',
      modelThinkingLevels: { 'opencode-go/beam-free': 'extreme' },
    }),
  );
  assert.deepEqual(readPiDefaults(workdir, { PI_CODING_AGENT_DIR: agentDir }), {
    model: modelId,
    thinking: 'high',
  });

  fs.writeFileSync(path.join(agentDir, 'settings.json'), '{');
  fs.writeFileSync(
    path.join(workdir, '.pi', 'settings.json'),
    JSON.stringify({ defaultProvider: 'opencode-go', defaultModel: 'beam-free', defaultThinkingLevel: 'medium' }),
  );
  assert.deepEqual(readPiDefaults(workdir, { PI_CODING_AGENT_DIR: agentDir }), {
    model: 'opencode-go/beam-free',
    thinking: 'medium',
  });

  fs.rmSync(path.join(agentDir, 'settings.json'));
  fs.mkdirSync(path.join(agentDir, 'settings.json'));
  assert.throws(
    () => readPiDefaults(workdir, { PI_CODING_AGENT_DIR: agentDir }),
    (error) => error.code === 'EISDIR',
  );
});
