import { spawn } from 'node:child_process';
import { buildCursorArgs } from './backends.js';

const STDERR_LIMIT = 8 * 1024;
export const KILL_GRACE_MS = 5000;

// Flags follow `agent --help` for Cursor CLI 2026.x. The prompt goes after `--`
// so user text starting with a dash is never parsed as an option.
// `--image` is a hidden CLI flag. It is repeatable and must come before `--`,
// because everything after the separator is the prompt.
export function buildAgentArgs({ model, force, resumeId, prompt, imagePaths = [] }) {
  return buildCursorArgs({ spec: { cli: model }, force, resumeId, prompt, imagePaths });
}

// Spawns the CLI without a shell and invokes onEvent for each parsed NDJSON line.
// `done` resolves exactly once with { error, code, signal, stderr }.
export function runAgent({ bin, args, cwd, env = process.env, onEvent, logger = console }) {
  const detached = process.platform !== 'win32';
  const child = spawn(bin, args, {
    cwd,
    env: agentEnvironment(env),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached,
    windowsHide: true,
  });

  let stderr = '';
  let settled = false;
  let reportedMalformed = false;
  let handlerError = null;
  let killTimer = null;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const settle = (outcome) => {
    if (!settled) {
      settled = true;
      resolveDone(outcome);
    }
  };

  const lines = createLineSplitter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch (error) {
      // One bad line must not drop events that follow it.
      logger.error(`[boffin] malformed agent output: ${error.message}`);
      if (reportedMalformed) {
        return;
      }
      reportedMalformed = true;
      event = { type: 'boffin_error' };
    }
    try {
      onEvent(event);
    } catch (error) {
      // Keep going only for a bad line. A handler failure has already dropped this event,
      // so stop the CLI instead of saving a transcript with a hole in it.
      logger.error(`[boffin] failed to handle agent event: ${error.stack || error}`);
      if (!handlerError) {
        handlerError = error;
        terminate();
      }
    }
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => lines.push(chunk));
  child.stdout.on('end', () => lines.end());
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-STDERR_LIMIT);
  });
  child.on('error', (error) => settle({ error, code: null, signal: null, stderr }));
  child.on('close', (code, signal) =>
    settle({
      error: handlerError ? Object.assign(handlerError, { handledEvent: true }) : null,
      code,
      signal,
      stderr,
    }),
  );

  const disarm = () => {
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }
  };

  // Same grace as a user cancel: SIGTERM, then SIGKILL if the CLI is still running.
  const terminate = () => {
    signalProcess(child, 'SIGTERM', detached);
    disarm();
    killTimer = setTimeout(() => signalProcess(child, 'SIGKILL', detached), KILL_GRACE_MS);
    killTimer.unref();
    child.once('close', disarm);
  };

  return {
    pid: child.pid,
    done,
    cancel() {
      terminate();
    },
    kill() {
      disarm();
      signalProcess(child, 'SIGKILL', detached);
    },
  };
}

function createLineSplitter(onLine) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      let start = 0;
      let index = buffer.indexOf('\n', start);
      while (index !== -1) {
        onLine(buffer.slice(start, index));
        start = index + 1;
        index = buffer.indexOf('\n', start);
      }
      buffer = buffer.slice(start);
    },
    end() {
      if (buffer) {
        onLine(buffer);
        buffer = '';
      }
    },
  };
}

// The CLI runs as this user and can print its environment. Boffin sign-in
// secrets stay in the server process.
function agentEnvironment(env) {
  const copy = { ...env };
  delete copy.BOFFIN_PASSWORD;
  delete copy.BOFFIN_USERNAME;
  delete copy.BOFFIN_ACCESS_TOKEN;
  return copy;
}

function signalProcess(child, signal, detached) {
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
