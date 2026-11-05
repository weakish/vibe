import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { conversationLogFilename, formatConversationLog } from '../shared/export.js';
import { MAX_SPEC_CHARS, DEFAULT_SPEC } from '../shared/default-spec.js';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../shared/limits.js';
import { AttachmentError, parseAttachments } from './attachments.js';
import { BusyError, MembershipError, checkedPasskeyLabel } from './conversation.js';
import { readSavedSpec, specPathForState, writeSavedSpec } from './spec-store.js';
import {
  PASSKEY_ATTEMPT_LIMIT,
  PASSWORD_ATTEMPT_LIMIT,
  createAttemptLimiter,
  requestAddress,
} from './attempt-limit.js';
import {
  creationOptions,
  passkeyOrigin,
  randomChallenge,
  requestOptions,
  verifyAssertion,
  verifyRegistration,
} from './webauthn.js';

export const MAX_MESSAGE_CHARS = 32 * 1024;
// JSON.stringify writes control characters as \uXXXX (6 bytes). The cap also has
// to fit every attachment the composer is allowed to send, base64-encoded.
const MESSAGE_ENVELOPE_BYTES = MAX_MESSAGE_CHARS * 6 + 64;
const ATTACHMENT_JSON_OVERHEAD = 512;
export const MAX_BODY_BYTES =
  MESSAGE_ENVELOPE_BYTES + MAX_ATTACHMENTS * (Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + ATTACHMENT_JSON_OVERHEAD);
// Password and passkey bodies carry no attachments. The chat cap would let one
// address pin tens of megabytes on each of the few attempts it is allowed.
export const AUTH_BODY_BYTES = 64 * 1024;
const HEARTBEAT_MS = 15000;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Only these exact paths are served, so request paths never reach the file system directly.
const STATIC_FILES = new Map([
  ['/', 'public/index.html'],
  ['/index.html', 'public/index.html'],
  ['/app.js', 'public/app.js'],
  ['/markdown.js', 'public/markdown.js'],
  ['/stream.js', 'public/stream.js'],
  ['/i18n.js', 'public/i18n.js'],
  ['/flags.js', 'public/flags.js'],
  ['/theme.js', 'public/theme.js'],
  ['/theme-init.js', 'public/theme-init.js'],
  ['/styles.css', 'public/styles.css'],
  ['/manifest.webmanifest', 'public/manifest.webmanifest'],
  ['/icon.svg', 'public/icon.svg'],
  ['/spec', 'public/spec.html'],
  ['/spec.html', 'public/spec.html'],
  ['/spec.js', 'public/spec.js'],
  ['/shared/transcript.js', 'shared/transcript.js'],
  ['/shared/export.js', 'shared/export.js'],
  ['/shared/limits.js', 'shared/limits.js'],
  ['/passkey.js', 'public/passkey.js'],
  ['/member-color.js', 'public/member-color.js'],
]);
const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const CHALLENGE_MS = 5 * 60 * 1000;
// Every sign-in challenge lists this many credential ids. Fewer real passkeys are filled
// out with placeholders, so a short list does not show by itself whether the username exists.
export const LOGIN_CREDENTIAL_SLOTS = 8;
const PASSKEY_UNAVAILABLE = 'A passkey needs HTTPS on a stable hostname.';
const PASSKEY_REJECTED = 'The passkey was not accepted.';
const PASSWORD_RETIRED = 'The password is no longer used.';
const TOO_MANY_ATTEMPTS = 'Too many attempts. Try again later.';
const PASSWORD_LIMITED = Symbol('password-limited');
const BASIC_AUTH = /^Basic\s+(\S+)$/i;
// Ceremonies that mint or consume a challenge without an existing session.
const PUBLIC_PASSKEY_ROUTES = new Set([
  '/api/auth/register',
  '/api/auth/options',
  '/api/auth/login',
  '/api/join',
  '/api/join/finish',
]);
const OWNER_ONLY = 'Only the owner can do that.';
const NOT_IN_CONVERSATION = 'You are not in this conversation.';
// Same text as addMember's refusal, so every language already has it.
const ALREADY_IN_CONVERSATION = 'That person is already in the conversation.';

export function createServer({ conversation, username, password, logger = console }) {
  const expectedUser = digest(username);
  const expectedPassword = digest(password);
  const specFile = specPathForState(conversation.stateFile);
  const context = {
    conversation,
    username,
    expectedUser,
    expectedPassword,
    logger,
    specFile,
    sessions: new Map(),
    challenges: new Map(),
    // Kept in the state file. Not derived from the password, see coverCredentialId.
    coverKey: conversation.coverKey,
    passwordAttempts: createAttemptLimiter(PASSWORD_ATTEMPT_LIMIT),
    passkeyAttempts: createAttemptLimiter(PASSKEY_ATTEMPT_LIMIT),
  };
  return http.createServer((req, res) => {
    handleRequest(req, res, context).catch((error) => {
      logger.error(`[boffin] request failed: ${error.stack || error}`);
      if (res.headersSent) {
        res.destroy();
      } else {
        sendJson(res, 500, { error: 'Internal server error.' });
      }
    });
  });
}

async function handleRequest(req, res, context) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, res, url, context);
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && STATIC_FILES.has(url.pathname)) {
    return sendStatic(req, res, STATIC_FILES.get(url.pathname));
  }
  return sendJson(res, 404, { error: 'Not found.' });
}

async function handleApi(req, res, url, context) {
  if (req.method === 'GET' && url.pathname === '/api/auth/status') {
    const join = url.searchParams.get('join');
    const invite = join && context.conversation.invites.some((item) => item.id === join)
      ? { ownerName: context.username }
      : null;
    return sendJson(res, 200, {
      started: context.conversation.hasPasskey,
      invite,
    });
  }
  if (req.method === 'POST' && PUBLIC_PASSKEY_ROUTES.has(url.pathname)) {
    if (rejectPasskeyAttempt(req, res, context)) {
      return;
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/password') {
    return handlePassword(req, res, context);
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    return handleRegister(req, res, context);
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/options') {
    return handleLoginOptions(req, res, context);
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    return handleLogin(req, res, context);
  }
  if (req.method === 'POST' && url.pathname === '/api/join') {
    return handleJoin(req, res, context);
  }
  if (req.method === 'POST' && url.pathname === '/api/join/finish') {
    return handleJoinFinish(req, res, context);
  }
  if (req.method === 'GET' && url.pathname === '/api/spec') {
    const reader = authenticate(req, context);
    if (reader === PASSWORD_LIMITED) {
      return sendAttemptLimit(res, context.passwordAttempts, req);
    }
    if (!reader) {
      return sendJson(res, 401, { error: 'Invalid or missing username or password.' });
    }
    if (!canEnter(reader, context.conversation)) {
      return sendJson(res, 403, { error: NOT_IN_CONVERSATION });
    }
    return handleSpec(req, res, context.specFile, context.logger, reader.owner);
  }

  const person = authenticate(req, context);
  if (person === PASSWORD_LIMITED) {
    return sendAttemptLimit(res, context.passwordAttempts, req);
  }
  if (!person) {
    return sendJson(res, 401, { error: 'Invalid or missing username or password.' });
  }

  const { conversation } = context;
  if (req.method === 'GET' && url.pathname === '/api/session') {
    return sendSession(res, context, person, url.searchParams.get('open') === 'active');
  }
  if (req.method === 'DELETE' && url.pathname === '/api/session') {
    if (!dropSession(req, context)) {
      return sendJson(res, 401, { error: 'Invalid or missing username or password.' });
    }
    return sendJson(res, 200, { ok: true });
  }
  const logId = /^\/api\/logs\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (req.method === 'GET' && logId) {
    return sendKeptLog(res, context, person, logId[1]);
  }
  const mediaId = /^\/api\/media\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (req.method === 'GET' && mediaId) {
    if (!canEnter(person, conversation)) {
      return sendJson(res, 403, { error: NOT_IN_CONVERSATION });
    }
    return sendMedia(res, conversation, mediaId[1]);
  }
  if (req.method === 'POST' && url.pathname === '/api/messages') {
    if (!canEnter(person, conversation)) {
      return sendJson(res, 403, { error: NOT_IN_CONVERSATION });
    }
    return handleMessage(req, res, context, person);
  }
  if (req.method === 'POST' && url.pathname === '/api/cancel') {
    if (!canEnter(person, conversation)) {
      return sendJson(res, 403, { error: NOT_IN_CONVERSATION });
    }
    return sendJson(res, 200, { stopping: conversation.cancel() });
  }
  if (req.method === 'POST' && url.pathname === '/api/new') {
    if (!person.owner) {
      return sendJson(res, 403, { error: OWNER_ONLY });
    }
    return handleReset(res, conversation);
  }
  if (req.method === 'POST' && url.pathname === '/api/invites') {
    if (!person.owner) {
      return sendJson(res, 403, { error: OWNER_ONLY });
    }
    const invite = conversation.createInvite();
    return sendJson(res, 200, { id: invite.id, path: `/?join=${invite.id}` });
  }
  const inviteId = /^\/api\/invites\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (req.method === 'DELETE' && inviteId) {
    if (!person.owner) {
      return sendJson(res, 403, { error: OWNER_ONLY });
    }
    return runMembership(res, () => {
      conversation.cancelInvite(inviteId[1]);
      return { ok: true };
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/passkeys') {
    return sendJson(res, 200, { passkeys: conversation.listPasskeys(person.personId) });
  }
  if (req.method === 'POST' && (url.pathname === '/api/passkeys' || url.pathname === '/api/passkeys/finish')) {
    if (rejectPasskeyAttempt(req, res, context)) {
      return;
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/passkeys') {
    return handleAddPasskey(req, res, context, person);
  }
  if (req.method === 'POST' && url.pathname === '/api/passkeys/finish') {
    return handleAddPasskeyFinish(req, res, context, person);
  }
  const passkeyId = /^\/api\/passkeys\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (req.method === 'DELETE' && passkeyId) {
    return runMembership(res, () => {
      conversation.removePasskey(person.personId, passkeyId[1]);
      return { passkeys: conversation.listPasskeys(person.personId) };
    });
  }
  const memberId = /^\/api\/members\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (req.method === 'POST' && memberId) {
    if (!person.owner) {
      return sendJson(res, 403, { error: OWNER_ONLY });
    }
    return runMembership(res, () => {
      conversation.addMember(memberId[1], context.username);
      return { ok: true };
    });
  }
  if (req.method === 'DELETE' && memberId) {
    if (!person.owner) {
      return sendJson(res, 403, { error: OWNER_ONLY });
    }
    return runMembership(res, () => {
      conversation.removeMember(memberId[1]);
      return { ok: true };
    });
  }
  if (req.method === 'PUT' && url.pathname === '/api/spec') {
    if (!person.owner) {
      return sendJson(res, 403, { error: OWNER_ONLY });
    }
    if (!canEnter(person, conversation)) {
      return sendJson(res, 403, { error: NOT_IN_CONVERSATION });
    }
    return handleSpec(req, res, context.specFile, context.logger, true);
  }
  return sendJson(res, 404, { error: 'Not found.' });
}

async function handleSpec(req, res, specFile, logger, canEdit) {
  if (req.method === 'GET') {
    const saved = await readSavedSpec(specFile);
    return sendJson(res, 200, { text: saved ?? DEFAULT_SPEC, canEdit });
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    const status = error.status ?? 400;
    return sendJson(res, status, { error: error.message }, { close: status === 413 });
  }
  if (typeof body?.text !== 'string') {
    return sendJson(res, 400, { error: 'The spec must be text.' });
  }
  if (body.text.length > MAX_SPEC_CHARS) {
    return sendJson(res, 413, { error: `The spec is limited to ${MAX_SPEC_CHARS} characters.` });
  }
  try {
    await writeSavedSpec(specFile, body.text);
  } catch (error) {
    logger.error(`[boffin] could not save spec: ${error.message}`);
    return sendJson(res, 500, { error: 'Internal server error.' });
  }
  return sendJson(res, 200, { text: body.text });
}

// Streams transcript operations as NDJSON. The run keeps going if the client disconnects;
// the transcript is the source of truth and the browser can reload it at any time.
async function handleMessage(req, res, { conversation, logger }, person) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    // Closing the async iterator already stopped the upload. Destroying the
    // socket before writeHead drops the 413 on the floor, so answer first and
    // hang up afterwards. Otherwise leftover body bytes become the next request.
    const status = error.status ?? 400;
    return sendJson(res, status, { error: error.message }, { close: status === 413 });
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (text.length > MAX_MESSAGE_CHARS) {
    return sendJson(res, 413, { error: `Messages are limited to ${MAX_MESSAGE_CHARS} characters.` });
  }
  let attachments;
  try {
    attachments = parseAttachments(body?.attachments);
  } catch (error) {
    if (error instanceof AttachmentError) {
      return sendJson(res, error.status, { error: error.message }, { close: error.status === 413 });
    }
    throw error;
  }
  if (!text && attachments.length === 0) {
    return sendJson(res, 400, { error: 'Send a message or attach a file.' });
  }

  // start() throws BusyError synchronously, before any await, and may also emit
  // the user turn before returning. Reserve the run first so a conflict is still
  // a 409, then flush those ops once the stream headers exist.
  const buffered = [];
  let deliver = (op) => buffered.push(op);
  let finished;
  try {
    finished = conversation.start(text, (op) => deliver(op), attachments, person.name);
  } catch (error) {
    if (error instanceof BusyError) {
      return sendJson(res, 409, { error: error.message });
    }
    throw error;
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  res.on('error', (error) => {
    if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET' && error.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      logger.error(`[boffin] response failed: ${error.message}`);
    }
  });
  res.flushHeaders();

  const writeLine = (line) => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`${line}\n`);
    }
  };
  deliver = (op) => writeLine(JSON.stringify(op));
  for (const op of buffered) {
    writeLine(JSON.stringify(op));
  }
  const heartbeat = setInterval(() => writeLine(''), HEARTBEAT_MS);
  try {
    await finished;
  } catch (error) {
    logger.error(`[boffin] message failed: ${error.stack || error}`);
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

function sendMedia(res, conversation, id) {
  const file = conversation.readMedia(id);
  if (!file) {
    return sendJson(res, 404, { error: 'Not found.' });
  }
  res.writeHead(200, {
    'Content-Type': file.mime,
    'Content-Length': file.bytes.length,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': `inline; filename="${asciiFileName(file.name)}"`,
  });
  res.end(file.bytes);
}

function asciiFileName(name) {
  const ascii = String(name).replace(/[^\w.\- ]+/g, '_').slice(0, 80);
  return ascii || 'image';
}

function handleReset(res, conversation) {
  try {
    conversation.reset();
  } catch (error) {
    if (error instanceof BusyError) {
      return sendJson(res, 409, { error: error.message });
    }
    return sendJson(res, 500, { error: 'Could not start a new chat because the conversation could not be saved.' });
  }
  return sendJson(res, 200, { ok: true });
}

async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw httpError(413, 'Request body is too large.');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw httpError(400, 'Request body must be valid JSON.');
  }
}

async function handlePassword(req, res, context) {
  // The password is already retired, so this is not a guess and must not spend an attempt.
  // Close before reading so the unread body cannot ride into the next request.
  if (context.conversation.hasOwnerPasskey) {
    return sendJson(res, 401, { error: PASSWORD_RETIRED }, { close: true });
  }
  const attempt = context.passwordAttempts.record(requestAddress(req));
  if (!attempt.ok) {
    return sendTooMany(res, attempt.retryAfter);
  }
  const body = await readBody(req, res, AUTH_BODY_BYTES);
  if (body === undefined) {
    return undefined;
  }
  const username = typeof body?.username === 'string' ? body.username : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const userOk = timingSafeEqual(digest(username), context.expectedUser);
  const passwordOk = timingSafeEqual(digest(password), context.expectedPassword);
  if (!userOk || !passwordOk) {
    return sendJson(res, 401, { error: 'Invalid or missing username or password.' });
  }
  const place = passkeyOrigin(req.headers.origin ?? '');
  if (!place) {
    return sendJson(res, 400, { error: PASSKEY_UNAVAILABLE });
  }
  const pending = rememberChallenge(context, { kind: 'owner', ...place });
  return sendJson(res, 200, {
    challengeId: pending.id,
    options: creationOptions({
      challenge: pending.challenge,
      rpId: place.rpId,
      userId: Buffer.from('owner'),
      userName: context.username,
    }),
  });
}

async function handleRegister(req, res, context) {
  const body = await readBody(req, res, AUTH_BODY_BYTES);
  if (body === undefined) {
    return undefined;
  }
  const pending = takeChallenge(context, body?.challengeId, 'owner');
  const verified = pending && verifyRegistration(body?.credential, pending);
  if (!verified) {
    return sendJson(res, 401, { error: PASSKEY_REJECTED });
  }
  try {
    context.conversation.setOwnerPasskey(verified);
  } catch (error) {
    if (error instanceof MembershipError) {
      return sendJson(res, error.status, { error: error.message });
    }
    context.logger.error(`[boffin] could not save passkey: ${error.message}`);
    return sendJson(res, 500, { error: 'Internal server error.' });
  }
  return sendJson(res, 200, finishSignIn(context, ownerPerson(context)));
}

async function handleAddPasskey(req, res, context, person) {
  const body = await readBody(req, res, AUTH_BODY_BYTES);
  if (body === undefined) {
    return undefined;
  }
  let label;
  try {
    label = checkedPasskeyLabel(body?.label ?? '');
  } catch (error) {
    if (error instanceof MembershipError) {
      return sendJson(res, error.status, { error: error.message });
    }
    throw error;
  }
  const place = passkeyOrigin(req.headers.origin ?? '');
  if (!place) {
    return sendJson(res, 400, { error: PASSKEY_UNAVAILABLE });
  }
  // One passkey past the sign-in slots makes sign-in list more ids, which shows how many there are.
  const warnBeforeAdd = context.conversation.listPasskeys(person.personId).length >= LOGIN_CREDENTIAL_SLOTS;
  const pending = rememberChallenge(context, { kind: 'add-passkey', ...place, personId: person.personId, label });
  return sendJson(res, 200, {
    challengeId: pending.id,
    warnBeforeAdd,
    options: creationOptions({
      challenge: pending.challenge,
      rpId: place.rpId,
      userId: Buffer.from(person.personId),
      userName: person.name,
    }),
  });
}

async function handleAddPasskeyFinish(req, res, context, person) {
  const body = await readBody(req, res, AUTH_BODY_BYTES);
  if (body === undefined) {
    return undefined;
  }
  const pending = takeChallenge(context, body?.challengeId, 'add-passkey');
  if (!pending || pending.personId !== person.personId) {
    return sendJson(res, 401, { error: PASSKEY_REJECTED });
  }
  const verified = verifyRegistration(body?.credential, pending);
  if (!verified) {
    return sendJson(res, 401, { error: PASSKEY_REJECTED });
  }
  try {
    context.conversation.addPasskey(person.personId, verified, pending.label);
  } catch (error) {
    if (error instanceof MembershipError) {
      return sendJson(res, error.status, { error: error.message });
    }
    context.logger.error(`[boffin] could not save passkey: ${error.message}`);
    return sendJson(res, 500, { error: 'Internal server error.' });
  }
  return sendJson(res, 200, { passkeys: context.conversation.listPasskeys(person.personId) });
}

async function handleLoginOptions(req, res, context) {
  if (!context.conversation.hasPasskey) {
    return sendJson(res, 400, { error: 'Create a passkey to finish signing in.' });
  }
  const body = await readBody(req, res, AUTH_BODY_BYTES);
  if (body === undefined) {
    return undefined;
  }
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  if (!username) {
    return sendJson(res, 400, { error: 'Enter a username.' });
  }
  const place = passkeyOrigin(req.headers.origin ?? '');
  if (!place) {
    return sendJson(res, 400, { error: PASSKEY_UNAVAILABLE });
  }
  const people = context.conversation.peopleByName(username, context.username);
  const allowCredentials = people.flatMap((person) => context.conversation.assertionIds(person.personId));
  const pending = rememberChallenge(context, {
    kind: 'login',
    personIds: people.map((person) => person.personId),
    ...place,
  });
  return sendJson(res, 200, {
    challengeId: pending.id,
    options: requestOptions({
      challenge: pending.challenge,
      rpId: place.rpId,
      allowCredentials: loginAllowList(context, username, allowCredentials),
    }),
  });
}

// Real passkey ids come first, then placeholders. Placeholders are stable for a username,
// so asking twice, or again after a restart, gives the same list. Each placeholder uses a
// byte length that already appears, so length does not mark which entries are real.
function loginAllowList(context, username, realIds) {
  const slots = [...realIds];
  const seen = new Set(realIds);
  const lengths = coverLengths(realIds, storedCredentialLengths(context));
  const counts = new Map(lengths.map((length) => [length, 0]));
  for (const id of realIds) {
    const length = credentialIdByteLength(id);
    if (counts.has(length)) {
      counts.set(length, counts.get(length) + 1);
    }
  }
  let index = 0;
  while (slots.length < LOGIN_CREDENTIAL_SLOTS) {
    const length = rarestLength(counts);
    const cover = coverCredentialId(context, username, index, length);
    index += 1;
    if (seen.has(cover)) {
      continue;
    }
    seen.add(cover);
    counts.set(length, counts.get(length) + 1);
    slots.push(cover);
  }
  return slots;
}

function coverLengths(realIds, storedLengths) {
  const fromReal = uniqueLengths(realIds);
  if (fromReal.length > 0) {
    return fromReal;
  }
  if (storedLengths.length > 0) {
    return storedLengths;
  }
  return [16];
}

function storedCredentialLengths(context) {
  return uniqueLengths(context.conversation.passkeys.map((passkey) => passkey.credentialId));
}

function uniqueLengths(ids) {
  const lengths = [];
  for (const id of ids) {
    const length = credentialIdByteLength(id);
    if (length > 0 && !lengths.includes(length)) {
      lengths.push(length);
    }
  }
  return lengths;
}

function credentialIdByteLength(id) {
  if (typeof id !== 'string' || !id) {
    return 0;
  }
  try {
    return Buffer.from(id, 'base64url').length;
  } catch {
    return 0;
  }
}

function rarestLength(counts) {
  let best = null;
  let bestCount = Infinity;
  for (const [length, count] of counts) {
    if (count < bestCount || (count === bestCount && length < best)) {
      best = length;
      bestCount = count;
    }
  }
  return best;
}

// Keyed with the random key stored in the state file. A key derived from the password would
// let anyone check a password guess offline against a placeholder.
function coverCredentialId(context, username, index, length) {
  const out = Buffer.alloc(length);
  let filled = 0;
  let block = 0;
  while (filled < length) {
    const digest = createHash('sha256')
      .update(context.coverKey)
      .update('\0')
      .update(username)
      .update('\0')
      .update(String(index))
      .update('\0')
      .update(String(block))
      .digest();
    const take = Math.min(digest.length, length - filled);
    digest.copy(out, filled, 0, take);
    filled += take;
    block += 1;
  }
  return out.toString('base64url');
}

async function handleLogin(req, res, context) {
  const body = await readBody(req, res, AUTH_BODY_BYTES);
  if (body === undefined) {
    return undefined;
  }
  const pending = takeChallenge(context, body?.challengeId, 'login');
  const credentialId = typeof body?.credential?.id === 'string' ? body.credential.id : '';
  const stored = credentialId ? context.conversation.credentialById(credentialId) : null;
  const verified = pending
    && stored
    && pending.personIds?.includes(stored.personId)
    && verifyAssertion(body.credential, pending, stored.record);
  if (!verified) {
    return sendJson(res, 401, { error: PASSKEY_REJECTED });
  }
  context.conversation.noteSignCount(verified.credentialId, verified.signCount);
  const person = stored.owner ? ownerPerson(context) : { personId: stored.personId, name: stored.name, owner: false };
  return sendJson(res, 200, finishSignIn(context, person));
}

async function handleJoin(req, res, context) {
  const body = await readBody(req, res, AUTH_BODY_BYTES);
  if (body === undefined) {
    return undefined;
  }
  // Someone already in the conversation cannot make a second identity from a link.
  const signedIn = bearerPerson(context, req);
  if (signedIn && canEnter(signedIn, context.conversation)) {
    return sendJson(res, 403, { error: ALREADY_IN_CONVERSATION });
  }
  const place = passkeyOrigin(req.headers.origin ?? '');
  if (!place) {
    return sendJson(res, 400, { error: PASSKEY_UNAVAILABLE });
  }
  const personId = randomUUID();
  let name;
  try {
    name = context.conversation.prepareJoin(body?.inviteId, body?.name, context.username);
  } catch (error) {
    if (error instanceof MembershipError) {
      return sendJson(res, error.status, { error: error.message });
    }
    throw error;
  }
  const pending = rememberChallenge(context, {
    kind: 'join',
    ...place,
    inviteId: body.inviteId,
    personId,
    name,
  });
  return sendJson(res, 200, {
    challengeId: pending.id,
    options: creationOptions({
      challenge: pending.challenge,
      rpId: place.rpId,
      userId: Buffer.from(personId),
      userName: name,
      excludeCredentials: context.conversation.joinExcludeIds(),
    }),
  });
}

async function handleJoinFinish(req, res, context) {
  const body = await readBody(req, res, AUTH_BODY_BYTES);
  if (body === undefined) {
    return undefined;
  }
  const pending = takeChallenge(context, body?.challengeId, 'join');
  const verified = pending && verifyRegistration(body?.credential, pending);
  if (!verified) {
    return sendJson(res, 401, { error: PASSKEY_REJECTED });
  }
  let name;
  try {
    name = context.conversation.completeJoin({
      inviteId: pending.inviteId,
      personId: pending.personId,
      name: pending.name,
      credential: verified,
      ownerName: context.username,
    });
  } catch (error) {
    if (error instanceof MembershipError) {
      return sendJson(res, error.status, { error: error.message });
    }
    context.logger.error(`[boffin] could not save member: ${error.message}`);
    return sendJson(res, 500, { error: 'Internal server error.' });
  }
  const person = { personId: pending.personId, name, owner: false };
  return sendJson(res, 200, finishSignIn(context, person));
}

function sendSession(res, context, person, openActive) {
  if (openActive && !canEnter(person, context.conversation)) {
    return sendJson(res, 403, { error: NOT_IN_CONVERSATION });
  }
  const list = person.owner || openActive || context.conversation.homeFor(person.personId) === 'chat';
  return sendJson(res, 200, sessionPayload(context, person, !list, null));
}

function sendKeptLog(res, context, person, recordId) {
  if (person.owner) {
    return sendJson(res, 404, { error: 'Not found.' });
  }
  const record = context.conversation.logFor(person.personId, recordId);
  if (!record) {
    return sendJson(res, 404, { error: 'Not found.' });
  }
  const text = formatConversationLog(record.items, {
    model: context.conversation.model,
    exportedAt: record.at,
  });
  return sendJson(res, 200, { filename: conversationLogFilename(new Date(record.at)), text });
}

function sessionPayload(context, person, listed, token) {
  const { conversation } = context;
  const body = listed
    ? { you: publicYou(person, conversation), home: 'list', conversations: conversation.listFor(person.personId) }
    : {
        ...conversation.snapshot(),
        you: publicYou(person, conversation),
        people: conversation.people(context.username),
        invites: person.owner ? conversation.invites : [],
        alumni: person.owner ? conversation.alumni() : [],
        home: 'chat',
        canManage: person.owner,
      };
  if (token) {
    body.token = token;
  }
  return body;
}

function publicYou(person, conversation) {
  return {
    id: person.personId,
    name: person.name,
    owner: person.owner,
    inConversation: canEnter(person, conversation),
  };
}

function ownerPerson(context) {
  return { personId: 'owner', name: context.username, owner: true };
}

function canEnter(person, conversation) {
  return person.owner || conversation.isMember(person.personId);
}

function runMembership(res, action) {
  try {
    return sendJson(res, 200, action());
  } catch (error) {
    if (error instanceof MembershipError) {
      return sendJson(res, error.status, { error: error.message });
    }
    return sendJson(res, 500, { error: 'Internal server error.' });
  }
}

function rememberChallenge(context, fields) {
  // Every entry lives CHALLENGE_MS, so the oldest come first. Drop them before adding one.
  const now = Date.now();
  for (const [key, entry] of context.challenges) {
    if (entry.expires >= now) {
      break;
    }
    context.challenges.delete(key);
  }
  const id = randomUUID();
  const challenge = randomChallenge();
  context.challenges.set(id, { ...fields, challenge, expires: Date.now() + CHALLENGE_MS });
  return { id, challenge };
}

function takeChallenge(context, id, kind) {
  if (typeof id !== 'string') {
    return null;
  }
  const entry = context.challenges.get(id);
  context.challenges.delete(id);
  if (!entry || entry.kind !== kind || entry.expires < Date.now()) {
    return null;
  }
  return entry;
}

function finishSignIn(context, person) {
  const token = issueSession(context, person);
  const showChat = person.owner || context.conversation.homeFor(person.personId) === 'chat';
  return sessionPayload(context, person, !showChat, token);
}

function issueSession(context, person) {
  const token = randomBytes(32).toString('base64url');
  context.sessions.set(token, person);
  return token;
}

// The session behind a Bearer token, or null. Unlike authenticate, it never falls back to Basic.
function bearerPerson(context, req) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  return bearer ? (context.sessions.get(bearer[1]) ?? null) : null;
}

function dropSession(req, context) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  return Boolean(bearer) && context.sessions.delete(bearer[1]);
}

function authenticate(req, context) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (bearer) {
    return context.sessions.get(bearer[1]) ?? null;
  }
  if (context.conversation.hasOwnerPasskey) {
    return null;
  }
  if (!hasBasic(req)) {
    return null;
  }
  const address = requestAddress(req);
  if (!context.passwordAttempts.status(address).ok) {
    return PASSWORD_LIMITED;
  }
  if (!isAuthorized(req, context.expectedUser, context.expectedPassword)) {
    context.passwordAttempts.record(address);
    return null;
  }
  return ownerPerson(context);
}

function hasBasic(req) {
  return BASIC_AUTH.test(req.headers.authorization ?? '');
}

function rejectPasskeyAttempt(req, res, context) {
  const attempt = context.passkeyAttempts.record(requestAddress(req));
  if (attempt.ok) {
    return false;
  }
  sendTooMany(res, attempt.retryAfter);
  return true;
}

function sendAttemptLimit(res, limiter, req) {
  const { retryAfter } = limiter.status(requestAddress(req));
  return sendTooMany(res, retryAfter);
}

function sendTooMany(res, retryAfter) {
  // Close before the body is read so a flood cannot leave bytes for the next request.
  res.setHeader('Retry-After', String(retryAfter));
  return sendJson(res, 429, { error: TOO_MANY_ATTEMPTS }, { close: true });
}

async function readBody(req, res, limit = MAX_BODY_BYTES) {
  try {
    return await readJsonBody(req, limit);
  } catch (error) {
    const status = error.status ?? 400;
    sendJson(res, status, { error: error.message }, { close: status === 413 });
    return undefined;
  }
}

function isAuthorized(req, expectedUser, expectedPassword) {
  const match = BASIC_AUTH.exec(req.headers.authorization ?? '');
  if (match === null) {
    return false;
  }
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon === -1) {
    return false;
  }
  const userOk = timingSafeEqual(digest(decoded.slice(0, colon)), expectedUser);
  const passwordOk = timingSafeEqual(digest(decoded.slice(colon + 1)), expectedPassword);
  return userOk && passwordOk;
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function sendJson(res, status, body, { close = false } = {}) {
  const payload = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  };
  if (close) {
    headers.Connection = 'close';
  }
  res.writeHead(status, headers);
  if (close) {
    res.end(payload, () => res.destroy());
  } else {
    res.end(payload);
  }
}

async function sendStatic(req, res, relativePath) {
  const file = path.join(PROJECT_ROOT, relativePath);
  let body;
  try {
    body = await fs.readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return sendJson(res, 404, { error: 'Not found.' });
    }
    throw error;
  }
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES.get(path.extname(file)) ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
