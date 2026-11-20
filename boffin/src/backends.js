import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CURSOR = 'cursor';
export const GROK = 'grok';
export const PI = 'pi';
export const DEFAULT_CURSOR_MODEL = 'composer-2.5';
export const DEFAULT_GROK_MODEL = 'grok-4.7/high';
export const DEFAULT_PI_MODEL = 'default';
export const DEFAULT_GROK_BIN = 'grok';
export const DEFAULT_PI_BIN = 'pi';

const CURSOR_MODELS = [{ id: DEFAULT_CURSOR_MODEL, label: 'Composer 2.5', cli: DEFAULT_CURSOR_MODEL }];

const GROK_MODELS = [
  { id: 'grok-4.7/high', label: 'Grok 4.7 High', cli: 'grok-4.7', effort: 'high' },
  { id: 'grok-4.7/medium', label: 'Grok 4.7 Medium', cli: 'grok-4.7', effort: 'medium' },
  { id: 'grok-4.7/low', label: 'Grok 4.7 Low', cli: 'grok-4.7', effort: 'low' },
  { id: 'grok-4.7-build-fast', label: 'Grok 4.7 Build Fast', cli: 'grok-4.7-build-fast' },
  { id: 'grok-4.6', label: 'Grok 4.6', cli: 'grok-4.6' },
  { id: 'grok-4.5', label: 'Grok 4.5', cli: 'grok-4.5' },
];

// `default` runs Pi without --model, so Pi uses its own configured default model.
const PI_MODELS = [{ id: DEFAULT_PI_MODEL, label: 'Pi default', cli: null }];

const CATALOG = {
  [CURSOR]: { id: CURSOR, models: CURSOR_MODELS, defaultModel: DEFAULT_CURSOR_MODEL },
  [GROK]: { id: GROK, models: GROK_MODELS, defaultModel: DEFAULT_GROK_MODEL },
  [PI]: { id: PI, models: PI_MODELS, defaultModel: DEFAULT_PI_MODEL },
};

// Pi runs models from any provider it is logged in to. Ids are provider/model and
// may carry a thinking suffix (openai/gpt-5.6:high) or punctuation such as the
// colon in Amazon Bedrock's amazon.nova-lite-v1:0.
const PI_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[^\s]+$/;
export const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function normalizePiThinking(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return PI_THINKING_LEVELS.includes(normalized) ? normalized : undefined;
}

// Missing and invalid JSON match Pi, which skips that file. Other read errors
// propagate so a placeholder cannot hide an unreadable settings path.
function readPiSettingsFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function takePiSettingsString(parsed, key) {
  if (!Object.hasOwn(parsed, key)) {
    return undefined;
  }
  const value = parsed[key];
  return typeof value === 'string' ? value.trim() : '';
}

// Pi deep-merges this object. A non-object replaces it, so later lookups miss.
// An invalid level drops that key and the placeholder falls back to the default level.
function applyPiModelThinkingLevels(target, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    for (const key of Object.keys(target)) {
      delete target[key];
    }
    return;
  }
  for (const [key, level] of Object.entries(value)) {
    const normalized = normalizePiThinking(level);
    if (normalized) {
      target[key] = normalized;
    } else {
      delete target[key];
    }
  }
}

export function readPiDefaults(workdir, env = process.env) {
  const agentDir = env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), '.pi', 'agent');
  const files = [path.join(agentDir, 'settings.json')];
  if (workdir) {
    files.push(path.join(workdir, '.pi', 'settings.json'));
  }
  let provider = '';
  let model = '';
  let thinking = '';
  const modelThinkingLevels = {};
  for (const file of files) {
    const parsed = readPiSettingsFile(file);
    if (!parsed) {
      continue;
    }
    const nextProvider = takePiSettingsString(parsed, 'defaultProvider');
    if (nextProvider !== undefined) {
      provider = nextProvider;
    }
    const nextModel = takePiSettingsString(parsed, 'defaultModel');
    if (nextModel !== undefined) {
      model = nextModel;
    }
    if (Object.hasOwn(parsed, 'defaultThinkingLevel')) {
      thinking = normalizePiThinking(parsed.defaultThinkingLevel) || '';
    }
    if (Object.hasOwn(parsed, 'modelThinkingLevels')) {
      applyPiModelThinkingLevels(modelThinkingLevels, parsed.modelThinkingLevels);
    }
  }
  const fullModel = model ? (provider ? `${provider}/${model}` : model) : '';
  const modelLevel = fullModel ? modelThinkingLevels[fullModel] : '';
  return { model: fullModel, thinking: modelLevel || thinking };
}

export function parseAgents(value) {
  if (value === undefined) {
    return [CURSOR];
  }
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const ids = [];
  for (const entry of value) {
    if (entry !== CURSOR && entry !== GROK && entry !== PI) {
      return null;
    }
    if (!ids.includes(entry)) {
      ids.push(entry);
    }
  }
  return ids.length > 0 ? ids : null;
}

export function resolveBackends({
  agents,
  model = DEFAULT_CURSOR_MODEL,
  grokModel = DEFAULT_GROK_MODEL,
  piModel = DEFAULT_PI_MODEL,
  agentBin = 'agent',
  grokBin = DEFAULT_GROK_BIN,
  piBin = DEFAULT_PI_BIN,
  force = true,
} = {}) {
  const ids = parseAgents(agents) ?? [CURSOR];
  const defaults = {
    [CURSOR]: model,
    [GROK]: grokModel,
    [PI]: piModel,
  };
  for (const id of ids) {
    if (!findModel(id, defaults[id])) {
      return null;
    }
  }
  return {
    ids,
    force,
    bins: { [CURSOR]: agentBin, [GROK]: grokBin, [PI]: piBin },
    defaults,
  };
}

export function findModel(agent, modelId) {
  const found = CATALOG[agent]?.models.find((entry) => entry.id === modelId) ?? null;
  if (found || agent !== PI || typeof modelId !== 'string' || !PI_MODEL_ID.test(modelId)) {
    return found;
  }
  return { id: modelId, label: modelId, cli: modelId };
}

export function defaultModelId(agent, backends) {
  return backends.defaults[agent] ?? CATALOG[agent].defaultModel;
}

export function catalogFor(backends) {
  return backends.ids.map((id) => {
    const models = CATALOG[id].models.map((entry) => ({ id: entry.id, label: entry.label }));
    const defaultModel = backends.defaults[id];
    if (defaultModel && !models.some((entry) => entry.id === defaultModel)) {
      models.push({ id: defaultModel, label: defaultModel });
    }
    return { id, defaultModel, models };
  });
}

export function spawnPlan({ agent, model, thinking = null, force, resumeId, prompt, imagePaths = [], cwd }) {
  const spec = findModel(agent, model);
  if (!spec) {
    throw new Error(`Unknown model ${model} for ${agent}.`);
  }
  if (agent === GROK) {
    return { binKey: GROK, args: buildGrokArgs({ spec, force, resumeId, prompt, cwd }) };
  }
  if (agent === PI) {
    return { binKey: PI, args: buildPiArgs({ spec, thinking, resumeId, prompt, imagePaths }) };
  }
  return { binKey: CURSOR, args: buildCursorArgs({ spec, force, resumeId, prompt, imagePaths }) };
}

export function buildCursorArgs({ spec, force, resumeId, prompt, imagePaths = [] }) {
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--stream-partial-output',
    '--trust',
    '--model',
    spec.cli,
  ];
  if (force) {
    args.push('--force');
  }
  if (resumeId) {
    args.push('--resume', resumeId);
  }
  for (const imagePath of imagePaths) {
    args.push('--image', imagePath);
  }
  args.push('--', prompt);
  return args;
}

export function buildGrokArgs({ spec, force, resumeId, prompt, cwd }) {
  const args = [
    '--output-format',
    'streaming-json',
    '--cwd',
    cwd,
    '--model',
    spec.cli,
  ];
  if (spec.effort) {
    args.push('--reasoning-effort', spec.effort);
  }
  if (force) {
    args.push('--always-approve');
  }
  if (resumeId) {
    args.push('--resume', resumeId);
  }
  // `--single=<prompt>` keeps a message that starts with a dash from being parsed as a flag.
  args.push(`--single=${prompt}`);
  return args;
}

// Pi has no tool-approval flag, so `force` does not change these arguments.
// `--approve` loads the workdir's project resources; JSON mode otherwise skips
// them when Pi's trust default is ask. `--session-id` resumes the session or
// creates it when the earlier run left none on disk.
export function buildPiArgs({ spec, thinking = null, resumeId, prompt, imagePaths = [] }) {
  const args = ['--mode', 'json', '--approve'];
  if (spec.cli) {
    args.push('--model', spec.cli);
  }
  if (thinking) {
    args.push('--thinking', thinking);
  }
  if (resumeId) {
    args.push('--session-id', resumeId);
  }
  // After `--`, an argument that starts with @ is a file to attach, so every
  // image becomes one and a message starting with @ gets a leading space.
  args.push('--', ...imagePaths.map((imagePath) => `@${imagePath}`), prompt.startsWith('@') ? ` ${prompt}` : prompt);
  return args;
}
