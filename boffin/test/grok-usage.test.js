import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BILLING_FETCHED_MSG,
  USAGE_REFRESH_COOLDOWN_MS,
  createGrokUsage,
  grokHomeDir,
  loadGrokUsage,
  parseGrokBilling,
} from '../src/grok-usage.js';

const FAKE_GROK_ACP = fileURLToPath(new URL('../fixtures/fake-grok-acp.js', import.meta.url));

function writeLog(grokHome, lines) {
  const dir = path.join(grokHome, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'unified.jsonl'), `${lines.join('\n')}\n`);
}

function billingLine(percent, extra = {}) {
  return JSON.stringify({
    ts: '2026-11-09T00:52:07.634Z',
    msg: BILLING_FETCHED_MSG,
    ctx: {
      config: {
        creditUsagePercent: percent,
        currentPeriod: {
          type: extra.type ?? 'USAGE_PERIOD_TYPE_WEEKLY',
          end: extra.end ?? '2026-11-15T08:53:12.261+00:00',
        },
      },
    },
  });
}

test('GROK_HOME overrides the default grok home', () => {
  assert.equal(grokHomeDir({ GROK_HOME: '/tmp/grok' }, '/home/boffin'), '/tmp/grok');
  assert.equal(grokHomeDir({}, '/home/boffin'), path.join('/home/boffin', '.grok'));
});

test('reads the weekly credit percentage from a billing snapshot', () => {
  assert.deepEqual(
    parseGrokBilling({
      config: {
        creditUsagePercent: 26,
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          end: '2026-11-15T08:53:12.261+00:00',
        },
      },
    }),
    {
      available: true,
      percent: 26,
      period: 'weekly',
      resetsAt: '2026-11-15T08:53:12.261+00:00',
    },
  );
  assert.equal(
    parseGrokBilling({
      config: { creditUsagePercent: 12, currentPeriod: { type: 'USAGE_PERIOD_TYPE_MONTHLY' } },
    }).period,
    'monthly',
  );
  assert.equal(parseGrokBilling({}), null);
  assert.equal(parseGrokBilling({ config: { creditUsagePercent: -1 } }), null);
});

test('loads the latest billing snapshot from Grok\'s unified log', () => {
  const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-grok-'));
  writeLog(grokHome, [
    JSON.stringify({ msg: 'other', ctx: {} }),
    billingLine(10),
    JSON.stringify({ msg: 'billing: upstream error' }),
    billingLine(26, { end: '2026-11-15T08:53:12.261+00:00' }),
    'not json',
    JSON.stringify({ msg: 'shell.turn.inference_done', ctx: { prompt_tokens: 1 } }),
  ]);
  const grok = loadGrokUsage(grokHome);
  assert.equal(grok.percent, 26);
  assert.equal(grok.period, 'weekly');
  assert.equal(grok.resetsAt, '2026-11-15T08:53:12.261+00:00');
});

test('finds a billing snapshot older than one log chunk', () => {
  const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-grok-'));
  const padding = JSON.stringify({ msg: 'noise', ctx: { blob: 'x'.repeat(80) } });
  const lines = [billingLine(41.2)];
  while (Buffer.byteLength(`${lines.join('\n')}\n`) < 70 * 1024) {
    lines.push(padding);
  }
  writeLog(grokHome, lines);
  assert.equal(loadGrokUsage(grokHome).percent, 41.2);
});

test('a missing usage snapshot is unavailable and is not logged as a read error', async () => {
  const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-grok-empty-'));
  const errors = [];
  const { read } = createGrokUsage({
    grokEnabled: true,
    grokHome,
    logger: { error(message) { errors.push(message); } },
  });
  assert.deepEqual(await read(), { grok: { available: false } });
  assert.deepEqual(errors, []);
});

test('createGrokUsage hides Grok when that CLI is not enabled', async () => {
  const { read, refresh } = createGrokUsage({ grokEnabled: false });
  assert.deepEqual(await read(), { grok: null });
  await assert.rejects(refresh(), (error) => error.status === 404);
});

test('createGrokUsage caches a successful reading and a failed one', async () => {
  const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-grok-'));
  let now = 1_000;
  const { read } = createGrokUsage({
    grokEnabled: true,
    grokHome,
    now: () => now,
    logger: { error() {} },
    successCacheMs: 60_000,
    errorCacheMs: 15_000,
  });
  assert.equal((await read()).grok.available, false);
  writeLog(grokHome, [billingLine(10)]);
  now = 10_000;
  assert.equal((await read()).grok.available, false);
  now = 20_000;
  assert.equal((await read()).grok.percent, 10);
  writeLog(grokHome, [billingLine(99)]);
  now = 50_000;
  assert.equal((await read()).grok.percent, 10);
  const fresh = await read({ fresh: true });
  assert.equal(fresh.grok.percent, 99);
});

test('refreshGrokUsage fetches billing then reads the snapshot', async () => {
  const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-grok-refresh-'));
  const { read, refresh } = createGrokUsage({
    grokEnabled: true,
    grokHome,
    fetchBilling: async () => {
      writeLog(grokHome, [billingLine(33)]);
    },
  });
  assert.equal((await read()).grok.available, false);
  const body = await refresh();
  assert.equal(body.grok.percent, 33);
  assert.equal(body.grok.period, 'weekly');
});

test('fetchGrokBillingViaAcp runs Grok billing over ACP', async () => {
  const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-grok-acp-'));
  const { fetchGrokBillingViaAcp } = await import('../src/grok-usage.js');
  const env = { ...process.env, FAKE_GROK_USAGE_PERCENT: '41', FAKE_GROK_STRING_ID: '1' };
  delete env.GROK_HOME;
  await fetchGrokBillingViaAcp({
    grokBin: FAKE_GROK_ACP,
    grokHome,
    env,
    logger: { error() {} },
    timeoutMs: 5_000,
  });
  assert.equal(loadGrokUsage(grokHome).percent, 41);
});

test('fetchGrokBillingViaAcp survives the child closing stdin', async () => {
  const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-grok-acp-exit-'));
  const { fetchGrokBillingViaAcp } = await import('../src/grok-usage.js');
  const env = { ...process.env, FAKE_GROK_EXIT: '1' };
  delete env.GROK_HOME;
  await assert.rejects(
    () => fetchGrokBillingViaAcp({
      grokBin: FAKE_GROK_ACP,
      grokHome,
      env,
      logger: { error() {} },
      timeoutMs: 5_000,
    }),
    (error) => error.status === 502,
  );
});

test('fetchGrokBillingViaAcp kills a Grok process that ignores SIGTERM', async (t) => {
  const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-grok-acp-hold-'));
  const pidFile = path.join(grokHome, 'hold.pid');
  let pid = 0;
  t.after(() => {
    if (!pid) {
      return;
    }
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  });
  const { fetchGrokBillingViaAcp } = await import('../src/grok-usage.js');
  const env = { ...process.env, FAKE_GROK_HOLD: '1' };
  delete env.GROK_HOME;
  await assert.rejects(
    () => fetchGrokBillingViaAcp({
      grokBin: FAKE_GROK_ACP,
      grokHome,
      env,
      logger: { error() {} },
      timeoutMs: 200,
    }),
    (error) => error.status === 502,
  );
  const deadline = Date.now() + 8_000;
  while (!fs.existsSync(pidFile)) {
    if (Date.now() > deadline) {
      assert.fail('hold pid was not written');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  pid = Number(fs.readFileSync(pidFile, 'utf8'));
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        pid = 0;
        return;
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`pid ${pid} still running`);
});

test('refreshGrokUsage enforces a cooldown between attempts', async () => {
  const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boffin-grok-cooldown-'));
  let calls = 0;
  let now = 0;
  const { refresh } = createGrokUsage({
    grokEnabled: true,
    grokHome,
    now: () => now,
    refreshCooldownMs: USAGE_REFRESH_COOLDOWN_MS,
    fetchBilling: async () => {
      calls += 1;
      writeLog(grokHome, [billingLine(12 + calls)]);
    },
  });
  await refresh();
  now = 10_000;
  await assert.rejects(refresh(), (error) => error.status === 429 && error.retryAfter > 0);
  now = USAGE_REFRESH_COOLDOWN_MS + 1;
  const body = await refresh();
  assert.equal(body.grok.percent, 14);
  assert.equal(calls, 2);
});

test('refreshGrokUsage cools down after a failed fetch', async () => {
  let now = 0;
  const { refresh } = createGrokUsage({
    grokEnabled: true,
    now: () => now,
    refreshCooldownMs: USAGE_REFRESH_COOLDOWN_MS,
    fetchBilling: async () => {
      throw new Error('ACP down');
    },
    logger: { error() {} },
  });
  await assert.rejects(refresh(), (error) => error.status === 502);
  now = 10_000;
  await assert.rejects(refresh(), (error) => error.status === 429);
});
