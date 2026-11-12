// Minimal ZIP writer (STORE only). Works in the browser and in Node for EPUB export.

const encoder = new TextEncoder();

function u16(n) {
  const out = new Uint8Array(2);
  out[0] = n & 0xff;
  out[1] = (n >> 8) & 0xff;
  return out;
}

function u32(n) {
  const out = new Uint8Array(4);
  out[0] = n & 0xff;
  out[1] = (n >> 8) & 0xff;
  out[2] = (n >> 16) & 0xff;
  out[3] = (n >> 24) & 0xff;
  return out;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function normalizePath(name) {
  return String(name).replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * @param {Array<{ name: string, data: Uint8Array }>} entries
 * @returns {Uint8Array}
 */
export function createZip(entries) {
  const ordered = [...entries].sort((left, right) => {
    if (left.name === 'mimetype') {
      return -1;
    }
    if (right.name === 'mimetype') {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });

  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of ordered) {
    const name = normalizePath(entry.name);
    const nameBytes = encoder.encode(name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const checksum = crc32(data);

    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    parts.push(local);

    central.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(checksum),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    );
    offset += local.length;
  }

  const centralBytes = concat(central);
  const centralOffset = offset;
  parts.push(centralBytes);
  parts.push(
    concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(ordered.length),
      u16(ordered.length),
      u32(centralBytes.length),
      u32(centralOffset),
      u16(0),
    ]),
  );
  return concat(parts);
}
