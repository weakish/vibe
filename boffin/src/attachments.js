import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../shared/limits.js';

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BASE64_CHARS = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;

export class AttachmentError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AttachmentError';
    this.status = status;
  }
}

export function parseAttachments(value) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AttachmentError(400, 'Attachments must be a list.');
  }
  if (value.length > MAX_ATTACHMENTS) {
    throw new AttachmentError(400, `You can attach up to ${MAX_ATTACHMENTS} files.`);
  }
  return value.map(parseAttachment);
}

function parseAttachment(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new AttachmentError(400, 'An attachment is not valid.');
  }
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'file';
  if (typeof entry.data !== 'string' || !entry.data.trim()) {
    throw new AttachmentError(400, 'An attachment is not valid.');
  }
  const compact = entry.data.replace(/\s+/g, '');
  if (!BASE64.test(compact) || compact.length % 4 !== 0 || compact.length > MAX_BASE64_CHARS) {
    throw new AttachmentError(
      compact.length > MAX_BASE64_CHARS ? 413 : 400,
      compact.length > MAX_BASE64_CHARS
        ? `Each attachment is limited to ${MAX_ATTACHMENT_BYTES} bytes.`
        : 'An attachment is not valid.',
    );
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length === 0) {
    throw new AttachmentError(400, 'An attachment is not valid.');
  }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError(413, `Each attachment is limited to ${MAX_ATTACHMENT_BYTES} bytes.`);
  }
  return { name, bytes };
}
