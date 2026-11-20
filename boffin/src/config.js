import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CURSOR,
  DEFAULT_CURSOR_MODEL,
  DEFAULT_GROK_BIN,
  DEFAULT_GROK_MODEL,
  DEFAULT_PI_BIN,
  DEFAULT_PI_MODEL,
  GROK,
  PI,
  findModel,
  parseAgents,
} from './backends.js';
import { isPublicHttpsRepoUrl, isValidRepoBranch } from './repo-update.js';

const KNOWN_KEYS = new Set([
  'host',
  'port',
  'model',
  'grok_model',
  'pi_model',
  'agents',
  'agent_bin',
  'grok_bin',
  'pi_bin',
  'force',
  'username',
  'password',
  'state_file',
  'bun_bin',
  'repo_url',
  'repo_branch',
]);
const MIN_PASSWORD_LENGTH = 8;
const PLACEHOLDER_USERNAME = 'your-username';
const PLACEHOLDER_PASSWORD_PREFIX = 'replace-with-';
const DEFAULT_MODEL = DEFAULT_CURSOR_MODEL;
const DEFAULT_USERNAME = 'boffin';
export const DEFAULT_BUN_BIN = 'bun';
export const DEFAULT_REPO_BRANCH = 'main';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(workdirInput, env = process.env) {
  if (env.BOFFIN_CONFIG?.trim()) {
    throw new ConfigError(
      'BOFFIN_CONFIG is no longer supported. Pass the workdir as the first argument. The config file is config.json in that directory.',
    );
  }
  if (env.BOFFIN_ACCESS_TOKEN?.trim()) {
    throw new ConfigError(
      'BOFFIN_ACCESS_TOKEN is no longer supported. Set BOFFIN_USERNAME and BOFFIN_PASSWORD instead.',
    );
  }

  const workdir = resolveWorkdir(workdirInput);
  ensureWorkdir(workdir);
  const configFile = path.join(workdir, 'config.json');
  let created = false;
  if (!fs.existsSync(configFile)) {
    const generated = defaultConfig(env);
    materialize(generated, workdir, env);
    try {
      writeConfigFile(configFile, generated);
      created = true;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new ConfigError(`Cannot create config file ${configFile}: ${error.message}`);
      }
    }
  }

  const raw = readConfigObject(configFile);
  return Object.freeze({ ...materialize(raw, workdir, env), configFile, created });
}

// Reads only bun_bin, so a build script beside the server never creates or validates config.json.
export function readBunBin(workdirInput) {
  const configFile = path.join(resolveWorkdir(workdirInput), 'config.json');
  if (!fs.existsSync(configFile)) {
    return DEFAULT_BUN_BIN;
  }
  return optionalString(readConfigObject(configFile), 'bun_bin', DEFAULT_BUN_BIN);
}

function defaultConfig(env) {
  return {
    host: '0.0.0.0',
    port: 8080,
    model: DEFAULT_MODEL,
    agent_bin: 'agent',
    bun_bin: DEFAULT_BUN_BIN,
    force: true,
    username: env.BOFFIN_USERNAME?.trim() || DEFAULT_USERNAME,
    password: env.BOFFIN_PASSWORD || randomBytes(18).toString('base64url'),
    state_file: 'data/state.json',
  };
}

function materialize(raw, workdir, env) {
  if (Object.hasOwn(raw, 'access_token')) {
    throw new ConfigError(
      `access_token in ${path.join(workdir, 'config.json')} is no longer supported. Replace it with "username" and "password".`,
    );
  }
  if (Object.hasOwn(raw, 'workdir')) {
    throw new ConfigError(
      `workdir in ${path.join(workdir, 'config.json')} is no longer a setting. The config file's directory is the workdir.`,
    );
  }
  const unknown = Object.keys(raw).filter((key) => !KNOWN_KEYS.has(key));
  if (unknown.length > 0) {
    throw new ConfigError(`Unknown setting(s) in ${path.join(workdir, 'config.json')}: ${unknown.join(', ')}`);
  }

  const username = env.BOFFIN_USERNAME?.trim() || requiredString(raw, 'username');
  if (username.includes(':')) {
    throw new ConfigError('"username" must not contain a colon (it is sent as HTTP Basic authentication).');
  }
  if (username === PLACEHOLDER_USERNAME) {
    throw new ConfigError('username is still the placeholder from config.example.json. Replace it.');
  }

  const password = readPassword(raw, env);

  const model = requiredString(raw, 'model');
  const grokModel = optionalString(raw, 'grok_model', DEFAULT_GROK_MODEL);
  const piModel = optionalString(raw, 'pi_model', DEFAULT_PI_MODEL);
  if (!findModel(CURSOR, model)) {
    throw new ConfigError(`"${model}" is not a first-party Cursor model.`);
  }
  if (!findModel(GROK, grokModel)) {
    throw new ConfigError(`"${grokModel}" is not a first-party Grok model.`);
  }
  if (!findModel(PI, piModel)) {
    throw new ConfigError(`"${piModel}" is not "default" or a Pi provider/model id.`);
  }
  const repoUrl = raw.repo_url === undefined ? null : requiredString(raw, 'repo_url');
  if (repoUrl !== null && !isPublicHttpsRepoUrl(repoUrl)) {
    throw new ConfigError('"repo_url" must be a public https:// repository URL without credentials.');
  }
  const repoBranch = optionalString(raw, 'repo_branch', DEFAULT_REPO_BRANCH);
  if (!isValidRepoBranch(repoBranch)) {
    throw new ConfigError('"repo_branch" is not a valid git branch name.');
  }

  return {
    host: optionalString(raw, 'host', '0.0.0.0'),
    port: optionalPort(raw, 'port', 8080),
    workdir,
    model,
    grokModel,
    piModel,
    agents: readAgents(raw),
    agentBin: optionalString(raw, 'agent_bin', 'agent'),
    grokBin: optionalString(raw, 'grok_bin', DEFAULT_GROK_BIN),
    piBin: optionalString(raw, 'pi_bin', DEFAULT_PI_BIN),
    bunBin: optionalString(raw, 'bun_bin', DEFAULT_BUN_BIN),
    repoUrl,
    repoBranch,
    force: optionalBoolean(raw, 'force', true),
    username,
    password,
    stateFile: resolveAgainst(workdir, optionalString(raw, 'state_file', 'data/state.json')),
  };
}

function writeConfigFile(file, raw) {
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.chmodSync(file, 0o600);
}

function readConfigObject(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new ConfigError(`Cannot read config file ${file}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`Config file ${file} is not valid JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`Config file ${file} must contain a JSON object.`);
  }
  return parsed;
}

function requiredString(raw, key) {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`"${key}" must be a non-empty string.`);
  }
  return value.trim();
}

function readPassword(raw, env) {
  let password;
  if (env.BOFFIN_PASSWORD) {
    password = env.BOFFIN_PASSWORD;
  } else if (raw.password === undefined) {
    return null;
  } else {
    password = requiredSecret(raw, 'password');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ConfigError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }
  if (password.startsWith(PLACEHOLDER_PASSWORD_PREFIX)) {
    throw new ConfigError('password is still the placeholder from config.example.json. Replace it.');
  }
  return password;
}

function requiredSecret(raw, key) {
  const value = raw[key];
  if (typeof value !== 'string' || value === '') {
    throw new ConfigError(`"${key}" must be a non-empty string.`);
  }
  return value;
}

function readAgents(raw) {
  if (raw.agents === undefined) {
    return [CURSOR];
  }
  const ids = parseAgents(raw.agents);
  if (!ids) {
    throw new ConfigError('"agents" must be a non-empty array of "cursor", "grok", and/or "pi".');
  }
  return ids;
}

function optionalString(raw, key, fallback) {
  return raw[key] === undefined ? fallback : requiredString(raw, key);
}

function optionalBoolean(raw, key, fallback) {
  if (raw[key] === undefined) {
    return fallback;
  }
  if (typeof raw[key] !== 'boolean') {
    throw new ConfigError(`"${key}" must be true or false.`);
  }
  return raw[key];
}

function optionalPort(raw, key, fallback) {
  const value = raw[key] === undefined ? fallback : raw[key];
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ConfigError(`"${key}" must be a port number between 1 and 65535.`);
  }
  return value;
}

function resolveWorkdir(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError('workdir must be a non-empty string.');
  }
  const expanded = value === '~' || value.startsWith('~/') ? path.join(os.homedir(), value.slice(1)) : value.trim();
  return path.resolve(expanded);
}

function resolveAgainst(baseDir, value) {
  const expanded = value === '~' || value.startsWith('~/') ? path.join(os.homedir(), value.slice(1)) : value;
  return path.resolve(baseDir, expanded);
}

function ensureWorkdir(target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new ConfigError(`Cannot access workdir ${target}: ${error.message}`);
    }
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch (mkdirError) {
      throw new ConfigError(`Cannot create workdir ${target}: ${mkdirError.message}`);
    }
    return;
  }
  if (!stat.isDirectory()) {
    throw new ConfigError(`workdir is not a directory: ${target}`);
  }
}
