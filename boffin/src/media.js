import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function safeFileName(name) {
  const base = path
    .basename(String(name ?? ''))
    .replace(/[^\p{L}\p{M}\p{N}._\- ()[\]]+/gu, '_')
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
      const id = randomUUID();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, id), bytes, { mode: 0o600 });
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ name: safeFileName(name), mime }), { mode: 0o600 });
      return { id, name: safeFileName(name), mime };
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
      const mime = sniffImage(bytes);
      if (!mime || bytes.length > MAX_MEDIA_BYTES) {
        return null;
      }
      return { bytes, mime, name: safeFileName(meta?.name) };
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

// Reads an image file only when it stays inside workdir after resolving symlinks.
export function readWorkspaceImage(workdir, filePath) {
  if (typeof filePath !== 'string' || !filePath) {
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
  let bytes;
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > MAX_MEDIA_BYTES) {
      return null;
    }
    bytes = fs.readFileSync(resolved);
  } catch {
    return null;
  }
  return sniffImage(bytes) ? bytes : null;
}

// `path.relative` of a file named `..hidden` starts with `..` and is still inside root.
function isInsideDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === '' || path.isAbsolute(relative)) {
    return false;
  }
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
