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
    opencodeTextId: null,
    tools: new Map(),
    sawText: false,
    sawResult: false,
  };
}

export function eventToOps(event, state) {
  // Every OpenCode event names the session. Capture it before the per-type handling.
  if (typeof event?.sessionID === 'string' && event.sessionID) {
    state.chatId = event.sessionID;
  }
  switch (event?.type) {
    case 'system':
      return onSystem(event, state);
    case 'assistant':
      return onAssistant(event, state);
    case 'tool_call':
      return event.subtype ? onToolCall(event, state) : onGrokTool(event, state);
    case 'tool_call_update':
      return onGrokTool(event, state);
    case 'tool_use':
      return onOpenCodeTool(event, state);
    case 'step_start':
      state.opencodeTextId = null;
      return [];
    case 'step_finish':
      return onOpenCodeStepFinish(event, state);
    case 'result':
      return onResult(event, state);
    case 'text':
      return event.part && typeof event.part === 'object' ? onOpenCodeText(event, state) : onGrokText(event, state);
    case 'end':
      return onGrokEnd(event, state);
    case 'error':
      return onGrokError(event, state);
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
    return [notice('error', `Could not start the agent CLI: ${outcome.error.message}`)];
  }
  if (state.agentError) {
    return [notice('error', state.agentError)];
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

  const images = imageParts(event.message?.content);
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

function onGrokText(event, state) {
  const text = firstString(event.data, event.text);
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

function onGrokEnd(event, state) {
  const sessionId = firstString(event.sessionId, event.session_id);
  if (sessionId) {
    state.chatId = sessionId;
  }
  return finishStep(state, stopReason(event));
}

// A Grok `end` and an OpenCode final `step_finish` both close the run. OpenCode
// `tool-calls` and `unknown` are handled before this: another step follows.
function finishStep(state, reason) {
  state.segmentId = null;
  if (!reason || reason === 'stop' || reason === 'end_turn' || reason === 'endturn') {
    if (!state.agentError) {
      state.sawResult = true;
    }
    return [];
  }
  // A user stop is finishOps' "Stopped." notice. Any other incomplete end is this run's failure.
  if (reason === 'cancelled' || reason === 'canceled') {
    state.agentError = 'The agent stopped (cancelled).';
    return [];
  }
  // `error` is not the message. The error event carries that, and finishOps reports
  // it. A notice here would mark the run finished and hide the provider text.
  if (reason === 'error') {
    if (!state.agentError) {
      state.agentError = 'The agent stopped (error).';
    }
    return [];
  }
  state.sawResult = true;
  return [notice('error', `The agent stopped (${STOP_REASON_LABELS[reason] ?? reason.replace(/_/g, ' ')}).`)];
}

function onGrokError(event, state) {
  const error = event.error;
  const nested =
    error && typeof error === 'object'
      ? firstString(error.message, nestedErrorMessage(error.data), error.name, error.type)
      : error;
  state.agentError =
    firstString(event.message, event.data, nested, event.part?.error?.message) || 'The agent reported an error.';
  return [];
}

function nestedErrorMessage(data) {
  if (typeof data === 'string') {
    return data;
  }
  return data && typeof data === 'object' ? data.message : '';
}

// Grok streaming-json tool events have no Cursor subtype. `tool_call` starts one;
// `tool_call_update` patches it. Status words follow the ACP tool-call status.
function onGrokTool(event, state) {
  const rawId = event.toolCallId ?? event.tool_call_id;
  return upsertTool(state, {
    callId: rawId == null || rawId === '' ? null : String(rawId),
    name: firstString(event.title) || (typeof event.toolName === 'string' ? labelFor(event.toolName) : ''),
    summary: summarize(event.rawInput ?? event.raw_input),
    status: toolCallStatus(event.status),
    images: imageParts(event.content),
  });
}

// OpenCode JSON mode emits a text part only when it has ended, with the whole
// `part.text`. A later event for the same id is that same string (or a longer
// replacement), not a suffix, so keep the bubble and set its text.
function onOpenCodeText(event, state) {
  const part = event.part ?? {};
  const text = firstString(part.text);
  if (!text) {
    return [];
  }
  const partId = firstString(part.id);
  if (partId && state.opencodeTextId === partId && state.segmentId) {
    state.sawText = true;
    return [{ op: 'set', id: state.segmentId, patch: { text } }];
  }
  state.opencodeTextId = partId || null;
  state.segmentId = randomUUID();
  state.sawText = true;
  return [{ op: 'add', item: { id: state.segmentId, role: 'assistant', text } }];
}

// OpenCode sends one `tool_use` per finished call, with the tool id in `part.tool`
// and the arguments in `part.state.input`.
function onOpenCodeTool(event, state) {
  const part = event.part ?? {};
  const info = part.state ?? {};
  const name = firstString(part.tool, info.title);
  state.opencodeTextId = null;
  return upsertTool(state, {
    callId: firstString(part.id) || null,
    name: name ? labelFor(name) : '',
    summary: summarize(info.input ?? info.rawInput),
    status: openCodeToolStatus(info),
    images: imageParts(info.metadata?.content),
  });
}

// `status: completed` means the tool returned, not that the command succeeded.
// A shell call keeps a non-zero code and still says completed: v1 puts it at
// `metadata.exit`, and v2 nests the tool's own metadata one level deeper.
function openCodeToolStatus(info) {
  const status = toolCallStatus(info.status);
  const exitCode = info.metadata?.exit ?? info.metadata?.metadata?.exit;
  if (status === 'done' && typeof exitCode === 'number' && exitCode !== 0) {
    return 'error';
  }
  return status;
}

// One bubble per call: the first event adds it, later events patch it. A call that
// is no longer running leaves the map, so a reused id would start a new bubble.
function upsertTool(state, { callId, name, summary, status, images }) {
  state.segmentId = null;
  const existingId = callId === null ? undefined : state.tools.get(callId);
  if (existingId === undefined) {
    const id = randomUUID();
    if (callId !== null) {
      state.tools.set(callId, id);
    }
    const item = { id, role: 'tool', name: name || 'Tool', summary, status };
    if (images.length > 0) {
      item.images = images;
    }
    return [{ op: 'add', item }];
  }

  const patch = { status };
  if (name) {
    patch.name = name;
  }
  if (summary) {
    patch.summary = summary;
  }
  if (images.length > 0) {
    patch.images = images;
  }
  if (status !== 'running') {
    state.tools.delete(callId);
  }
  return [{ op: 'set', id: existingId, patch }];
}

// `tool-calls` and `unknown` mean another step follows. A Grok `end` with those
// reasons is the end of the run, so it goes through finishStep.
function onOpenCodeStepFinish(event, state) {
  state.opencodeTextId = null;
  const reason = normalizeReason(event.part?.reason);
  if (reason === 'tool_calls' || reason === 'unknown') {
    state.segmentId = null;
    return [];
  }
  return finishStep(state, reason);
}

function toolCallStatus(status) {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (value === 'completed' || value === 'done' || value === 'success') {
    return 'done';
  }
  if (value === 'failed' || value === 'error' || value === 'cancelled' || value === 'canceled') {
    return 'error';
  }
  return 'running';
}

function stopReason(event) {
  return normalizeReason(event.stopReason ?? event.stop_reason);
}

function normalizeReason(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
}

const STOP_REASON_LABELS = {
  length: 'max tokens',
  max_tokens: 'max tokens',
  max_turn_requests: 'max turns',
  refusal: 'refusal',
};

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

// Image parts travel with an assistant message or a tool result. Bytes stay in
// `data` until the conversation stores them; the browser only ever sees a media id.
function imageParts(content) {
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
