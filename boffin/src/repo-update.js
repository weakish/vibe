import { spawn } from 'node:child_process';
import path from 'node:path';

const GIT_TIMEOUT_MS = 60 * 1000;
const GIT_CHECK_TIMEOUT_MS = 10 * 1000;
// A branch name cannot start with `-`, contain `..` or `@{`, or end with `.lock` or `/`.
const SAFE_BRANCH = /^(?!-|.*\.\.|.*@\{|.*\/\/|.*\/$|.*\.lock$)[A-Za-z0-9._/-]+$/;

export const UPDATE_NOT_AVAILABLE = 'Update is not available.';
export const UPDATE_IN_PROGRESS = 'An update is already in progress.';
export const UPDATE_NOT_FAST_FORWARD = 'Could not fast-forward to the remote branch.';
export const UPDATE_FAILED = 'Could not update from the repository.';

export class UpdateError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'UpdateError';
    this.status = status;
  }
}

export function isPublicHttpsRepoUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    return false;
  }
  if (parsed.username || parsed.password) {
    return false;
  }
  return parsed.pathname.length > 1;
}

export function isValidRepoBranch(value) {
  return typeof value === 'string' && SAFE_BRANCH.test(value.trim());
}

export async function inspectRepoUpdate({ workdir, repoUrl = null, gitBin = 'git' } = {}) {
  const top = await runGit(gitBin, ['rev-parse', '--show-toplevel'], {
    cwd: workdir,
    timeoutMs: GIT_CHECK_TIMEOUT_MS,
  });
  if (top.code !== 0) {
    return { enabled: false, repoRoot: null, repoUrl: null };
  }
  const repoRoot = top.stdout.trim();
  if (!repoRoot) {
    return { enabled: false, repoRoot: null, repoUrl: null };
  }
  let resolvedUrl = repoUrl;
  if (!resolvedUrl) {
    const origin = await runGit(gitBin, ['config', '--get', 'remote.origin.url'], {
      cwd: workdir,
      timeoutMs: GIT_CHECK_TIMEOUT_MS,
    });
    resolvedUrl = origin.code === 0 ? origin.stdout.trim() : null;
  }
  if (!isPublicHttpsRepoUrl(resolvedUrl)) {
    return { enabled: false, repoRoot, repoUrl: null };
  }
  return { enabled: true, repoRoot, repoUrl: resolvedUrl.trim() };
}

// Fetches repoBranch, then resets to it only when HEAD can fast-forward
// (including when it is already there). A rejected fast-forward leaves the
// worktree alone. Throws UpdateError(409) in that case.
export async function pullRepoUpdate({
  workdir,
  projectRoot = workdir,
  repoUrl = null,
  repoBranch = 'main',
  gitBin = 'git',
  timeoutMs = GIT_TIMEOUT_MS,
  logger = console,
} = {}) {
  if (!isValidRepoBranch(repoBranch)) {
    throw new UpdateError(400, UPDATE_NOT_AVAILABLE);
  }
  const branch = repoBranch.trim();
  const status = await inspectRepoUpdate({ workdir, repoUrl, gitBin });
  if (!status.enabled) {
    throw new UpdateError(400, UPDATE_NOT_AVAILABLE);
  }

  const before = await runGit(gitBin, ['rev-parse', 'HEAD'], {
    cwd: workdir,
    timeoutMs: GIT_CHECK_TIMEOUT_MS,
  });
  if (before.code !== 0) {
    logger.error(`[boffin] git rev-parse HEAD failed: ${before.stderr.trim()}`);
    throw new UpdateError(502, UPDATE_FAILED);
  }
  const oldHead = before.stdout.trim();

  const fetched = await runGit(
    gitBin,
    ['-c', 'credential.helper=', 'fetch', '--', status.repoUrl, branch],
    { cwd: workdir, timeoutMs },
  );
  if (fetched.code !== 0) {
    logger.error(`[boffin] git fetch failed: ${`${fetched.stderr}\n${fetched.stdout}`.trim()}`);
    throw new UpdateError(502, UPDATE_FAILED);
  }

  const ancestor = await runGit(gitBin, ['merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD'], {
    cwd: workdir,
    timeoutMs: GIT_CHECK_TIMEOUT_MS,
  });
  // 1 means "not an ancestor", which is the fast-forward refusal. Other
  // non-zero codes are git failures (missing FETCH_HEAD, not a repository).
  if (ancestor.code === 1) {
    throw new UpdateError(409, UPDATE_NOT_FAST_FORWARD);
  }
  if (ancestor.code !== 0) {
    logger.error(`[boffin] git merge-base failed: ${ancestor.stderr.trim()}`);
    throw new UpdateError(502, UPDATE_FAILED);
  }

  const reset = await runGit(gitBin, ['reset', '--hard', 'FETCH_HEAD'], {
    cwd: workdir,
    timeoutMs: GIT_CHECK_TIMEOUT_MS,
  });
  if (reset.code !== 0) {
    logger.error(`[boffin] git reset --hard failed: ${reset.stderr.trim()}`);
    throw new UpdateError(502, UPDATE_FAILED);
  }

  const after = await runGit(gitBin, ['rev-parse', 'HEAD'], {
    cwd: workdir,
    timeoutMs: GIT_CHECK_TIMEOUT_MS,
  });
  if (after.code !== 0) {
    logger.error(`[boffin] git rev-parse HEAD after fetch failed: ${after.stderr.trim()}`);
    throw new UpdateError(502, UPDATE_FAILED);
  }
  const newHead = after.stdout.trim();
  const head = newHead.slice(0, 7);
  if (oldHead === newHead) {
    return { updated: false, restart: false, rebuildBundle: false, head };
  }

  const diff = await runGit(gitBin, ['diff', '--name-only', oldHead, newHead], {
    cwd: status.repoRoot,
    timeoutMs: GIT_CHECK_TIMEOUT_MS,
  });
  if (diff.code !== 0) {
    logger.error(`[boffin] git diff failed: ${diff.stderr.trim()}`);
    throw new UpdateError(502, UPDATE_FAILED);
  }
  const changed = diff.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return classifyProjectChanges(status.repoRoot, projectRoot, changed, head);
}

export function classifyProjectChanges(repoRoot, projectRoot, changedPaths, head) {
  const relRoot = path.relative(path.resolve(repoRoot), path.resolve(projectRoot)).replace(/\\/g, '/');
  if (relRoot.startsWith('..')) {
    return { updated: true, restart: true, rebuildBundle: true, head };
  }
  const prefix = relRoot ? `${relRoot}/` : '';
  const projectFiles = [];
  for (const entry of changedPaths) {
    const normalized = entry.replace(/\\/g, '/');
    if (!prefix) {
      projectFiles.push(normalized);
    } else if (normalized.startsWith(prefix)) {
      projectFiles.push(normalized.slice(prefix.length));
    }
  }
  if (projectFiles.length === 0) {
    // HEAD moved in some other directory. The project did not, but the
    // repository is not the commit the owner had a moment ago.
    return { updated: true, restart: false, rebuildBundle: false, head };
  }
  const rebuildBundle = projectFiles.some((file) => file.startsWith('public/') || file.startsWith('shared/'));
  const restart = projectFiles.some(
    (file) => file === 'package.json' || file.startsWith('src/') || file.startsWith('shared/'),
  );
  return { updated: true, restart, rebuildBundle, head };
}

function killGitProcess(child) {
  // detached puts git and the helpers it spawns in one group, so a timeout
  // cannot leave `index.lock` held by a grandchild.
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // The group is already gone.
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Already exited.
  }
}

function runGit(gitBin, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(gitBin, args, {
      cwd,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };
    const timer = setTimeout(() => {
      killGitProcess(child);
      finish({ code: null, stdout, stderr: `${stderr}\nTimed out.` });
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish({ code: null, stdout, stderr: error.message }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}
