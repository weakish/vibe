import { createHash } from 'node:crypto';

// Strong tag of the raw bytes, with no encoding suffix. Debian's Caddy 2.6
// leaves ETags unchanged (see the deploy skill). Newer Caddy appends the
// coding (`"hash"` becomes `"hash-gzip"`) and strips that suffix from
// If-None-Match. A suffix added here would miss in both cases.

export function entityTag(bytes) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  return `"${hash}"`;
}

export function httpDate(date) {
  return new Date(date).toUTCString();
}

export function isNotModified(req, etag, lastModified) {
  const noneMatch = req.headers['if-none-match'];
  if (noneMatch !== undefined) {
    return etagListIncludes(noneMatch, etag);
  }
  const modifiedSince = req.headers['if-modified-since'];
  if (modifiedSince === undefined || !lastModified) {
    return false;
  }
  const since = Date.parse(modifiedSince);
  if (Number.isNaN(since)) {
    return false;
  }
  return Math.floor(new Date(lastModified).getTime() / 1000) <= Math.floor(since / 1000);
}

function etagListIncludes(header, etag) {
  if (String(header).trim() === '*') {
    return true;
  }
  const wanted = unwrapEtag(etag);
  for (const part of String(header).split(',')) {
    if (unwrapEtag(part) === wanted) {
      return true;
    }
  }
  return false;
}

function unwrapEtag(value) {
  let token = String(value).trim();
  if (token.startsWith('W/')) {
    token = token.slice(2).trim();
  }
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    return token.slice(1, -1);
  }
  return token;
}
