import { isIP } from 'node:net';

// Fixed window from the first attempt. A full window refuses more attempts
// until it ends; the refusal does not open a new window.
const SWEEP_AT = 1000;
export const MAX_ATTEMPT_BUCKETS = 10_000;

export const PASSWORD_ATTEMPT_LIMIT = 8;
export const PASSKEY_ATTEMPT_LIMIT = 30;
export const STATUS_ATTEMPT_LIMIT = 60;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function parseIpv4(text) {
  const octets = text.split('.');
  if (octets.length !== 4) {
    return null;
  }
  const bytes = [];
  for (const octet of octets) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(octet)) {
      return null;
    }
    const value = Number.parseInt(octet, 10);
    if (value > 255) {
      return null;
    }
    bytes.push(value);
  }
  return [(bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]];
}

function parseIpv6(address) {
  let bare = address.split('%', 1)[0];
  if (!bare.includes(':')) {
    return null;
  }
  const lastColon = bare.lastIndexOf(':');
  if (bare.slice(lastColon + 1).includes('.')) {
    const ipv4 = parseIpv4(bare.slice(lastColon + 1));
    if (!ipv4) {
      return null;
    }
    bare = `${bare.slice(0, lastColon + 1)}${hextet(ipv4[0])}:${hextet(ipv4[1])}`;
  }
  const halves = bare.split('::');
  if (halves.length > 2) {
    return null;
  }
  const parseSide = (part) => {
    if (!part) {
      return [];
    }
    const groups = [];
    for (const field of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(field)) {
        return null;
      }
      groups.push(Number.parseInt(field, 16));
    }
    return groups;
  };
  const head = parseSide(halves[0]);
  const tail = halves.length === 2 ? parseSide(halves[1]) : null;
  if (head === null || (halves.length === 2 && tail === null)) {
    return null;
  }
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 1) {
    return null;
  }
  return head.concat(Array(missing).fill(0), tail);
}

function hextet(group) {
  return group.toString(16);
}

export function clientAddress(remoteAddress) {
  const address = (typeof remoteAddress === 'string' ? remoteAddress : '').toLowerCase();
  const groups = parseIpv6(address);
  if (!groups) {
    return address || 'unknown';
  }
  // Node reports IPv4 peers as ::ffff:a.b.c.d, and headers may write the mapped
  // address in dotted or hex form. Fold all of them onto the IPv4 address.
  if (groups[5] === 0xffff && groups.slice(0, 5).every((group) => group === 0)) {
    return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
  }
  if (groups[7] === 1 && groups.slice(0, 7).every((group) => group === 0)) {
    return '::1';
  }
  // The interface identifier is free for a client to vary on every guess, so each /64
  // of a global unicast (2000::/3) or unique-local (fc00::/7) prefix gets one budget.
  const globalUnicast = (groups[0] & 0xe000) === 0x2000;
  const uniqueLocal = (groups[0] & 0xfe00) === 0xfc00;
  if (globalUnicast || uniqueLocal) {
    return `${groups.slice(0, 4).map(hextet).join(':')}::/64`;
  }
  return groups.map(hextet).join(':');
}

function isLoopback(address) {
  return address === '::1' || address.startsWith('127.');
}

// The address an attempt is charged to. Behind a reverse proxy on this host every
// connection arrives from loopback, so for a loopback peer only, the client is the
// last X-Forwarded-For entry: the one the trusted proxy appended. Any other peer
// cannot choose its own bucket, so its header is ignored. A missing or malformed
// value falls back to the peer address.
export function requestAddress(req) {
  const peer = clientAddress(req.socket?.remoteAddress);
  if (!isLoopback(peer)) {
    return peer;
  }
  // Node joins repeated headers into one comma-separated string.
  const value = (req.headers?.['x-forwarded-for'] ?? '').split(',').pop().trim();
  return isIP(value) ? clientAddress(value) : peer;
}

export function createAttemptLimiter(limit, windowMs = ATTEMPT_WINDOW_MS, maxBuckets = MAX_ATTEMPT_BUCKETS) {
  const buckets = new Map();

  function retryAfter(bucket, now) {
    return Math.max(1, Math.ceil((bucket.start + windowMs - now) / 1000));
  }

  // Buckets are inserted at window start (and deleted before re-insertion on reset),
  // so expired windows sit at the front of the Map and are pruned in O(1) amortized time.
  function pruneExpired(now) {
    for (const [id, entry] of buckets) {
      if (now - entry.start < windowMs) {
        break;
      }
      buckets.delete(id);
    }
  }

  return {
    get size() {
      return buckets.size;
    },
    // Whether another attempt would be recorded. Records nothing and opens no window.
    status(key, now = Date.now()) {
      const bucket = buckets.get(key);
      if (bucket && now - bucket.start < windowMs) {
        return { ok: bucket.count < limit, retryAfter: retryAfter(bucket, now) };
      }
      if (buckets.size >= maxBuckets) {
        const oldest = buckets.values().next().value;
        if (oldest && now - oldest.start < windowMs) {
          return { ok: false, retryAfter: retryAfter(oldest, now) };
        }
      }
      return { ok: true, retryAfter: 0 };
    },
    // Records one attempt when the window still has room.
    record(key, now = Date.now()) {
      let bucket = buckets.get(key);
      if (!bucket || now - bucket.start >= windowMs) {
        if (bucket) {
          buckets.delete(key);
        }
        if (buckets.size >= SWEEP_AT || buckets.size >= maxBuckets) {
          pruneExpired(now);
        }
        if (buckets.size >= maxBuckets) {
          const oldest = buckets.values().next().value;
          return {
            ok: false,
            retryAfter: oldest ? retryAfter(oldest, now) : Math.max(1, Math.ceil(windowMs / 1000)),
          };
        }
        bucket = { start: now, count: 0 };
        buckets.set(key, bucket);
      }
      if (bucket.count >= limit) {
        return { ok: false, retryAfter: retryAfter(bucket, now) };
      }
      bucket.count += 1;
      return { ok: true, retryAfter: retryAfter(bucket, now) };
    },
  };
}
