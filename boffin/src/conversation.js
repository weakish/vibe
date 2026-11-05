import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { applyOp } from '../shared/transcript.js';
import { buildAgentArgs, runAgent as runAgentProcess } from './agent.js';
import { createRunState, eventToOps, finishOps } from './events.js';
import { createMediaStore, decodeImageBytes, readWorkspaceImage, safeFileName, sniffImage } from './media.js';

const STATE_VERSION = 1;
const NAME_MAX = 40;
const COVER_KEY_BYTES = 32;

const STATE_KEYS = new Set([
  'version',
  'chatId',
  'items',
  'activeId',
  'startedAt',
  'members',
  'identities',
  'invites',
  'kept',
  'ownerPasskey',
  'passkeys',
  'coverKey',
]);
const SAVE_FAILURE_TEXT = 'Could not save this conversation. It will be lost when the server restarts.';

export class BusyError extends Error {
  constructor() {
    super('The agent is still working on the previous message.');
    this.name = 'BusyError';
  }
}

export class StateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StateError';
  }
}

export class MembershipError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'MembershipError';
    this.status = status;
  }
}

// One shared conversation per server: a single transcript bound to a single
// CLI chat, always run in the configured working directory with the configured model.
export class Conversation {
  #run = null;

  constructor({ model, workdir, agentBin, force, stateFile, runAgent = runAgentProcess, logger = console }) {
    this.model = model;
    this.workdir = workdir;
    this.agentBin = agentBin;
    this.force = force;
    this.stateFile = stateFile;
    this.runAgent = runAgent;
    this.logger = logger;
    this.media = createMediaStore(path.join(path.dirname(stateFile), 'media'));

    const saved = loadState(stateFile);
    this.chatId = saved.chatId;
    this.items = saved.items;
    this.activeId = saved.activeId;
    this.startedAt = saved.startedAt;
    this.members = saved.members;
    this.identities = saved.identities;
    this.invites = saved.invites;
    this.kept = saved.kept;
    this.passkeys = saved.passkeys;
    // Sign-in placeholders. Not derived from the password, and kept so a restart leaves them unchanged.
    this.coverKey = saved.coverKey;
    if (saved.writeCoverKey) {
      try {
        this.#save();
      } catch (error) {
        throw new StateError(`Cannot write state file ${stateFile} to store its cover key: ${error.message}`);
      }
    }
  }

  get busy() {
    return this.#run !== null;
  }

  snapshot() {
    return {
      model: this.model,
      project: path.basename(this.workdir),
      busy: this.busy,
      items: this.items,
    };
  }

  readMedia(id) {
    return this.media.read(id);
  }

  // Starts one agent run. `emit` receives each transcript operation as it is applied.
  // The returned promise settles after the run has finished and state has been saved.
  // Throws BusyError synchronously, before any file is written.
  start(text, emit, attachments = [], author = '') {
    if (this.busy) {
      throw new BusyError();
    }
    const stored = this.#storeUploads(attachments);
    const run = { cancelled: false, handle: null, finished: null };
    this.#run = run;
    run.finished = this.#execute(text, stored, emit, run, author);
    return run.finished;
  }

  cancel() {
    const run = this.#run;
    if (!run) {
      return false;
    }
    run.cancelled = true;
    run.handle?.cancel();
    return true;
  }

  // Second Ctrl+C. cancel() only schedules SIGKILL; this sends it now.
  kill() {
    const run = this.#run;
    if (!run) {
      return false;
    }
    run.cancelled = true;
    if (typeof run.handle?.kill === 'function') {
      run.handle.kill();
    } else {
      run.handle?.cancel();
    }
    return true;
  }

  async stop() {
    this.cancel();
    await this.#run?.finished;
  }

  reset(at = new Date().toISOString()) {
    if (this.busy) {
      throw new BusyError();
    }
    this.#commit(() => {
      this.#endActive(at);
    });
  }

  get hasPasskey() {
    return this.passkeys.length > 0;
  }

  get hasOwnerPasskey() {
    return this.passkeys.some((passkey) => passkey.personId === 'owner');
  }

  isMember(personId) {
    return this.members.includes(personId);
  }

  people(ownerName) {
    return [
      { id: 'owner', name: ownerName, owner: true },
      ...this.members.map((id) => {
        const person = this.identity(id);
        return { id, name: person?.name ?? '', owner: false };
      }),
    ];
  }

  alumni() {
    const active = new Set(this.members);
    return this.identities
      .filter((entry) => !active.has(entry.id))
      .map((entry) => ({ id: entry.id, name: entry.name, owner: false }));
  }

  // One entry for the active conversation when they are still in it, plus one
  // exportable record for every kept log they are allowed to download.
  listFor(personId) {
    const conversations = [];
    if (this.isMember(personId)) {
      conversations.push({ id: this.activeId, active: true });
    }
    for (const record of this.kept) {
      if (record.personIds.includes(personId)) {
        conversations.push({ id: record.id, active: false, at: record.at });
      }
    }
    return conversations;
  }

  homeFor(personId) {
    const conversations = this.listFor(personId);
    if (conversations.length === 1 && conversations[0].active) {
      return 'chat';
    }
    return 'list';
  }

  logFor(personId, recordId) {
    const record = this.kept.find((entry) => entry.id === recordId && entry.personIds.includes(personId));
    if (!record) {
      return null;
    }
    return { at: record.at, items: record.items };
  }

  createInvite() {
    const invite = { id: randomUUID(), createdAt: new Date().toISOString() };
    this.#commit(() => {
      this.invites.push(invite);
    });
    return invite;
  }

  cancelInvite(inviteId) {
    if (!this.invites.some((invite) => invite.id === inviteId)) {
      throw new MembershipError('This invitation has already been used.', 404);
    }
    this.#commit(() => {
      this.invites = this.invites.filter((invite) => invite.id !== inviteId);
    });
  }

  // Checks the invite and the name. The invite stays open until the passkey is stored.
  prepareJoin(inviteId, name, ownerName) {
    if (!this.invites.some((invite) => invite.id === inviteId)) {
      throw new MembershipError('This invitation has already been used.', 404);
    }
    // Every name anyone has ever joined with stays taken, even after they leave or a new chat starts.
    const taken = new Set([ownerName, ...this.identities.map((entry) => entry.name)]);
    return this.#normalizeName(name, taken);
  }

  completeJoin({ inviteId, personId, name, credential, ownerName }) {
    const checked = this.prepareJoin(inviteId, name, ownerName);
    if (this.passkeys.some((passkey) => passkey.credentialId === credential.credentialId)) {
      throw new MembershipError('That passkey is already saved.', 409);
    }
    this.#commit(() => {
      this.identities.push({ id: personId, name: checked });
      this.members.push(personId);
      this.invites = this.invites.filter((invite) => invite.id !== inviteId);
      this.#rememberPasskey(personId, credential);
    });
    return checked;
  }

  addMember(personId, ownerName) {
    if (this.isMember(personId)) {
      throw new MembershipError('That person is already in the conversation.', 409);
    }
    const person = this.identity(personId);
    if (!person) {
      throw new MembershipError('That person is not known.', 404);
    }
    // Only current members count. Names are reserved at join time, so this check only
    // matters for duplicates saved before that rule.
    const taken = new Set([ownerName, ...this.members.map((id) => this.identity(id)?.name).filter(Boolean)]);
    this.#normalizeName(person.name, taken);
    this.#commit(() => {
      this.members.push(personId);
    });
  }

  removeMember(personId, at = new Date().toISOString()) {
    if (!this.isMember(personId)) {
      throw new MembershipError('That person is not in the conversation.', 404);
    }
    this.#commit(() => {
      this.kept.push({
        id: randomUUID(),
        at,
        items: structuredClone(this.items),
        personIds: [personId],
      });
      this.members = this.members.filter((id) => id !== personId);
    });
  }

  setOwnerPasskey(credential) {
    this.addPasskey('owner', credential);
  }

  listPasskeys(personId) {
    return this.passkeys
      .filter((passkey) => passkey.personId === personId)
      .map((passkey) => ({ id: passkey.id, createdAt: passkey.createdAt, label: passkey.label || '' }));
  }

  addPasskey(personId, credential, label = '') {
    if (this.passkeys.some((passkey) => passkey.credentialId === credential.credentialId)) {
      throw new MembershipError('That passkey is already saved.', 409);
    }
    let saved;
    this.#commit(() => {
      saved = this.#rememberPasskey(personId, credential, checkedPasskeyLabel(label));
    });
    return { id: saved.id, createdAt: saved.createdAt, label: saved.label };
  }

  removePasskey(personId, passkeyId) {
    const mine = this.passkeys.filter((passkey) => passkey.personId === personId);
    if (!mine.some((passkey) => passkey.id === passkeyId)) {
      throw new MembershipError('Not found.', 404);
    }
    if (mine.length < 2) {
      throw new MembershipError('Keep at least one passkey.', 400);
    }
    this.#commit(() => {
      this.passkeys = this.passkeys.filter((passkey) => passkey.id !== passkeyId);
    });
  }

  peopleByName(name, ownerName) {
    if (name === ownerName) {
      return this.hasOwnerPasskey ? [{ personId: 'owner', owner: true, name: ownerName }] : [];
    }
    return this.identities
      .filter((entry) => entry.name === name && this.passkeys.some((passkey) => passkey.personId === entry.id))
      .map((entry) => ({ personId: entry.id, owner: false, name: entry.name }));
  }

  assertionIds(personId) {
    return this.passkeys.filter((passkey) => passkey.personId === personId).map((passkey) => passkey.credentialId);
  }

  // Passkeys that a new join must not register on the same device: the owner's and
  // the current members'. Someone who has left is not excluded, so they can join
  // again, but only under a new name.
  joinExcludeIds() {
    return this.passkeys
      .filter((passkey) => passkey.personId === 'owner' || this.isMember(passkey.personId))
      .map((passkey) => passkey.credentialId);
  }

  credentialById(credentialId) {
    const passkey = this.passkeys.find((entry) => entry.credentialId === credentialId);
    if (!passkey) {
      return null;
    }
    if (passkey.personId === 'owner') {
      return { owner: true, personId: 'owner', record: passkey };
    }
    const person = this.identity(passkey.personId);
    if (!person) {
      return null;
    }
    return { owner: false, personId: person.id, name: person.name, record: passkey };
  }

  noteSignCount(credentialId, signCount) {
    const passkey = this.passkeys.find((entry) => entry.credentialId === credentialId);
    if (!passkey) {
      return;
    }
    this.#commit(() => {
      const current = this.passkeys.find((entry) => entry.credentialId === credentialId);
      current.signCount = signCount;
    });
  }

  #rememberPasskey(personId, credential, label = '', createdAt = new Date().toISOString()) {
    const record = {
      id: randomUUID(),
      personId,
      credentialId: credential.credentialId,
      publicKey: credential.publicKey,
      signCount: credential.signCount,
      createdAt,
      label,
    };
    this.passkeys.push(record);
    return record;
  }

  identity(personId) {
    return this.identities.find((entry) => entry.id === personId) ?? null;
  }

  #normalizeName(name, taken) {
    if (typeof name !== 'string') {
      throw new MembershipError('Enter a name.');
    }
    const trimmed = name.trim();
    if (!trimmed) {
      throw new MembershipError('Enter a name.');
    }
    if ([...trimmed].length > NAME_MAX) {
      throw new MembershipError('A name may be up to 40 characters.');
    }
    if (/[\u0000-\u001f]/.test(trimmed)) {
      throw new MembershipError('Enter a name.');
    }
    if (taken.has(trimmed)) {
      throw new MembershipError('That name is already used.');
    }
    return trimmed;
  }

  #endActive(at) {
    if (this.items.length > 0 || this.members.length > 0) {
      this.kept.push({
        id: randomUUID(),
        at,
        items: structuredClone(this.items),
        personIds: [...this.members],
      });
    }
    this.items = [];
    this.chatId = null;
    this.members = [];
    this.invites = [];
    this.activeId = randomUUID();
    this.startedAt = at;
  }

  #capture() {
    return {
      chatId: this.chatId,
      items: this.items,
      activeId: this.activeId,
      startedAt: this.startedAt,
      members: this.members.slice(),
      identities: this.identities.slice(),
      invites: this.invites.slice(),
      kept: this.kept.slice(),
      passkeys: this.passkeys.map((passkey) => ({ ...passkey })),
    };
  }

  #restore(previous) {
    Object.assign(this, previous);
  }

  #commit(apply) {
    const previous = this.#capture();
    try {
      apply();
      this.#save();
    } catch (error) {
      this.#restore(previous);
      throw error;
    }
  }

  async #execute(text, stored, emit, run, author) {
    const state = createRunState();
    const emitOps = (ops) => {
      for (const op of ops) {
        const imageFailed = this.#materialize(op);
        applyOp(this.items, op);
        emit(op);
        if (imageFailed) {
          const notice = {
            op: 'add',
            item: {
              id: randomUUID(),
              role: 'notice',
              level: 'error',
              text: 'An image from the agent could not be saved.',
            },
          };
          applyOp(this.items, notice);
          emit(notice);
        }
      }
    };

    try {
      const user = { id: randomUUID(), role: 'user', text };
      if (author) {
        user.author = author;
      }
      if (stored.length > 0) {
        user.attachments = stored.map((file) => file.attachment);
      }
      emitOps([{ op: 'add', item: user }]);
      // Other clients already have this turn. Keep it if the process stops during the run.
      // A failed save is reported once, from the final save. It is not a crashed run.
      try {
        this.#save();
      } catch {
        return;
      }
      if (run.cancelled) {
        emitOps(finishOps({ error: null, code: null, signal: null, stderr: '' }, state, { cancelled: true }));
        return;
      }
      run.handle = this.runAgent({
        bin: this.agentBin,
        args: buildAgentArgs({
          model: this.model,
          force: this.force,
          resumeId: this.chatId,
          prompt: agentPrompt(text, stored, author),
          imagePaths: stored.filter((file) => file.image).map((file) => file.path),
        }),
        cwd: this.workdir,
        onEvent: (event) => {
          emitOps(eventToOps(event, state));
          if (state.chatId) {
            this.chatId = state.chatId;
          }
          this.#saveDuringRun();
        },
        logger: this.logger,
      });
      // Stop can arrive after the run is reserved and before spawn returns a handle.
      if (run.cancelled) {
        run.handle.cancel();
      }
      const outcome = await run.handle.done;
      if (outcome.error || (outcome.code !== 0 && !run.cancelled)) {
        this.logger.error(`[boffin] agent run failed: ${outcome.error?.message ?? `exit ${outcome.code}`}`);
      }
      emitOps(finishOps(outcome, state, { cancelled: run.cancelled }));
    } catch (error) {
      this.logger.error(`[boffin] agent run crashed: ${error.stack || error}`);
      emitOps([
        {
          op: 'add',
          item: { id: randomUUID(), role: 'notice', level: 'error', text: 'Unexpected server error. See the server log.' },
        },
      ]);
    } finally {
      this.#run = null;
      try {
        this.#save();
      } catch {
        emitOps([
          {
            op: 'add',
            item: { id: randomUUID(), role: 'notice', level: 'error', text: SAVE_FAILURE_TEXT },
          },
        ]);
        throw new Error(SAVE_FAILURE_TEXT);
      }
    }
  }

  #storeUploads(attachments) {
    if (attachments.length === 0) {
      return [];
    }
    const stash = path.join(this.workdir, '.boffin');
    const dir = path.join(stash, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(stash, '.gitignore'), '*\n');
    return attachments.map((attachment) => {
      const name = safeFileName(attachment.name);
      const filePath = path.join(dir, `${randomUUID()}-${name}`);
      fs.writeFileSync(filePath, attachment.bytes, { mode: 0o600 });
      const mime = sniffImage(attachment.bytes);
      const saved = mime ? this.media.save({ bytes: attachment.bytes, name }) : null;
      return {
        path: filePath,
        name,
        image: Boolean(saved),
        attachment: saved ?? { name },
      };
    });
  }

  // Replaces image bytes with a media id before the operation is stored or sent.
  // A disk error drops that image and reports it; the rest of the operation still lands.
  #materialize(op) {
    let failed = false;
    if (op?.op === 'add' && op.item?.images) {
      const resolved = this.#resolveImages(op.item.images);
      op.item.images = resolved.images;
      failed = resolved.failed;
      if (op.item.images.length === 0) {
        delete op.item.images;
      }
    }
    if (op?.op === 'set' && op.patch?.images) {
      const resolved = this.#resolveImages(op.patch.images);
      op.patch.images = resolved.images;
      failed = failed || resolved.failed;
      if (op.patch.images.length === 0) {
        delete op.patch.images;
      }
    }
    return failed;
  }

  #resolveImages(images) {
    const resolved = [];
    let failed = false;
    for (const image of images) {
      if (image && typeof image.id === 'string' && typeof image.mime === 'string') {
        resolved.push({ id: image.id, name: safeFileName(image.name), mime: image.mime });
        continue;
      }
      const bytes = decodeImageBytes(image?.data) ?? readWorkspaceImage(this.workdir, image?.filePath);
      let saved = null;
      try {
        saved = bytes ? this.media.save({ bytes, name: image?.name }) : null;
      } catch (error) {
        failed = true;
        this.logger.error(`[boffin] could not store an image: ${error.message}`);
      }
      if (saved) {
        resolved.push(saved);
      }
    }
    return { images: resolved, failed };
  }

  // A mid-run save keeps the partial reply. The final save still reports a lasting failure.
  #saveDuringRun() {
    try {
      this.#save();
    } catch (error) {
      this.logger.error(`[boffin] could not save the running conversation: ${error.message}`);
    }
  }

  #save() {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      const temp = `${this.stateFile}.tmp`;
      const payload = JSON.stringify({
        version: STATE_VERSION,
        chatId: this.chatId,
        items: this.items,
        activeId: this.activeId,
        startedAt: this.startedAt,
        members: this.members,
        identities: this.identities,
        invites: this.invites,
        kept: this.kept,
        passkeys: this.passkeys,
        coverKey: this.coverKey.toString('base64url'),
      });
      // Flush before rename so a crash cannot publish a half-written file under the real name.
      fs.writeFileSync(temp, payload, { mode: 0o600 });
      const fd = fs.openSync(temp, 'r');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, this.stateFile);
    } catch (error) {
      this.logger.error(`[boffin] could not save ${this.stateFile}: ${error.message}`);
      throw error;
    }
  }
}

// A missing file is a new chat. Anything we cannot use as version-1 state is
// refused: treating it as empty would overwrite it on the next save.
function loadState(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return readRoster(file, { chatId: null, items: [] }, { fresh: true });
    }
    throw new StateError(`Cannot read state file ${file}: ${error.message}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new StateError(`State file ${file} is not valid JSON. Refusing to load it so it is not overwritten.`);
  }

  assertSupportedState(file, data);
  return readRoster(file, data);
}

function assertSupportedState(file, data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new StateError(`State file ${file} must contain a JSON object.`);
  }
  const unknown = Object.keys(data).filter((key) => !STATE_KEYS.has(key));
  if (unknown.length > 0) {
    throw new StateError(`State file ${file} has unknown field(s): ${unknown.join(', ')}.`);
  }
  if (data.version !== STATE_VERSION) {
    throw new StateError(
      `State file ${file} is version ${JSON.stringify(data.version)}, expected ${STATE_VERSION}. Refusing to load it so it is not overwritten.`,
    );
  }
  if (!(data.chatId === null || typeof data.chatId === 'string')) {
    throw new StateError(`State file ${file} has an invalid chatId.`);
  }
  if (!Array.isArray(data.items) || data.items.some((item) => !isTranscriptItem(item))) {
    throw new StateError(`State file ${file} has invalid items.`);
  }
}

function agentPrompt(text, stored, author) {
  const body = stored.length === 0 ? text : `${text || 'Please look at the attached files.'}\n\nAttached files:\n${stored.map((file) => `- ${file.path}`).join('\n')}`;
  return author ? `${author}: ${body}` : body;
}

function readRoster(file, data, { fresh = false } = {}) {
  const activeId = typeof data.activeId === 'string' && data.activeId ? data.activeId : randomUUID();
  const startedAt = typeof data.startedAt === 'string' && data.startedAt ? data.startedAt : new Date().toISOString();
  return {
    chatId: data.chatId,
    items: data.items,
    activeId,
    startedAt,
    members: readMembers(file, data.members),
    identities: readIdentities(file, data.identities),
    invites: readInvites(file, data.invites),
    kept: readKept(file, data.kept),
    passkeys: readPasskeys(file, data),
    ...readCoverKey(file, data.coverKey, fresh),
  };
}

// Missing from a new or older file: generate one. An older file is written immediately
// so the next restart uses the same key. A missing file waits for the next save.
function readCoverKey(file, value, fresh) {
  if (value === undefined) {
    return { coverKey: randomBytes(COVER_KEY_BYTES), writeCoverKey: !fresh };
  }
  const key = typeof value === 'string' ? Buffer.from(value, 'base64url') : Buffer.alloc(0);
  if (key.length !== COVER_KEY_BYTES || key.toString('base64url') !== value) {
    throw new StateError(`State file ${file} has an invalid cover key.`);
  }
  return { coverKey: key, writeCoverKey: false };
}

function readMembers(file, members) {
  if (members === undefined) {
    return [];
  }
  if (!Array.isArray(members) || members.some((id) => typeof id !== 'string' || !id)) {
    throw new StateError(`State file ${file} has invalid members.`);
  }
  return members;
}

function readIdentities(file, identities) {
  if (identities === undefined) {
    return [];
  }
  if (!Array.isArray(identities) || identities.some((person) => !isIdentity(person))) {
    throw new StateError(`State file ${file} has invalid identities.`);
  }
  return identities.map((person) => ({ id: person.id, name: person.name }));
}

function readInvites(file, invites) {
  if (invites === undefined) {
    return [];
  }
  if (!Array.isArray(invites) || invites.some((invite) => typeof invite?.id !== 'string' || typeof invite?.createdAt !== 'string')) {
    throw new StateError(`State file ${file} has invalid invites.`);
  }
  return invites;
}

function readKept(file, kept) {
  if (kept === undefined) {
    return [];
  }
  if (!Array.isArray(kept) || kept.some((record) => !isKeptRecord(record))) {
    throw new StateError(`State file ${file} has invalid kept logs.`);
  }
  return kept;
}

function readPasskeys(file, data) {
  if (data.passkeys !== undefined) {
    if (!Array.isArray(data.passkeys) || data.passkeys.some((passkey) => !isStoredPasskey(passkey))) {
      throw new StateError(`State file ${file} has invalid passkeys.`);
    }
    return data.passkeys.map((passkey) => ({ ...passkey, label: passkey.label?.trim() ?? '' }));
  }
  const passkeys = [];
  if (data.ownerPasskey != null) {
    if (!isPasskey(data.ownerPasskey)) {
      throw new StateError(`State file ${file} has an invalid owner passkey.`);
    }
    passkeys.push(storedPasskey('owner', data.ownerPasskey));
  }
  for (const person of data.identities ?? []) {
    if (isPasskey(person)) {
      passkeys.push(storedPasskey(person.id, person));
    }
  }
  return passkeys;
}

function storedPasskey(personId, passkey) {
  return {
    id: randomUUID(),
    personId,
    credentialId: passkey.credentialId,
    publicKey: passkey.publicKey,
    signCount: passkey.signCount,
    createdAt: '',
    label: '',
  };
}

function isIdentity(person) {
  if (person === null || typeof person !== 'object' || typeof person.id !== 'string' || typeof person.name !== 'string') {
    return false;
  }
  if (person.credentialId === undefined && person.publicKey === undefined && person.signCount === undefined) {
    return true;
  }
  return isPasskey(person);
}

function isStoredPasskey(passkey) {
  return (
    isPasskey(passkey) &&
    typeof passkey.id === 'string' &&
    typeof passkey.personId === 'string' &&
    typeof passkey.createdAt === 'string' &&
    (passkey.label === undefined || validStoredLabel(passkey.label))
  );
}

function validStoredLabel(label) {
  return typeof label === 'string' && [...label].length <= NAME_MAX && !/[\u0000-\u001f]/.test(label);
}

export function checkedPasskeyLabel(label) {
  if (typeof label !== 'string' || /[\u0000-\u001f]/.test(label)) {
    throw new MembershipError('That label is not valid.');
  }
  const trimmed = label.trim();
  if ([...trimmed].length > NAME_MAX) {
    throw new MembershipError('A label may be up to 40 characters.');
  }
  return trimmed;
}

function isPasskey(passkey) {
  return (
    passkey !== null &&
    typeof passkey === 'object' &&
    typeof passkey.credentialId === 'string' &&
    typeof passkey.signCount === 'number' &&
    passkey.publicKey !== null &&
    typeof passkey.publicKey === 'object'
  );
}

function isKeptRecord(record) {
  return (
    record !== null &&
    typeof record === 'object' &&
    typeof record.id === 'string' &&
    typeof record.at === 'string' &&
    Array.isArray(record.personIds) &&
    record.personIds.every((id) => typeof id === 'string') &&
    Array.isArray(record.items) &&
    record.items.every((item) => isTranscriptItem(item))
  );
}

function isTranscriptItem(item) {
  return (
    item !== null &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    typeof item.id === 'string' &&
    typeof item.role === 'string'
  );
}
