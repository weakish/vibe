#!/usr/bin/env node
// Minimal Grok Build ACP stub for tests. Handles `grok agent --no-leader stdio` and
// answers initialize + `_x.ai/billing`, appending a billing snapshot to unified.jsonl.
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const grokHome = process.env.GROK_HOME || path.join(os.homedir(), '.grok');
const percent = Number(process.env.FAKE_GROK_USAGE_PERCENT ?? 26);

if (process.env.FAKE_GROK_EXIT === '1') {
  process.exit(0);
}
if (process.env.FAKE_GROK_HOLD === '1') {
  mkdirSync(grokHome, { recursive: true });
  writeFileSync(path.join(grokHome, 'hold.pid'), String(process.pid));
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 60_000);
} else {
  if (realpathSync(process.cwd()) !== realpathSync(grokHome)) {
    process.exit(2);
  }
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      process.exit(1);
    }
    const { method, id } = request;
    const replyId = process.env.FAKE_GROK_STRING_ID === '1' ? String(id) : id;
    if (method === 'initialize') {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: replyId, result: {} })}\n`);
      return;
    }
    if (method === '_x.ai/billing') {
      const config = {
        creditUsagePercent: percent,
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          end: '2026-11-15T08:53:12.261+00:00',
        },
      };
      const logDir = path.join(grokHome, 'logs');
      mkdirSync(logDir, { recursive: true });
      appendFileSync(
        path.join(logDir, 'unified.jsonl'),
        `${JSON.stringify({ msg: 'billing: fetched credits config', ctx: { config } })}\n`,
      );
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: replyId, result: { config } })}\n`);
      rl.close();
      process.exit(0);
    }
  });
}
