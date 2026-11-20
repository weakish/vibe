import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  UPDATE_NOT_AVAILABLE,
  UPDATE_NOT_FAST_FORWARD,
  UpdateError,
  classifyProjectChanges,
  inspectRepoUpdate,
  isPublicHttpsRepoUrl,
  isValidRepoBranch,
  pullRepoUpdate,
} from '../src/repo-update.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-update-'));
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim();
}

function makeFakeGit(dir, realUpstreamPath, { failOn = null } = {}) {
  const script = path.join(dir, failOn ? `fake-git-${failOn}.js` : 'fake-git.js');
  const failCheck = failOn
    ? `if (args.includes(${JSON.stringify(failOn)})) { console.error('forced failure'); process.exit(1); }\n`
    : '';
  fs.writeFileSync(
    script,
    `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const upstream = ${JSON.stringify(realUpstreamPath)};
const args = process.argv.slice(2).map((arg) => (arg.startsWith('https://') ? upstream : arg));
${failCheck}const result = spawnSync('git', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`,
    { mode: 0o755 },
  );
  return script;
}

test('validates public HTTPS repository URLs and branch names', () => {
  assert.equal(isPublicHttpsRepoUrl('https://origin.cursor.com/weakish/vibe.git'), true);
  assert.equal(isPublicHttpsRepoUrl('http://origin.cursor.com/weakish/vibe.git'), false);
  assert.equal(isPublicHttpsRepoUrl('git@origin.cursor.com:weakish/vibe.git'), false);
  assert.equal(isPublicHttpsRepoUrl('https://user:pass@origin.cursor.com/weakish/vibe.git'), false);
  assert.equal(isPublicHttpsRepoUrl('https://token@origin.cursor.com/weakish/vibe.git'), false);
  assert.equal(isPublicHttpsRepoUrl('https://origin.cursor.com/'), false);
  assert.equal(isPublicHttpsRepoUrl(''), false);

  assert.equal(isValidRepoBranch('main'), true);
  assert.equal(isValidRepoBranch('release/1.0'), true);
  assert.equal(isValidRepoBranch('-u'), false);
  assert.equal(isValidRepoBranch('a..b'), false);
  assert.equal(isValidRepoBranch('main.lock'), false);
  assert.equal(isValidRepoBranch('a b'), false);
});

test('inspectRepoUpdate requires a git repo and a public HTTPS repo_url or origin remote', async () => {
  const nonRepo = tempDir();
  assert.equal((await inspectRepoUpdate({ workdir: nonRepo, repoUrl: 'https://example.com/a/b.git' })).enabled, false);

  const repo = tempDir();
  git(repo, 'init', '-b', 'main');
  assert.equal((await inspectRepoUpdate({ workdir: repo })).enabled, false);

  git(repo, 'remote', 'add', 'origin', 'git@github.com:weakish/vibe.git');
  assert.equal((await inspectRepoUpdate({ workdir: repo })).enabled, false);
  assert.equal(
    (await inspectRepoUpdate({ workdir: repo, repoUrl: 'https://origin.cursor.com/weakish/vibe.git' })).enabled,
    true,
  );

  git(repo, 'remote', 'set-url', 'origin', 'https://origin.cursor.com/weakish/vibe.git');
  const sub = path.join(repo, 'boffin');
  fs.mkdirSync(sub);
  const inspected = await inspectRepoUpdate({ workdir: sub });
  assert.equal(inspected.enabled, true);
  assert.equal(inspected.repoUrl, 'https://origin.cursor.com/weakish/vibe.git');
});

test('classifyProjectChanges distinguishes other subprojects, public-only edits, and server edits', () => {
  assert.deepEqual(classifyProjectChanges('/repo', '/repo/boffin', ['thai-time/README.md'], '1234567'), {
    updated: true,
    restart: false,
    rebuildBundle: false,
    head: '1234567',
  });
  assert.deepEqual(classifyProjectChanges('/repo', '/repo/boffin', ['boffin/public/app.js'], '1234567'), {
    updated: true,
    restart: false,
    rebuildBundle: true,
    head: '1234567',
  });
  assert.deepEqual(classifyProjectChanges('/repo', '/repo/boffin', ['boffin/README.md'], '1234567'), {
    updated: true,
    restart: false,
    rebuildBundle: false,
    head: '1234567',
  });
  assert.deepEqual(classifyProjectChanges('/repo', '/repo/boffin', ['boffin/shared/default-spec.js'], '1234567'), {
    updated: true,
    restart: true,
    rebuildBundle: true,
    head: '1234567',
  });
  assert.deepEqual(classifyProjectChanges('/repo', '/repo/boffin', ['boffin/src/server.js'], '1234567'), {
    updated: true,
    restart: true,
    rebuildBundle: false,
    head: '1234567',
  });
});

test('pullRepoUpdate discards local edits, fast-forwards, and aborts on diverged history', async () => {
  const base = tempDir();
  const upstream = path.join(base, 'upstream');
  const clone = path.join(base, 'clone');
  fs.mkdirSync(path.join(upstream, 'boffin', 'src'), { recursive: true });
  fs.mkdirSync(path.join(upstream, 'boffin', 'public'), { recursive: true });
  fs.writeFileSync(path.join(upstream, 'boffin', 'src', 'a.js'), 'v1\n');
  fs.writeFileSync(path.join(upstream, 'boffin', 'public', 'p.js'), 'p1\n');
  git(upstream, 'init', '-b', 'main');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-m', 'init');

  git(base, 'clone', upstream, clone);
  const workdir = path.join(clone, 'boffin');
  git(clone, 'remote', 'set-url', 'origin', 'https://origin.cursor.com/weakish/vibe.git');
  const fakeGit = makeFakeGit(base, upstream);

  // Dirty tracked file is overridden; already up to date reports updated: false.
  fs.writeFileSync(path.join(workdir, 'src', 'a.js'), 'dirty\n');
  const noop = await pullRepoUpdate({
    workdir,
    projectRoot: workdir,
    gitBin: fakeGit,
    logger: { error() {} },
  });
  assert.equal(noop.updated, false);
  assert.equal(noop.restart, false);
  assert.equal(fs.readFileSync(path.join(workdir, 'src', 'a.js'), 'utf8'), 'v1\n');

  // Public-only commit updates without requiring a restart.
  fs.writeFileSync(path.join(upstream, 'boffin', 'public', 'p.js'), 'p2\n');
  git(upstream, 'commit', '-am', 'public change');
  const publicOnly = await pullRepoUpdate({
    workdir,
    projectRoot: workdir,
    gitBin: fakeGit,
    logger: { error() {} },
  });
  assert.equal(publicOnly.updated, true);
  assert.equal(publicOnly.restart, false);
  assert.equal(publicOnly.rebuildBundle, true);
  assert.equal(fs.readFileSync(path.join(workdir, 'public', 'p.js'), 'utf8'), 'p2\n');

  // Server commit requires a restart.
  fs.writeFileSync(path.join(upstream, 'boffin', 'src', 'a.js'), 'v2\n');
  git(upstream, 'commit', '-am', 'server change');
  const serverChange = await pullRepoUpdate({
    workdir,
    projectRoot: workdir,
    gitBin: fakeGit,
    logger: { error() {} },
  });
  assert.equal(serverChange.updated, true);
  assert.equal(serverChange.restart, true);

  // A diverged branch refuses the fast-forward and keeps uncommitted edits.
  fs.writeFileSync(path.join(workdir, 'src', 'a.js'), 'local-commit\n');
  git(clone, 'commit', '-am', 'local');
  fs.writeFileSync(path.join(workdir, 'src', 'a.js'), 'still-dirty\n');
  fs.writeFileSync(path.join(upstream, 'boffin', 'src', 'a.js'), 'v3\n');
  git(upstream, 'commit', '-am', 'upstream v3');

  await assert.rejects(
    () =>
      pullRepoUpdate({
        workdir,
        projectRoot: workdir,
        gitBin: fakeGit,
        logger: { error() {} },
      }),
    (error) => error instanceof UpdateError && error.status === 409 && error.message === UPDATE_NOT_FAST_FORWARD,
  );
  assert.equal(fs.readFileSync(path.join(workdir, 'src', 'a.js'), 'utf8'), 'still-dirty\n');

  const failFetch = makeFakeGit(base, upstream, { failOn: 'fetch' });
  await assert.rejects(
    () =>
      pullRepoUpdate({
        workdir,
        projectRoot: workdir,
        gitBin: failFetch,
        logger: { error() {} },
      }),
    (error) => error instanceof UpdateError && error.status === 502,
  );
  assert.equal(fs.readFileSync(path.join(workdir, 'src', 'a.js'), 'utf8'), 'still-dirty\n');

  await assert.rejects(
    () =>
      pullRepoUpdate({
        workdir: tempDir(),
        gitBin: fakeGit,
        logger: { error() {} },
      }),
    (error) => error instanceof UpdateError && error.status === 400 && error.message === UPDATE_NOT_AVAILABLE,
  );
});
