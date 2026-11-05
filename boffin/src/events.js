import { randomUUID } from 'node:crypto';

const MAX_SUMMARY_CHARS = 160;
const MAX_DETAIL_CHARS = 300;
const SUMMARY_KEYS = [
  'command',
  'path',
  'target_directory',
  'targetDirectory',
  'pattern',
  'glob_pattern',
  'globPattern',
  'query',
  'url',
  'description',
  'name',
];
const FAILURE_RESULT_KEY = /error|fail|reject|denied|cancel/i;
const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

// Per-run bookkeeping for translating one `agent -p --output-format stream-json` run.
export function createRunState() {
  return {
    chatId: null,
    segmentId: null,
    tools: new Map(),
    sawText: false,
    sawResult: false,
  };
}

export function eventToOps(event, state) {
  switch (event?.type) {
    case 'system':
      return onSystem(event, state);
    case 'assistant':
      return onAssistant(event, state);
    case 'tool_call':
      return onToolCall(event, state);
    case 'result':
      return onResult(event, state);
    case 'boffin_error':
      return [notice('error', 'The agent sent a line the server could not read. Part of the reply may be missing.')];
    default:
      return [];
  }
}

// Called once the process has exited. Returns ops describing an abnormal end.
export function finishOps(outcome, state, { cancelled = false } = {}) {
  state.segmentId = null;
  if (state.sawResult) {
    return [];
  }
  if (cancelled) {
    return [notice('info', 'Stopped.')];
  }
  if (outcome.error?.handledEvent) {
    return [notice('error', 'Unexpected server error. See the server log.')];
  }
  if (outcome.error) {
    return [notice('error', `Could not start the Cursor CLI: ${outcome.error.message}`)];
  }
  if (outcome.code === 0 && !outcome.signal) {
    return [];
  }
  const reason = outcome.signal ? `signal ${outcome.signal}` : `exit code ${outcome.code}`;
  const detail = lastStderrLine(outcome.stderr);
  return [notice('error', detail ? `The agent stopped (${reason}): ${detail}` : `The agent stopped (${reason}).`)];
}

export function describeToolCall(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') {
    return { name: 'Tool', summary: '', result: undefined };
  }

  const key = Object.keys(toolCall).find((entry) => entry.endsWith('ToolCall'));
  if (key) {
    const body = toolCall[key] ?? {};
    return {
      name: labelFor(key.slice(0, -'ToolCall'.length)),
      summary: summarize(body.args),
      result: body.result,
    };
  }

  if (toolCall.function && typeof toolCall.function === 'object') {
    return {
      name: labelFor(toolCall.function.name ?? 'tool'),
      summary: summarize(parseArguments(toolCall.function.arguments)),
      result: toolCall.result,
    };
  }

  return { name: labelFor(Object.keys(toolCall)[0] ?? 'tool'), summary: '', result: undefined };
}

function onSystem(event, state) {
  if (event.subtype === 'init' && typeof event.session_id === 'string') {
    state.chatId = event.session_id;
  }
  return [];
}

// With --stream-partial-output, assistant messages come in three shapes:
//  - streaming delta: timestamp_ms present, model_call_id absent (append to the current bubble)
//  - pre-tool-call flush: timestamp_ms and model_call_id present (duplicate of the deltas)
//  - end-of-turn flush: no timestamp_ms (duplicate of the deltas)
// Without partial output every assistant message is a complete segment.
function onAssistant(event, state) {
  const text = messageText(event.message);
  const isDelta = event.timestamp_ms !== undefined && event.model_call_id === undefined;

  if (isDelta) {
    if (!text) {
      return [];
    }
    const ops = [];
    if (!state.segmentId) {
      state.segmentId = randomUUID();
      ops.push({ op: 'add', item: { id: state.segmentId, role: 'assistant', text: '' } });
    }
    ops.push({ op: 'append', id: state.segmentId, text });
    state.sawText = true;
    return ops;
  }

  const images = messageImages(event.message);
  if (state.segmentId) {
    const id = state.segmentId;
    state.segmentId = null;
    if (!text && images.length === 0) {
      return [];
    }
    const patch = {};
    if (text) {
      patch.text = text;
      state.sawText = true;
    }
    if (images.length > 0) {
      patch.images = images;
    }
    return [{ op: 'set', id, patch }];
  }

  if (!text && images.length === 0) {
    return [];
  }
  if (text) {
    state.sawText = true;
  }
  const item = { id: randomUUID(), role: 'assistant', text };
  if (images.length > 0) {
    item.images = images;
  }
  return [{ op: 'add', item }];
}

function onToolCall(event, state) {
  const callId = event.call_id == null ? null : String(event.call_id);
  const tool = describeToolCall(event.tool_call);

  if (event.subtype === 'started') {
    state.segmentId = null;
    const id = randomUUID();
    if (callId !== null) {
      state.tools.set(callId, id);
    }
    return [{ op: 'add', item: { id, role: 'tool', name: tool.name, summary: tool.summary, status: 'running' } }];
  }

  if (event.subtype === 'completed') {
    const status = toolStatus(tool.result);
    const existingId = callId === null ? undefined : state.tools.get(callId);
    const images = generatedImageRefs(tool.result);
    if (existingId !== undefined) {
      state.tools.delete(callId);
      const patch = { status, name: tool.name };
      if (tool.summary) {
        patch.summary = tool.summary;
      }
      if (images.length > 0) {
        patch.images = images;
      }
      return [{ op: 'set', id: existingId, patch }];
    }
    const item = { id: randomUUID(), role: 'tool', name: tool.name, summary: tool.summary, status };
    if (images.length > 0) {
      item.images = images;
    }
    return [{ op: 'add', item }];
  }

  return [];
}

function onResult(event, state) {
  state.sawResult = true;
  state.segmentId = null;
  const text = typeof event.result === 'string' ? event.result.trim() : '';
  const failed = event.is_error === true || (typeof event.subtype === 'string' && event.subtype !== 'success');

  if (failed) {
    return [notice('error', text || `The agent reported an error (${event.subtype ?? 'unknown'}).`)];
  }
  if (!state.sawText && text) {
    state.sawText = true;
    return [{ op: 'add', item: { id: randomUUID(), role: 'assistant', text } }];
  }
  return [];
}

function notice(level, text) {
  return { op: 'add', item: { id: randomUUID(), role: 'notice', level, text } };
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((part) => part && (part.type === undefined || part.type === 'text') && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

// Image parts travel with the assistant message. Bytes stay in `data` until the
// conversation stores them; the browser only ever sees a media id.
function messageImages(message) {
  const content = message?.content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .filter((part) => part && part.type === 'image' && typeof part.data === 'string' && part.data.trim())
    .map((part) => ({ name: 'image', data: part.data, filePath: '' }));
}

// GenerateImageSuccess is { filePath, imageData } under result.success.
function generatedImageRefs(result) {
  const success = result?.success;
  if (!success || typeof success !== 'object') {
    return [];
  }
  const data = firstString(success.imageData, success.image_data);
  const filePath = firstString(success.filePath, success.file_path);
  if (!data && !filePath) {
    return [];
  }
  const name = filePath ? filePath.split(/[\\/]/).filter(Boolean).pop() : 'image';
  return [{ name: name || 'image', data, filePath }];
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) ?? '';
}

function toolStatus(result) {
  if (result && typeof result === 'object' && !('success' in result)) {
    if (Object.keys(result).some((key) => FAILURE_RESULT_KEY.test(key))) {
      return 'error';
    }
  }
  return 'done';
}

function summarize(args) {
  if (!args || typeof args !== 'object') {
    return '';
  }
  const preferred = SUMMARY_KEYS.map((key) => args[key]).find(isNonEmptyString);
  const value = preferred ?? Object.values(args).find(isNonEmptyString);
  return value === undefined ? '' : clip(value.replace(/\s+/g, ' ').trim(), MAX_SUMMARY_CHARS);
}

function parseArguments(value) {
  if (typeof value !== 'string') {
    return value && typeof value === 'object' ? value : {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function labelFor(raw) {
  const words = String(raw)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Tool';
}

function lastStderrLine(stderr) {
  const lines = String(stderr ?? '')
    .replace(ANSI_PATTERN, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? clip(lines[lines.length - 1], MAX_DETAIL_CHARS) : '';
}

function clip(text, limit) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}
