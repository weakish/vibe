import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bunAvailable,
  bundleIsComplete,
  bundleStaticAssets,
  isManifestStale,
  readStaticAssetsState,
  resolveStaticFile,
  sourceFingerprint,
  staticAssetsPath,
  writeStaticAssetsState,
} from '../src/static-assets.js';

test('static assets state defaults to development', async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-static-'));
  const state = await readStaticAssetsState(workdir);
  assert.equal(state.mode, 'dev');
  assert.equal(state.manifest, null);
});

test('release mode without a manifest falls back to development', async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-static-'));
  await writeStaticAssetsState(workdir, { mode: 'release', manifest: null });
  const state = await readStaticAssetsState(workdir);
  assert.equal(state.mode, 'dev');
  assert.equal(fs.statSync(staticAssetsPath(workdir)).mode & 0o777, 0o600);
});

test('source fingerprint changes when a public file changes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-fp-'));
  const app = path.join(root, 'public', 'app.js');
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
  fs.writeFileSync(app, 'export {};\n');
  fs.writeFileSync(path.join(root, 'public', 'styles.css'), 'body{}');
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(root, 'public', 'spec.html'), '<html></html>');
  fs.writeFileSync(path.join(root, 'public', 'app-shell.html'), '<div id="app"></div>');
  fs.writeFileSync(path.join(root, 'public', 'demo-shell.html'), '<div id="demo-settings"></div>');
  fs.writeFileSync(path.join(root, 'public', 'theme-init.js'), '');
  const before = await sourceFingerprint(root);
  await new Promise((resolve) => setTimeout(resolve, 5));
  fs.writeFileSync(app, 'export const x = 1;\n');
  const after = await sourceFingerprint(root);
  assert.notEqual(before, after);
});

test('resolveStaticFile maps release routes onto dist files', () => {
  const manifest = { fingerprint: 'abc', app: '/dist/app.js', spec: '/dist/spec.js', styles: '/dist/styles.css' };
  const state = { mode: 'release', manifest };
  assert.deepEqual(resolveStaticFile('/', state), {
    relativePath: 'public/dist/index.html',
    cache: 'no-cache',
  });
  assert.deepEqual(resolveStaticFile('/dist/app.js', state), {
    relativePath: 'public/dist/app.js',
    cache: 'immutable',
  });
  // Rewritten in place on every bundle, so never cached forever.
  assert.deepEqual(resolveStaticFile('/dist/index.html', state), {
    relativePath: 'public/dist/index.html',
    cache: 'no-cache',
  });
  assert.equal(resolveStaticFile('/app.js', state), null);
});

test('isManifestStale compares fingerprints', () => {
  assert.equal(isManifestStale({ fingerprint: 'a' }, 'a'), false);
  assert.equal(isManifestStale({ fingerprint: 'a' }, 'b'), true);
});

test('bundle is complete only when every manifest file and page is present', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-bundle-'));
  const dist = path.join(root, 'public', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const manifest = { fingerprint: 'abc', app: '/dist/app.js', spec: '/dist/spec.js', styles: '/dist/styles.css' };
  assert.equal(await bundleIsComplete(root, {}), false);
  assert.equal(await bundleIsComplete(root, manifest), false);
  for (const name of ['app.js', 'spec.js', 'styles.css', 'index.html', 'spec.html']) {
    fs.writeFileSync(path.join(dist, name), '');
  }
  assert.equal(await bundleIsComplete(root, manifest), true);
});

// A temp project with the real public/ pages, and a fake bun whose --version and build steps run as given.
function bundleFixture(t, buildScript) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(fileURLToPath(new URL('../public', import.meta.url)), path.join(root, 'public'), {
    recursive: true,
    filter: (src) => !['dist', '.bundle-staging'].includes(path.basename(src)),
  });
  const bun = path.join(root, 'fake-bun');
  fs.writeFileSync(
    bun,
    ['#!/bin/sh', 'if [ "$1" = "--version" ]; then echo 1.0.0; exit 0; fi', buildScript, ''].join('\n'),
  );
  fs.chmodSync(bun, 0o755);
  return { root, bun };
}

// Writes one hashed file per entry into the --outdir that bun is given.
const WRITE_OUTPUTS = [
  'outdir=""; prev=""',
  'for arg in "$@"; do if [ "$prev" = "--outdir" ]; then outdir="$arg"; fi; prev="$arg"; done',
  'mkdir -p "$outdir"',
  'echo app > "$outdir/app-1a2b3c.js"',
  'echo spec > "$outdir/spec-4d5e6f.js"',
  'echo styles > "$outdir/styles-7a8b9c.css"',
].join('\n');

test('bundles the real public pages with a stand-in bun and points them at the bundles', async (t) => {
  const { root, bun } = bundleFixture(t, WRITE_OUTPUTS);

  const manifest = await bundleStaticAssets({ projectRoot: root, bunBin: bun });

  assert.equal(manifest.app, '/dist/app-1a2b3c.js');
  assert.equal(manifest.spec, '/dist/spec-4d5e6f.js');
  assert.equal(manifest.styles, '/dist/styles-7a8b9c.css');
  assert.equal(manifest.fingerprint, await sourceFingerprint(root));
  assert.equal(await bundleIsComplete(root, manifest), true);
  assert.equal(fs.existsSync(path.join(root, 'public', '.bundle-staging')), false);
  const index = fs.readFileSync(path.join(root, 'public', 'dist', 'index.html'), 'utf8');
  assert.match(index, /href="\/dist\/styles-7a8b9c\.css"/);
  assert.match(index, /src="\/dist\/app-1a2b3c\.js"/);
  assert.doesNotMatch(index, /src="\/app\.js"/);
  const spec = fs.readFileSync(path.join(root, 'public', 'dist', 'spec.html'), 'utf8');
  assert.match(spec, /src="\/dist\/spec-4d5e6f\.js"/);
});

test('a failed publish puts the previous bundle back', async (t) => {
  const { root, bun } = bundleFixture(t, WRITE_OUTPUTS);
  const dist = path.join(root, 'public', 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'old.txt'), 'old');

  await assert.rejects(
    bundleStaticAssets({
      projectRoot: root,
      bunBin: bun,
      afterPublish() {
        throw new Error('could not save static assets state');
      },
    }),
    { message: 'could not save static assets state' },
  );

  assert.equal(fs.readFileSync(path.join(dist, 'old.txt'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(dist, 'app-1a2b3c.js')), false);
  assert.equal(fs.existsSync(`${dist}.previous`), false);
  assert.equal(fs.existsSync(path.join(root, 'public', '.bundle-staging')), false);
});

test('a failed first publish leaves no dist behind', async (t) => {
  const { root, bun } = bundleFixture(t, WRITE_OUTPUTS);

  await assert.rejects(
    bundleStaticAssets({
      projectRoot: root,
      bunBin: bun,
      afterPublish() {
        throw new Error('could not save static assets state');
      },
    }),
    { message: 'could not save static assets state' },
  );

  assert.equal(fs.existsSync(path.join(root, 'public', 'dist')), false);
  assert.equal(fs.existsSync(path.join(root, 'public', 'dist.previous')), false);
});

test('stops a bun build that never finishes instead of holding the lock', async (t) => {
  // exec replaces the shell, so the kill reaches the process that holds the pipes open.
  const { root, bun } = bundleFixture(t, 'exec sleep 60');

  await assert.rejects(
    bundleStaticAssets({ projectRoot: root, bunBin: bun, logger: { error() {} }, timeoutMs: 200 }),
    { name: 'BundleError', message: 'Bundling failed.' },
  );
  assert.equal(fs.existsSync(path.join(root, 'public', 'dist')), false);
});

test('a bun build that exits cleanly is not failed by a stray process holding stderr', async (t) => {
  // The background sleep inherits bun's stderr, so that pipe stays open after bun has exited.
  const { root, bun } = bundleFixture(t, `${WRITE_OUTPUTS}\nsleep 3 &`);

  const manifest = await bundleStaticAssets({ projectRoot: root, bunBin: bun, timeoutMs: 1000 });
  assert.equal(manifest.app, '/dist/app-1a2b3c.js');
});

test('reports a failing bun build with its complete stderr', async (t) => {
  const { root, bun } = bundleFixture(t, 'echo "no entry point" >&2\nexit 3');
  const logged = [];

  await assert.rejects(
    bundleStaticAssets({ projectRoot: root, bunBin: bun, logger: { error: (line) => logged.push(line) } }),
    { name: 'BundleError', message: 'Bundling failed.' },
  );
  assert.match(logged.join('\n'), /no entry point/);
});

test('a bun binary that never answers --version counts as missing', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-bun-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bun = path.join(root, 'hung-bun');
  fs.writeFileSync(bun, '#!/bin/sh\nexec sleep 60\n');
  fs.chmodSync(bun, 0o755);

  assert.equal(await bunAvailable(bun, { timeoutMs: 200 }), false);
});

test('no bun binary configured reports bun as missing before touching the project', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-no-bun-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(await bunAvailable(undefined), false);
  await assert.rejects(bundleStaticAssets({ projectRoot: root, bunBin: undefined }), {
    name: 'BundleError',
    message: 'Bun was not found on the server.',
  });
  assert.equal(fs.existsSync(path.join(root, 'public')), false);
});
