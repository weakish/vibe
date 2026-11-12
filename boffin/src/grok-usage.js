import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { KILL_GRACE_MS } from './agent.js';

export const BILLING_FETCHED_MSG = 'billing: fetched credits config';
// Official grok CLI ACP extension (same fetch as TUI `/usage`). Not in the public
// ACP sample; xAI's terms do not name it. Prefer this over PTY-driving the TUI:
// systemd has no terminal, and keystrokes would only trigger the same log write.
export const BILLING_ACP_METHOD = '_x.ai/billing';
export const USAGE_SUCCESS_CACHE_MS = 60_000;
export const USAGE_ERROR_CACHE_MS = 15_000;
export const USAGE_REFRESH_COOLDOWN_MS = 60_000;
export const USAGE_REFRESH_TIMEOUT_MS = 20_000;
const LOG_CHUNK_BYTES = 64 * 1024;
const MAX_RPC_LINE_BYTES = 1024 * 1024;
const MAX_RPC_MESSAGES = 32;
const GROK_NOT_ENABLED = 'Grok is not enabled.';
export const GROK_USAGE_REFRESH_FAILED = 'Grok usage refresh failed.';

export function grokHomeDir(env = process.env, homedir = os.homedir()) {
  return env.GROK_HOME || path.join(homedir, '.grok');
}

export function grokUnifiedLogPath(grokHome) {
  return path.join(grokHome, 'logs', 'unified.jsonl');
}

export function parseGrokBilling(body) {
  const config = body?.config;
  const percent = Number(config?.creditUsagePercent);
  if (!Number.isFinite(percent) || percent < 0) {
    return null;
  }
  const type = typeof config.currentPeriod?.type === 'string' ? config.currentPeriod.type : '';
  const period = type.includes('MONTHLY') ? 'monthly' : 'weekly';
  const resetsAt = typeof config.currentPeriod?.end === 'string' ? config.currentPeriod.end : null;
  return { available: true, percent, period, resetsAt };
}

export function grokUsageUnavailable() {
  return { grok: { available: false } };
}

export function createGrokUsage({
  grokEnabled = false,
  grokBin = 'grok',
  grokHome = grokHomeDir(),
  now = Date.now,
  logger = console,
  successCacheMs = USAGE_SUCCESS_CACHE_MS,
  errorCacheMs = USAGE_ERROR_CACHE_MS,
  refreshCooldownMs = USAGE_REFRESH_COOLDOWN_MS,
  fetchBilling = fetchGrokBillingViaAcp,
} = {}) {
  let cache = null;
  let lastRefreshAt = -1;
  let refreshInFlight = null;

  async function readGrokUsage({ fresh = false } = {}) {
    if (!grokEnabled) {
      return { grok: null };
    }
    const at = now();
    if (!fresh && cache && at - cache.at < cache.ttl) {
      return cache.value;
    }
    try {
      const parsed = loadGrokUsage(grokHome);
      // No snapshot yet is the documented empty state, not a failed read.
      if (!parsed) {
        const value = grokUsageUnavailable();
        cache = { at, ttl: errorCacheMs, value };
        return value;
      }
      const value = { grok: parsed };
      cache = { at, ttl: successCacheMs, value };
      return value;
    } catch (error) {
      logger.error(`[boffin] could not read Grok usage: ${error.message}`);
      const value = grokUsageUnavailable();
      cache = { at, ttl: errorCacheMs, value };
      return value;
    }
  }

  async function refreshGrokUsage() {
    if (!grokEnabled) {
      throw usageError(GROK_NOT_ENABLED, 404);
    }
    if (refreshInFlight) {
      return refreshInFlight;
    }
    const at = now();
    if (lastRefreshAt >= 0 && at - lastRefreshAt < refreshCooldownMs) {
      const waitMs = refreshCooldownMs - (at - lastRefreshAt);
      throw usageError('Too many attempts. Try again later.', 429, {
        retryAfter: Math.ceil(waitMs / 1000),
      });
    }
    refreshInFlight = (async () => {
      try {
        lastRefreshAt = now();
        await fetchBilling({ grokBin, grokHome, logger });
        cache = null;
        return readGrokUsage({ fresh: true });
      } catch (error) {
        if (error.status) {
          throw error;
        }
        logger.error(`[boffin] Grok usage refresh failed: ${error.message}`);
        throw usageError(GROK_USAGE_REFRESH_FAILED, 502);
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  return { read: readGrokUsage, refresh: refreshGrokUsage };
}

export function loadGrokUsage(grokHome) {
  return readLastBillingSnapshot(grokUnifiedLogPath(grokHome));
}

export async function fetchGrokBillingViaAcp({
  grokBin,
  grokHome,
  env = process.env,
  logger = console,
  timeoutMs = USAGE_REFRESH_TIMEOUT_MS,
} = {}) {
  const detached = process.platform !== 'win32';
  if (grokHome) {
    fs.mkdirSync(grokHome, { recursive: true });
  }
  const child = spawn(grokBin, ['agent', '--no-leader', 'stdio'], {
    cwd: grokHome || process.cwd(),
    env: grokAgentEnvironment(env, grokHome),
    stdio: ['pipe', 'pipe', 'ignore'],
    detached,
    windowsHide: true,
  });
  // The child closes these pipes when it exits. That EPIPE is not a server failure.
  child.stdin.on('error', () => {});
  child.stdout.on('error', () => {});

  let settled = false;
  let killTimer = null;
  const done = new Promise((resolve, reject) => {
    const disarm = () => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };
    const finish = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signalChild(child, 'SIGTERM', detached);
      disarm();
      killTimer = setTimeout(() => signalChild(child, 'SIGKILL', detached), KILL_GRACE_MS);
      killTimer.unref?.();
      child.once('close', disarm);
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, usageError(GROK_USAGE_REFRESH_FAILED, 502));
    }, timeoutMs);
    timer.unref?.();

    child.on('error', (error) => {
      logger.error(`[boffin] could not start Grok for usage refresh: ${error.message}`);
      finish(reject, usageError(GROK_USAGE_REFRESH_FAILED, 502));
    });

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let stdinClosed = false;
    const writeRequest = (id, method, params) => {
      if (stdinClosed) {
        return;
      }
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    };

    (async () => {
      try {
        writeRequest(1, 'initialize', {
          protocolVersion: 1,
          clientCapabilities: { fs: {}, terminal: false },
          _meta: {
            startupHints: {
              nonInteractive: true,
              skipGitStatus: true,
              skipProjectLayout: true,
            },
            clientType: 'boffin',
          },
        });
        await waitForRpcResult(rl, 1);
        writeRequest(2, BILLING_ACP_METHOD, {});
        stdinClosed = true;
        child.stdin.end();
        await waitForRpcResult(rl, 2);
        rl.close();
        finish(resolve, undefined);
      } catch (error) {
        rl.close();
        finish(reject, error.status ? error : usageError(GROK_USAGE_REFRESH_FAILED, 502));
      }
    })();
  });

  await done;
}

function grokAgentEnvironment(env, grokHome) {
  const copy = { ...env };
  delete copy.BOFFIN_PASSWORD;
  delete copy.BOFFIN_USERNAME;
  delete copy.BOFFIN_ACCESS_TOKEN;
  if (grokHome) {
    copy.GROK_HOME = grokHome;
  }
  return copy;
}

function readRpcLine(rl) {
  return new Promise((resolve, reject) => {
    const onLine = (line) => {
      cleanup();
      resolve(line);
    };
    const onClose = () => {
      cleanup();
      reject(usageError(GROK_USAGE_REFRESH_FAILED, 502));
    };
    const cleanup = () => {
      rl.off('line', onLine);
      rl.off('close', onClose);
    };
    rl.on('line', onLine);
    rl.on('close', onClose);
  });
}

async function waitForRpcResult(rl, expectedId) {
  let messages = 0;
  while (messages < MAX_RPC_MESSAGES) {
    const line = await readRpcLine(rl);
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (Buffer.byteLength(trimmed, 'utf8') > MAX_RPC_LINE_BYTES) {
      throw usageError(GROK_USAGE_REFRESH_FAILED, 502);
    }
    messages += 1;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      throw usageError(GROK_USAGE_REFRESH_FAILED, 502);
    }
    if (String(message.id) !== String(expectedId)) {
      continue;
    }
    if (message.error) {
      throw usageError(GROK_USAGE_REFRESH_FAILED, 502);
    }
    return message.result;
  }
  throw usageError(GROK_USAGE_REFRESH_FAILED, 502);
}

function usageError(message, status, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function signalChild(child, signal, detached) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    if (detached && child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process already exited.
    }
  }
}

function readLastBillingSnapshot(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const { size } = fs.fstatSync(fd);
    let pos = size;
    let carry = '';
    while (pos > 0) {
      const start = Math.max(0, pos - LOG_CHUNK_BYTES);
      const buf = Buffer.alloc(pos - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = `${buf.toString('utf8')}${carry}`;
      const lines = text.split('\n');
      if (start > 0) {
        carry = lines.shift() ?? '';
      } else {
        carry = '';
      }
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const snapshot = billingSnapshotFromLine(lines[i]);
        if (snapshot) {
          return snapshot;
        }
      }
      pos = start;
    }
    return billingSnapshotFromLine(carry);
  } finally {
    fs.closeSync(fd);
  }
}

function billingSnapshotFromLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let entry;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (entry?.msg !== BILLING_FETCHED_MSG) {
    return null;
  }
  return parseGrokBilling(entry.ctx);
}
