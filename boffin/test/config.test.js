import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigError, loadConfig } from '../src/config.js';

const USER = 'tester';
const PASS = 'correct-horse';

function tempWorkdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-config-'));
}

function writeConfig(overrides = {}) {
  const workdir = tempWorkdir();
  const base = { model: 'composer-2.5', username: USER, password: PASS };
  fs.writeFileSync(path.join(workdir, 'config.json'), JSON.stringify({ ...base, ...overrides }));
  return workdir;
}

test('applies defaults and resolves paths relative to the workdir', () => {
  const workdir = writeConfig({ state_file: 'state/chat.json' });
  const config = loadConfig(workdir, {});

  assert.equal(config.workdir, workdir);
  assert.equal(config.configFile, path.join(workdir, 'config.json'));
  assert.equal(config.created, false);
  assert.equal(config.stateFile, path.join(workdir, 'state/chat.json'));
  assert.equal(config.model, 'composer-2.5');
  assert.equal(config.agentBin, 'agent');
  assert.equal(config.force, true);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 8080);
  assert.equal(config.username, USER);
  assert.equal(config.password, PASS);
});

test('BOFFIN_USERNAME and BOFFIN_PASSWORD override the file', () => {
  const workdir = writeConfig();
  const config = loadConfig(workdir, { BOFFIN_USERNAME: 'from-env', BOFFIN_PASSWORD: 'env-secret' });
  assert.equal(config.username, 'from-env');
  assert.equal(config.password, 'env-secret');
});

test('writes a config in the workdir when it is missing', () => {
  const workdir = tempWorkdir();
  const config = loadConfig(workdir, {});
  const file = path.join(workdir, 'config.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));

  assert.equal(config.created, true);
  assert.equal(config.configFile, file);
  assert.equal(saved.model, 'composer-2.5');
  assert.equal(saved.username, 'boffin');
  assert.equal(saved.password, config.password);
  assert.ok(saved.password.length >= 8);
  assert.equal(saved.state_file, 'data/state.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  const again = loadConfig(workdir, {});
  assert.equal(again.created, false);
  assert.equal(again.password, saved.password);
});

test('stores env credentials in a generated config', () => {
  const workdir = tempWorkdir();
  const config = loadConfig(workdir, { BOFFIN_USERNAME: 'from-env', BOFFIN_PASSWORD: 'env-secret' });
  const saved = JSON.parse(fs.readFileSync(config.configFile, 'utf8'));
  assert.equal(saved.username, 'from-env');
  assert.equal(saved.password, 'env-secret');
});

test('creates a missing workdir, then writes its config', () => {
  const parent = tempWorkdir();
  const workdir = path.join(parent, 'projects', 'empty');
  const config = loadConfig(workdir, {});
  assert.equal(config.workdir, workdir);
  assert.equal(config.created, true);
  assert.equal(fs.statSync(path.join(workdir, 'config.json')).isFile(), true);
});

test('rejects a workdir that is a file', () => {
  const parent = tempWorkdir();
  const file = path.join(parent, 'not-a-dir');
  fs.writeFileSync(file, 'x');
  assert.throws(() => loadConfig(file, {}), /not a directory/);
});

test('rejects unknown keys so typos are not silently ignored', () => {
  const workdir = writeConfig({ workdr: 'repo' });
  assert.throws(() => loadConfig(workdir, {}), /Unknown setting\(s\).*workdr/);
});

test('rejects a workdir setting inside the config file', () => {
  const workdir = writeConfig({ workdir: '/somewhere' });
  assert.throws(() => loadConfig(workdir, {}), /no longer a setting/);
});

test('rejects leftover access_token with a migration hint', () => {
  const workdir = writeConfig({ access_token: 'x'.repeat(24) });
  assert.throws(() => loadConfig(workdir, {}), /username.*password/);
});

test('rejects leftover BOFFIN_ACCESS_TOKEN with a migration hint', () => {
  const workdir = writeConfig();
  assert.throws(() => loadConfig(workdir, { BOFFIN_ACCESS_TOKEN: 'x'.repeat(24) }), /BOFFIN_USERNAME/);
  assert.equal(loadConfig(workdir, { BOFFIN_ACCESS_TOKEN: '   ' }).username, USER);
});

test('rejects leftover BOFFIN_CONFIG with a migration hint', () => {
  const workdir = writeConfig();
  assert.throws(() => loadConfig(workdir, { BOFFIN_CONFIG: '/old/config.json' }), /first argument/);
});

test('requires a model', () => {
  const workdir = writeConfig({ model: undefined });
  assert.throws(() => loadConfig(workdir, {}), /"model" must be a non-empty string/);
});

test('rejects usernames that contain a colon', () => {
  const workdir = writeConfig({ username: 'alice:bob' });
  assert.throws(() => loadConfig(workdir, {}), /must not contain a colon/);
});

test('rejects passwords that are too short', () => {
  const workdir = writeConfig({ password: 'short' });
  assert.throws(() => loadConfig(workdir, {}), /at least 8 characters/);
});

test('rejects placeholder credentials copied from config.example.json', () => {
  assert.throws(() => loadConfig(writeConfig({ username: 'your-username' }), {}), /still the placeholder/);
  assert.throws(() => loadConfig(writeConfig({ password: 'replace-with-a-strong-password' }), {}), /still the placeholder/);
});

test('keeps password whitespace that is not an empty string', () => {
  const workdir = writeConfig({ password: ' padded-secret ' });
  const config = loadConfig(workdir, {});
  assert.equal(config.password, ' padded-secret ');
});

test('validates port and force types', () => {
  assert.throws(() => loadConfig(writeConfig({ port: 70000 }), {}), /port number/);
  assert.throws(() => loadConfig(writeConfig({ force: 'yes' }), {}), /true or false/);
});
