import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertThemeInitPages, renderThemeInit } from './theme-init.js';

const STATE_VERSION = 1;
const STAGING_DIR = path.join('public', '.bundle-staging');
const DIST_DIR = path.join('public', 'dist');
const MANIFEST_NAME = 'manifest.json';
const BUN_BUILD_TIMEOUT_MS = 5 * 60 * 1000;
const BUN_CHECK_TIMEOUT_MS = 10 * 1000;

export class BundleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BundleError';
  }
}

export function defaultStaticAssetsState() {
  return { version: STATE_VERSION, mode: 'dev', manifest: null };
}

export function staticAssetsPath(workdir) {
  return path.join(workdir, 'data', 'static-assets.json');
}

export async function readStaticAssetsState(workdir) {
  const file = staticAssetsPath(workdir);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return defaultStaticAssetsState();
    }
    throw error;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new BundleError(`Static assets state ${file} is not valid JSON.`);
  }
  if (data.version !== STATE_VERSION) {
    throw new BundleError(
      `Static assets state ${file} is version ${JSON.stringify(data.version)}, expected ${STATE_VERSION}.`,
    );
  }
  const mode = data.mode === 'release' ? 'release' : 'dev';
  const manifest = data.manifest && typeof data.manifest === 'object' ? data.manifest : null;
  if (mode === 'release' && !manifest) {
    return defaultStaticAssetsState();
  }
  return { version: STATE_VERSION, mode, manifest };
}

export async function writeStaticAssetsState(workdir, state) {
  const file = staticAssetsPath(workdir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const payload = {
    version: STATE_VERSION,
    mode: state.mode === 'release' ? 'release' : 'dev',
    manifest: state.mode === 'release' ? state.manifest : null,
  };
  const tmp = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

export async function sourceFingerprint(projectRoot) {
  const files = await listSourceFiles(projectRoot);
  const hash = createHash('sha256');
  for (const file of files) {
    const stat = await fs.stat(file);
    hash.update(file.slice(projectRoot.length));
    hash.update('\0');
    hash.update(String(stat.mtimeMs));
    hash.update('\0');
    hash.update(String(stat.size));
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function isManifestStale(manifest, currentFingerprint) {
  return !manifest || manifest.fingerprint !== currentFingerprint;
}

export function bundleFileNames(manifest) {
  return [manifest.app, manifest.spec, manifest.styles]
    .filter((url) => typeof url === 'string')
    .map((url) => path.basename(url));
}

export async function bundleIsComplete(projectRoot, manifest) {
  if (![manifest.app, manifest.spec, manifest.styles].every((url) => typeof url === 'string')) {
    return false;
  }
  for (const name of [...bundleFileNames(manifest), 'index.html', 'spec.html']) {
    try {
      const stat = await fs.lstat(path.join(projectRoot, DIST_DIR, name));
      if (!stat.isFile()) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

export async function bundleStaticAssets({
  projectRoot,
  bunBin,
  logger = console,
  timeoutMs = BUN_BUILD_TIMEOUT_MS,
  afterPublish,
}) {
  if (!(await bunAvailable(bunBin))) {
    throw new BundleError('Bun was not found on the server.');
  }
  const staging = path.join(projectRoot, STAGING_DIR);
  const dist = path.join(projectRoot, DIST_DIR);
  // Taken before the build, so edits made while bun runs leave the bundle stale.
  const fingerprint = await sourceFingerprint(projectRoot);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });

  const entries = [
    path.join(projectRoot, 'public', 'landing.js'),
    path.join(projectRoot, 'public', 'spec.js'),
    path.join(projectRoot, 'public', 'styles.css'),
  ];
  await runBunBuild(bunBin, entries, staging, logger, timeoutMs);

  const outputs = await fs.readdir(staging);
  const appFile = outputs.find((name) => /^landing-.*\.js$/.test(name));
  const specFile = outputs.find((name) => /^spec-.*\.js$/.test(name));
  const stylesFile = outputs.find((name) => /^styles-.*\.css$/.test(name));
  if (!appFile || !specFile || !stylesFile) {
    throw new BundleError(`Bundling produced unexpected output: ${outputs.join(', ') || '(empty)'}.`);
  }

  await writeBundledHtml(projectRoot, staging, { appFile, specFile, stylesFile });
  const manifest = {
    builtAt: new Date().toISOString(),
    fingerprint,
    app: `/dist/${appFile}`,
    spec: `/dist/${specFile}`,
    styles: `/dist/${stylesFile}`,
  };
  await fs.writeFile(path.join(staging, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // Keep the previous dist until the caller has recorded the new manifest. A failed
  // rename, or a failed afterPublish, puts that directory back.
  const backup = await placeDirectory(staging, dist);
  try {
    if (afterPublish) {
      await afterPublish(manifest);
    }
  } catch (error) {
    await restoreDirectory(dist, backup);
    throw error;
  }
  try {
    await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    // The new dist and manifest are already in place; a leftover backup must not fail the publish.
    logger.error(`[boffin] could not remove ${backup}: ${error.message}`);
  }

  return manifest;
}

export function resolveStaticFile(pathname, state) {
  if (state.mode === 'release' && state.manifest) {
    if (pathname === '/' || pathname === '/index.html') {
      return { relativePath: path.join(DIST_DIR, 'index.html'), cache: 'no-cache' };
    }
    if (pathname === '/spec' || pathname === '/spec.html') {
      return { relativePath: path.join(DIST_DIR, 'spec.html'), cache: 'no-cache' };
    }
    if (pathname.startsWith('/dist/')) {
      const suffix = pathname.slice('/dist/'.length);
      if (!suffix || suffix.includes('..') || suffix.includes('/') || suffix.includes('\\')) {
        return null;
      }
      if (!bundleFileNames(state.manifest).includes(suffix)) {
        return null;
      }
      return { relativePath: path.join(DIST_DIR, suffix), cache: 'immutable' };
    }
  }
  return null;
}

async function listSourceFiles(projectRoot) {
  const paths = new Set();
  const publicJs = await listDirFiles(path.join(projectRoot, 'public'), '.js');
  for (const file of publicJs) {
    paths.add(file);
  }
  const sharedJs = await listDirFiles(path.join(projectRoot, 'shared'), '.js');
  for (const file of sharedJs) {
    paths.add(file);
  }
  for (const name of ['styles.css', 'index.html', 'spec.html', 'app-shell.html', 'demo-shell.html']) {
    paths.add(path.join(projectRoot, 'public', name));
  }
  return [...paths].sort();
}

async function listDirFiles(dir, ext) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'dist.previous' || entry.name === '.bundle-staging') {
        continue;
      }
      files.push(...(await listDirFiles(full, ext)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(ext)) {
      files.push(full);
    }
  }
  return files;
}

// Moves staging onto dest. An existing dest is renamed aside first and restored if
// the move fails, so a half-finished publish never leaves dest missing.
async function placeDirectory(staging, dest) {
  const backup = `${dest}.previous`;
  await fs.rm(backup, { recursive: true, force: true });
  let moved = false;
  try {
    await fs.rename(dest, backup);
    moved = true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  try {
    await fs.rename(staging, dest);
  } catch (error) {
    if (moved) {
      await fs.rename(backup, dest);
    }
    throw error;
  }
  return backup;
}

async function restoreDirectory(dest, backup) {
  await fs.rm(dest, { recursive: true, force: true });
  try {
    await fs.rename(backup, dest);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function writeBundledHtml(projectRoot, staging, { appFile, specFile, stylesFile }) {
  const themeInit = await fs.readFile(path.join(projectRoot, 'public', 'theme-init.js'), 'utf8');
  const indexSource = await fs.readFile(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  const specSource = await fs.readFile(path.join(projectRoot, 'public', 'spec.html'), 'utf8');
  try {
    assertThemeInitPages({ 'index.html': indexSource, 'spec.html': specSource }, themeInit);
  } catch (error) {
    throw new BundleError(error.message);
  }
  const index = renderThemeInit(patchHtml(indexSource, {
    styles: `/dist/${stylesFile}`,
    script: `/dist/${appFile}`,
  }), themeInit);
  const spec = renderThemeInit(patchHtml(specSource, {
    styles: `/dist/${stylesFile}`,
    script: `/dist/${specFile}`,
  }), themeInit);
  await fs.writeFile(path.join(staging, 'index.html'), index, 'utf8');
  await fs.writeFile(path.join(staging, 'spec.html'), spec, 'utf8');
}

function patchHtml(source, { styles, script }) {
  const stylesheet = /<link rel="stylesheet" href="\/styles\.css" \/>/;
  const moduleScript = /<script type="module" src="\/(?:landing|spec)\.js"><\/script>/;
  if (!stylesheet.test(source) || !moduleScript.test(source)) {
    throw new BundleError('Could not find the stylesheet or module script to bundle.');
  }
  return source
    .replace(stylesheet, `<link rel="stylesheet" href="${styles}" />`)
    .replace(moduleScript, `<script type="module" src="${script}"></script>`);
}

function runBunBuild(bunBin, entries, outdir, logger, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = [
      'build',
      ...entries,
      '--outdir',
      outdir,
      '--minify',
      '--entry-naming',
      '[name]-[hash].[ext]',
    ];
    // stdout is unused; a piped stdout that nobody reads can block bun.
    const child = spawn(bunBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    // A clean exit settles on 'exit': close also waits for stderr to end, so a process that inherited it
    // must not fail a finished build. Failures wait for 'close' so the logged stderr is complete.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      logger.error(`[boffin] bun build did not finish within ${timeoutMs / 1000}s and was killed.`);
      reject(new BundleError('Bundling failed.'));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut || code === 0) {
        return;
      }
      logger.error(`[boffin] bun build failed: ${stderr.trim()}`);
      reject(new BundleError('Bundling failed.'));
    });
  });
}

export async function bunAvailable(bunBin, { timeoutMs = BUN_CHECK_TIMEOUT_MS } = {}) {
  if (!bunBin) {
    return false;
  }
  return new Promise((resolve) => {
    const child = spawn(bunBin, ['--version'], { stdio: 'ignore' });
    // A binary that never answers --version must not hold the bundling lock.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
