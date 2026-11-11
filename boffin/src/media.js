import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MAX_PUBLISHED_FILES = 8;
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function safeFileName(name) {
  const base = path
    .basename(String(name ?? ''))
    .replace(/[^\p{L}\p{M}\p{N}._\- ()[\]（）「」【】]+/gu, '_')
    .replace(/^\.+/, '')
    .trim();
  // Slice by character so a name is not cut in the middle of a code point.
  return [...(base || 'file')].slice(0, 80).join('');
}

export function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) {
    return null;
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

// Bytes the model claims are an image. Accepts raw base64 or a data URL.
export function decodeImageBytes(data) {
  if (typeof data !== 'string' || !data.trim()) {
    return null;
  }
  const trimmed = data.trim().replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, '');
  if (trimmed.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4) {
    return null;
  }
  const bytes = Buffer.from(trimmed, 'base64');
  return sniffImage(bytes) ? bytes : null;
}

export function createMediaStore(dir) {
  return {
    save({ bytes, name }) {
      const mime = sniffImage(bytes);
      if (!mime || bytes.length > MAX_MEDIA_BYTES) {
        return null;
      }
      return writeMedia(dir, bytes, name, mime);
    },

    // A file the agent created or changed. Images stay images. Anything else is
    // stored for download and is not served as a page the browser would run.
    saveFile({ bytes, name }) {
      if (!bytes || bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) {
        return null;
      }
      const mime = sniffImage(bytes) || downloadMime(name);
      return writeMedia(dir, bytes, name, mime);
    },

    read(id) {
      if (!MEDIA_ID.test(id)) {
        return null;
      }
      const file = path.join(dir, id);
      let bytes;
      let meta;
      try {
        // A symlink in the workdir can point at an arbitrarily large file. Refuse it
        // before the read, and refuse again if the opened file is no longer a small regular file.
        bytes = readRegularFileSync(file, MAX_MEDIA_BYTES);
        if (!bytes) {
          return null;
        }
        const metaBytes = readRegularFileSync(`${file}.json`, 64 * 1024);
        if (!metaBytes) {
          return null;
        }
        meta = JSON.parse(metaBytes.toString('utf8'));
      } catch {
        return null;
      }
      if (!bytes || bytes.length > MAX_MEDIA_BYTES) {
        return null;
      }
      const sniffed = sniffImage(bytes);
      const mime = sniffed || (typeof meta?.mime === 'string' ? meta.mime : '');
      if (!sniffed && !DOWNLOAD_MIMES.has(mime)) {
        return null;
      }
      return { bytes, mime: sniffed || mime, name: safeFileName(meta?.name), inline: Boolean(sniffed) };
    },
  };
}

function readRegularFileSync(file, maxBytes) {
  const listed = fs.lstatSync(file);
  if (!listed.isFile() || listed.isSymbolicLink() || listed.size > maxBytes) {
    return null;
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) {
      return null;
    }
    // readFileSync uses its own stat, and when that size is 0 it reads until EOF.
    const size = stat.size;
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const n = fs.readSync(fd, buffer, offset, size - offset, offset);
      if (n === 0) {
        return buffer.subarray(0, offset);
      }
      offset += n;
    }
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

const DOWNLOAD_MIMES = new Set([
  'application/octet-stream',
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain; charset=utf-8',
]);

const DOWNLOAD_MIME_BY_EXT = new Map([
  ['.pdf', 'application/pdf'],
  ['.zip', 'application/zip'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/plain; charset=utf-8'],
  ['.csv', 'text/plain; charset=utf-8'],
  ['.json', 'text/plain; charset=utf-8'],
]);

function downloadMime(name) {
  return DOWNLOAD_MIME_BY_EXT.get(path.extname(String(name ?? '')).toLowerCase()) ?? 'application/octet-stream';
}

function writeMedia(dir, bytes, name, mime) {
  const id = randomUUID();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id), bytes, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ name: safeFileName(name), mime }), { mode: 0o600 });
  return { id, name: safeFileName(name), mime };
}

// Reads an image file only when it stays inside workdir after resolving symlinks.
export function readWorkspaceImage(workdir, filePath) {
  const file = readWorkspaceFile(workdir, filePath);
  return file && sniffImage(file.bytes) ? file.bytes : null;
}

// Reads a regular file inside workdir. A symlink that resolves outside is refused.
export function readWorkspaceFile(workdir, filePath) {
  const resolved = resolveWorkspaceFile(workdir, filePath);
  if (!resolved) {
    return null;
  }
  try {
    // Cap the read. A stat-then-readFileSync can follow a swapped symlink or a file that grew past the cap.
    const bytes = readRegularFileSync(resolved.full, MAX_MEDIA_BYTES);
    if (!bytes?.length) {
      return null;
    }
    return { bytes, full: resolved.full, relative: resolved.relative };
  } catch {
    return null;
  }
}

export function resolveWorkspaceFile(workdir, filePath) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
    return null;
  }
  let root;
  let resolved;
  try {
    root = fs.realpathSync(workdir);
    resolved = fs.realpathSync(path.resolve(workdir, filePath));
  } catch {
    return null;
  }
  if (!isInsideDirectory(root, resolved)) {
    return null;
  }
  const relative = path.relative(root, resolved);
  if (!isPublishableRelative(relative)) {
    return null;
  }
  return { full: resolved, relative };
}

// Sign-in config, conversation state, and VCS metadata are not offered for download.
export function isPublishableRelative(relative) {
  if (!relative || relative === 'config.json') {
    return false;
  }
  const parts = relative.split(path.sep);
  if (parts.includes('.git') || parts.includes('node_modules')) {
    return false;
  }
  if (parts[0] === 'data' || (parts[0] === 'public' && parts[1] === 'dist')) {
    return false;
  }
  if (parts[0] === '.boffin' && parts[1] !== 'uploads') {
    return false;
  }
  return true;
}

// Paths named in a reply. Backticks win, then any token that looks like a path.
export function citedPathTokens(text) {
  if (typeof text !== 'string' || !text) {
    return [];
  }
  const found = [];
  const push = (raw) => {
    const value = String(raw)
      .trim()
      .replace(/^[('"\[]+/, '')
      .replace(/[)'",\].:;!?]+$/g, '');
    if (value.length >= 3) {
      found.push(value);
    }
  };
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    push(match[1]);
  }
  for (const match of text.matchAll(/(?:^|\s)((?:\/|\.\/|\.\.\/)[^\s`"'<>]{2,}|(?:[\w.\-\u0080-\uFFFF]+\/)+[^\s`"'<>]+)/g)) {
    push(match[1]);
  }
  return found;
}

// Regular files under workdir whose mtime is at or after `sinceMs`.
export function filesChangedSince(workdir, sinceMs) {
  let root;
  try {
    root = fs.realpathSync(workdir);
  } catch {
    return [];
  }
  const found = [];
  walkPublishable(root, root, sinceMs, found);
  return found;
}

function walkPublishable(dir, root, sinceMs, found) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const full = path.join(dir, entry.name);
    const relative = path.relative(root, full);
    if (entry.isDirectory()) {
      if (relative === '.boffin') {
        walkPublishable(path.join(full, 'uploads'), root, sinceMs, found);
        continue;
      }
      if (!isPublishableRelative(relative) && relative !== '') {
        continue;
      }
      walkPublishable(full, root, sinceMs, found);
      continue;
    }
    if (!entry.isFile() || !isPublishableRelative(relative)) {
      continue;
    }
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.size > 0 && stat.size <= MAX_MEDIA_BYTES && stat.mtimeMs >= sinceMs) {
        found.push(full);
      }
    } catch {
      // A file that disappears mid-walk is simply not offered.
    }
  }
}

// `path.relative` of a file named `..hidden` starts with `..` and is still inside root.
function isInsideDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === '' || path.isAbsolute(relative)) {
    return false;
  }
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
