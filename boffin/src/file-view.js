import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_MEDIA_BYTES,
  downloadMime,
  filesChangedSince,
  isPublishableRelative,
  readWorkspaceFile,
  resolveWorkspaceFile,
  safeFileName,
  sniffImage,
} from './media.js';

const STASH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_WORKDIR_LIST = 400;

function isStashEntryFor(entry, safe) {
  if (entry === safe) {
    return true;
  }
  const splitAt = entry.length - safe.length - 1;
  if (splitAt <= 0 || entry[splitAt] !== '-' || entry.slice(splitAt + 1) !== safe) {
    return false;
  }
  return STASH_UUID.test(entry.slice(0, splitAt));
}

function sniffRegularHeader(full) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let fd;
  try {
    fd = fs.openSync(full, flags);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 12) {
      return null;
    }
    const header = Buffer.alloc(12);
    const n = fs.readSync(fd, header, 0, 12, 0);
    return sniffImage(header.subarray(0, n));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

function normalizeRelative(relative) {
  return relative.split(path.sep).join('/');
}

function mediaIdsFromItems(items) {
  const ids = new Set();
  if (!Array.isArray(items)) {
    return ids;
  }
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    for (const list of [item.attachments, item.images]) {
      if (!Array.isArray(list)) {
        continue;
      }
      for (const file of list) {
        if (file?.id && typeof file.id === 'string') {
          ids.add(file.id);
        }
      }
    }
  }
  return ids;
}

function attachmentNamesWithoutId(items) {
  const names = new Set();
  for (const item of items ?? []) {
    if (item?.role !== 'user' || !Array.isArray(item.attachments)) {
      continue;
    }
    for (const file of item.attachments) {
      if (file?.name && !file?.id) {
        names.add(safeFileName(file.name));
      }
    }
  }
  return names;
}

export function findStashUpload(workdir, displayName) {
  const safe = safeFileName(displayName);
  if (!safe) {
    return null;
  }
  const dir = path.join(workdir, '.boffin', 'uploads');
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let best = null;
  let bestMtime = 0;
  for (const entry of entries) {
    if (!isStashEntryFor(entry, safe)) {
      continue;
    }
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > MAX_MEDIA_BYTES) {
      continue;
    }
    const resolved = resolveWorkspaceFile(workdir, path.join('.boffin', 'uploads', entry));
    if (!resolved) {
      continue;
    }
    if (stat.mtimeMs >= bestMtime) {
      bestMtime = stat.mtimeMs;
      const image = sniffRegularHeader(full);
      const mime = image || downloadMime(safe);
      best = {
        relative: normalizeRelative(resolved.relative),
        name: safe,
        size: stat.size,
        mime,
        inline: Boolean(image) || mime === 'application/pdf',
      };
    }
  }
  return best;
}

export function listConversationFiles(conversation, items = conversation.items) {
  const files = [];

  for (const id of mediaIdsFromItems(items)) {
    const file = conversation.readMedia(id);
    if (!file) {
      continue;
    }
    files.push({
      key: `media:${id}`,
      kind: 'media',
      id,
      name: file.name,
      mime: file.mime,
      size: file.bytes.length,
      inline: file.inline || file.mime === 'application/pdf',
    });
  }

  for (const name of attachmentNamesWithoutId(items)) {
    const stash = findStashUpload(conversation.workdir, name);
    if (!stash) {
      continue;
    }
    files.push({
      key: `stash:${stash.relative}`,
      kind: 'stash',
      path: stash.relative,
      name: stash.name,
      mime: stash.mime,
      size: stash.size,
      inline: stash.inline,
    });
  }

  files.sort((left, right) => left.name.localeCompare(right.name));
  return files;
}

export function listWorkdirFiles(workdir, { limit = MAX_WORKDIR_LIST } = {}) {
  let root;
  try {
    root = fs.realpathSync(workdir);
  } catch {
    return [];
  }
  const files = [];
  for (const full of filesChangedSince(workdir, 0, limit)) {
    const relative = normalizeRelative(path.relative(root, full));
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    const image = sniffRegularHeader(full);
    const mime = image || downloadMime(relative);
    files.push({
      key: `workdir:${relative}`,
      kind: 'workdir',
      path: relative,
      name: path.basename(relative),
      mime,
      size: stat.size,
      inline: Boolean(image) || mime === 'application/pdf',
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

export function readStashFile(conversation, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) {
    return null;
  }
  const normalized = relativePath.replace(/\\/g, '/');
  if (!normalized.startsWith('.boffin/uploads/')) {
    return null;
  }
  const entry = listConversationFiles(conversation).find((item) => item.kind === 'stash' && item.path === normalized);
  if (!entry) {
    return null;
  }
  const file = readWorkspaceFile(conversation.workdir, normalized);
  if (!file) {
    return null;
  }
  const image = sniffImage(file.bytes);
  const mime = image || downloadMime(entry.name);
  const inline = Boolean(image) || mime === 'application/pdf';
  return { bytes: file.bytes, mime, name: entry.name, inline };
}

export function readWorkdirFileForOwner(conversation, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) {
    return null;
  }
  const normalized = relativePath.replace(/\\/g, '/');
  if (!isPublishableRelative(normalized)) {
    return null;
  }
  const file = readWorkspaceFile(conversation.workdir, normalized);
  if (!file) {
    return null;
  }
  const image = sniffImage(file.bytes);
  const mime = image || downloadMime(file.relative);
  const inline = Boolean(image) || mime === 'application/pdf';
  return {
    bytes: file.bytes,
    mime,
    name: path.basename(file.relative),
    inline,
  };
}
