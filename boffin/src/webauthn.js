import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';

const ES256 = -7;
const EDDSA = -8;

export function randomChallenge() {
  return randomBytes(32);
}

export function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

export function bytesFromBase64url(value) {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  return Buffer.from(value, 'base64url');
}

// A passkey can be created on HTTPS, or on http://localhost, which browsers treat
// as a secure context. An IP address is not a relying-party hostname.
export function passkeyOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const host = url.hostname;
  const localhost = host === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) {
    return null;
  }
  if (!isHostname(host)) {
    return null;
  }
  return { origin: url.origin, rpId: host };
}

export function creationOptions({ challenge, rpId, userId, userName, excludeCredentials = [] }) {
  const options = {
    challenge: base64url(challenge),
    rp: { name: 'Boffin', id: rpId },
    user: { id: base64url(userId), name: userName, displayName: userName },
    pubKeyCredParams: [
      { type: 'public-key', alg: ES256 },
      { type: 'public-key', alg: EDDSA },
    ],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: 60_000,
    attestation: 'none',
  };
  // The browser refuses to create a passkey on a device that already holds one of these.
  if (excludeCredentials.length > 0) {
    options.excludeCredentials = excludeCredentials.map((id) => ({ type: 'public-key', id }));
  }
  return options;
}

export function requestOptions({ challenge, rpId, allowCredentials = [] }) {
  const options = {
    challenge: base64url(challenge),
    rpId,
    userVerification: 'required',
    timeout: 60_000,
  };
  if (allowCredentials.length > 0) {
    options.allowCredentials = allowCredentials.map((id) => ({ type: 'public-key', id }));
  }
  return options;
}

// Checks a registration response and returns the stored public key.
// `expected.challenge` is raw bytes. `expected.origin` and `expected.rpId` come from the page.
export function verifyRegistration(credential, expected) {
  const collected = readClientData(credential?.response?.clientDataJSON, 'webauthn.create', expected);
  if (!collected) {
    return null;
  }
  const attestation = bytesFromBase64url(credential?.response?.attestationObject ?? '');
  if (!attestation) {
    return null;
  }
  let decoded;
  try {
    decoded = decodeCbor(attestation);
  } catch {
    return null;
  }
  if (!decoded || decoded.value instanceof Map === false || decoded.rest.length !== 0) {
    return null;
  }
  const authData = decoded.value.get('authData');
  if (!Buffer.isBuffer(authData)) {
    return null;
  }
  const parsed = parseAuthData(authData, { attested: true });
  if (!parsed || !rpIdMatches(parsed.rpIdHash, expected.rpId) || !userVerified(parsed)) {
    return null;
  }
  const credentialId = base64url(parsed.credentialId);
  if (credential.id !== credentialId) {
    return null;
  }
  const publicKey = coseToPublicKey(parsed.publicKey);
  if (!publicKey) {
    return null;
  }
  return { credentialId, publicKey, signCount: parsed.signCount };
}

// Checks an assertion. `stored` is { publicKey, signCount }.
export function verifyAssertion(credential, expected, stored) {
  const collected = readClientData(credential?.response?.clientDataJSON, 'webauthn.get', expected);
  if (!collected) {
    return null;
  }
  const authenticatorData = bytesFromBase64url(credential?.response?.authenticatorData ?? '');
  const signature = bytesFromBase64url(credential?.response?.signature ?? '');
  const credentialId = typeof credential?.id === 'string' ? credential.id : '';
  if (!authenticatorData || !signature || !credentialId || !stored?.publicKey) {
    return null;
  }
  const parsed = parseAuthData(authenticatorData, { attested: false });
  if (!parsed || !rpIdMatches(parsed.rpIdHash, expected.rpId) || !userVerified(parsed)) {
    return null;
  }
  if (stored.signCount > 0 && parsed.signCount <= stored.signCount) {
    return null;
  }
  const key = importPublicKey(stored.publicKey);
  if (!key) {
    return null;
  }
  const signed = Buffer.concat([authenticatorData, createHash('sha256').update(collected.raw).digest()]);
  const algorithm = stored.publicKey.alg === EDDSA ? null : 'sha256';
  const valid = verifySignature(algorithm, signed, key, signature);
  if (!valid) {
    return null;
  }
  return { credentialId, signCount: parsed.signCount };
}

export function encodeCbor(value) {
  const parts = [];
  writeCbor(parts, value);
  return Buffer.concat(parts);
}

function readClientData(encoded, type, expected) {
  const raw = bytesFromBase64url(encoded ?? '');
  if (!raw) {
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
  if (data?.type !== type || data.origin !== expected.origin || data.crossOrigin === true) {
    return null;
  }
  const challenge = bytesFromBase64url(data.challenge ?? '');
  if (!challenge || !challenge.equals(expected.challenge)) {
    return null;
  }
  return { raw };
}

function rpIdMatches(hash, rpId) {
  return hash.equals(createHash('sha256').update(rpId).digest());
}

// Creation and sign-in both ask for userVerification: 'required', so UP alone is not enough.
function userVerified(parsed) {
  return parsed.flags.up && parsed.flags.uv;
}

function parseAuthData(authData, { attested }) {
  if (authData.length < 37) {
    return null;
  }
  const rpIdHash = authData.subarray(0, 32);
  const flagsByte = authData[32];
  const signCount = authData.readUInt32BE(33);
  const flags = {
    up: (flagsByte & 0x01) !== 0,
    uv: (flagsByte & 0x04) !== 0,
    at: (flagsByte & 0x40) !== 0,
    ed: (flagsByte & 0x80) !== 0,
  };
  if (!attested) {
    return { rpIdHash, flags, signCount };
  }
  if (!flags.at || authData.length < 55) {
    return null;
  }
  const credentialIdLength = authData.readUInt16BE(53);
  const credentialStart = 55;
  const credentialEnd = credentialStart + credentialIdLength;
  if (credentialIdLength < 1 || authData.length <= credentialEnd) {
    return null;
  }
  let publicKey;
  try {
    const decoded = decodeCbor(authData.subarray(credentialEnd));
    // The public key is one CBOR value. When ED is set, extension data may follow it.
    if (!decoded || decoded.value instanceof Map === false || (decoded.rest.length !== 0 && !flags.ed)) {
      return null;
    }
    publicKey = decoded.value;
  } catch {
    return null;
  }
  return {
    rpIdHash,
    flags,
    signCount,
    credentialId: authData.subarray(credentialStart, credentialEnd),
    publicKey,
  };
}

function coseToPublicKey(cose) {
  const kty = cose.get(1);
  const alg = cose.get(3);
  const crv = cose.get(-1);
  const x = cose.get(-2);
  if (kty === 2 && alg === ES256 && crv === 1 && Buffer.isBuffer(x) && Buffer.isBuffer(cose.get(-3))) {
    return {
      alg: ES256,
      jwk: { kty: 'EC', crv: 'P-256', x: base64url(x), y: base64url(cose.get(-3)) },
    };
  }
  if (kty === 1 && alg === EDDSA && crv === 6 && Buffer.isBuffer(x)) {
    return { alg: EDDSA, jwk: { kty: 'OKP', crv: 'Ed25519', x: base64url(x) } };
  }
  return null;
}

function importPublicKey(stored) {
  try {
    return createPublicKey({ key: stored.jwk, format: 'jwk' });
  } catch {
    return null;
  }
}

function isHostname(host) {
  if (host === 'localhost') {
    return true;
  }
  if (host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return false;
  }
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(host);
}

function decodeCbor(bytes) {
  return readCbor(Buffer.from(bytes), 0);
}

function readCbor(bytes, offset) {
  if (offset >= bytes.length) {
    throw new Error('Truncated CBOR.');
  }
  const initial = bytes[offset];
  const major = initial >> 5;
  const info = initial & 0x1f;
  const argument = readArgument(bytes, offset + 1, info);
  if (major === 0) {
    return { value: argument.value, rest: bytes.subarray(argument.offset) };
  }
  if (major === 1) {
    return { value: -1 - argument.value, rest: bytes.subarray(argument.offset) };
  }
  if (major === 2 || major === 3) {
    const end = argument.offset + argument.value;
    if (end > bytes.length) {
      throw new Error('Truncated CBOR.');
    }
    const slice = bytes.subarray(argument.offset, end);
    const value = major === 2 ? Buffer.from(slice) : slice.toString('utf8');
    return { value, rest: bytes.subarray(end) };
  }
  if (major === 4) {
    const items = [];
    let cursor = argument.offset;
    for (let index = 0; index < argument.value; index += 1) {
      const item = readCbor(bytes, cursor);
      items.push(item.value);
      cursor = bytes.length - item.rest.length;
    }
    return { value: items, rest: bytes.subarray(cursor) };
  }
  if (major === 5) {
    const map = new Map();
    let cursor = argument.offset;
    for (let index = 0; index < argument.value; index += 1) {
      const key = readCbor(bytes, cursor);
      cursor = bytes.length - key.rest.length;
      const value = readCbor(bytes, cursor);
      cursor = bytes.length - value.rest.length;
      map.set(key.value, value.value);
    }
    return { value: map, rest: bytes.subarray(cursor) };
  }
  if (major === 7 && info === 22) {
    return { value: null, rest: bytes.subarray(offset + 1) };
  }
  throw new Error('Unsupported CBOR.');
}

function readArgument(bytes, offset, info) {
  if (info < 24) {
    return { value: info, offset };
  }
  const widths = new Map([
    [24, 1],
    [25, 2],
    [26, 4],
  ]);
  const width = widths.get(info);
  if (!width || offset + width > bytes.length) {
    throw new Error('Unsupported CBOR length.');
  }
  const value = width === 1 ? bytes[offset] : width === 2 ? bytes.readUInt16BE(offset) : bytes.readUInt32BE(offset);
  return { value, offset: offset + width };
}

function writeCbor(parts, value) {
  if (value === null) {
    parts.push(Buffer.from([0xf6]));
    return;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value >= 0) {
      writeHeader(parts, 0, value);
      return;
    }
    writeHeader(parts, 1, -1 - value);
    return;
  }
  if (typeof value === 'string') {
    const encoded = Buffer.from(value, 'utf8');
    writeHeader(parts, 3, encoded.length);
    parts.push(encoded);
    return;
  }
  if (Buffer.isBuffer(value)) {
    writeHeader(parts, 2, value.length);
    parts.push(value);
    return;
  }
  if (value instanceof Map) {
    writeHeader(parts, 5, value.size);
    for (const [key, entry] of value) {
      writeCbor(parts, key);
      writeCbor(parts, entry);
    }
    return;
  }
  throw new Error('Unsupported CBOR value.');
}

function writeHeader(parts, major, value) {
  if (value < 24) {
    parts.push(Buffer.from([(major << 5) | value]));
    return;
  }
  if (value < 0x100) {
    parts.push(Buffer.from([(major << 5) | 24, value]));
    return;
  }
  if (value < 0x10000) {
    const header = Buffer.alloc(3);
    header[0] = (major << 5) | 25;
    header.writeUInt16BE(value, 1);
    parts.push(header);
    return;
  }
  const header = Buffer.alloc(5);
  header[0] = (major << 5) | 26;
  header.writeUInt32BE(value, 1);
  parts.push(header);
}
