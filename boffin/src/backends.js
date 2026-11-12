export const CURSOR = 'cursor';
export const GROK = 'grok';
export const DEFAULT_CURSOR_MODEL = 'composer-2.5';
export const DEFAULT_GROK_MODEL = 'grok-4.7/high';
export const DEFAULT_GROK_BIN = 'grok';

const CURSOR_MODELS = [{ id: DEFAULT_CURSOR_MODEL, label: 'Composer 2.5', cli: DEFAULT_CURSOR_MODEL }];

const GROK_MODELS = [
  { id: 'grok-4.7/high', label: 'Grok 4.7 High', cli: 'grok-4.7', effort: 'high' },
  { id: 'grok-4.7/medium', label: 'Grok 4.7 Medium', cli: 'grok-4.7', effort: 'medium' },
  { id: 'grok-4.7/low', label: 'Grok 4.7 Low', cli: 'grok-4.7', effort: 'low' },
  { id: 'grok-4.7-build-fast', label: 'Grok 4.7 Build Fast', cli: 'grok-4.7-build-fast' },
  { id: 'grok-4.6', label: 'Grok 4.6', cli: 'grok-4.6' },
  { id: 'grok-4.5', label: 'Grok 4.5', cli: 'grok-4.5' },
];

const CATALOG = {
  [CURSOR]: { id: CURSOR, models: CURSOR_MODELS, defaultModel: DEFAULT_CURSOR_MODEL },
  [GROK]: { id: GROK, models: GROK_MODELS, defaultModel: DEFAULT_GROK_MODEL },
};

export function parseAgents(value) {
  if (value === undefined) {
    return [CURSOR];
  }
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const ids = [];
  for (const entry of value) {
    if (entry !== CURSOR && entry !== GROK) {
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
  agentBin = 'agent',
  grokBin = DEFAULT_GROK_BIN,
  force = true,
} = {}) {
  const ids = parseAgents(agents) ?? [CURSOR];
  const defaults = {
    [CURSOR]: model,
    [GROK]: grokModel,
  };
  for (const id of ids) {
    if (!findModel(id, defaults[id])) {
      return null;
    }
  }
  return {
    ids,
    force,
    bins: { [CURSOR]: agentBin, [GROK]: grokBin },
    defaults,
  };
}

export function findModel(agent, modelId) {
  return CATALOG[agent]?.models.find((entry) => entry.id === modelId) ?? null;
}

export function defaultModelId(agent, backends) {
  return backends.defaults[agent] ?? CATALOG[agent].defaultModel;
}

export function catalogFor(backends) {
  return backends.ids.map((id) => ({
    id,
    defaultModel: backends.defaults[id],
    models: CATALOG[id].models.map((entry) => ({ id: entry.id, label: entry.label })),
  }));
}

export function spawnPlan({ agent, model, force, resumeId, prompt, imagePaths = [], cwd }) {
  const spec = findModel(agent, model);
  if (!spec) {
    throw new Error(`Unknown model ${model} for ${agent}.`);
  }
  if (agent === GROK) {
    return { binKey: GROK, args: buildGrokArgs({ spec, force, resumeId, prompt, cwd }) };
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
