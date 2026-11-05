export const AGENT = 'cursor';

export function conversationLogFilename(date = new Date()) {
  const stamp = date.toISOString().slice(0, 19).replace(/:/g, '');
  return `boffin-chat-${stamp}Z.json`;
}

export function formatConversationLog(items, { agent = AGENT, model = '', exportedAt = '' } = {}) {
  if (!Array.isArray(items)) {
    throw new Error('Conversation items must be an array.');
  }
  const log = { agent, model };
  if (exportedAt) {
    log.exportedAt = exportedAt;
  }
  log.items = [];
  for (const item of items) {
    const entry = formatItem(item);
    if (entry) {
      log.items.push(entry);
    }
  }
  return `${JSON.stringify(log, null, 2)}\n`;
}

function formatUser(item) {
  const entry = { role: 'user' };
  if (item.author) {
    entry.author = item.author;
  }
  entry.text = item.text ?? '';
  const attachments = fileNames(item.attachments);
  if (attachments.length > 0) {
    entry.attachments = attachments;
  }
  return entry;
}

function formatAssistant(item) {
  const images = fileNames(item.images);
  if (!item.text && images.length === 0) {
    return null;
  }
  const entry = { role: 'assistant' };
  if (item.text) {
    entry.text = item.text;
  }
  if (images.length > 0) {
    entry.images = images;
  }
  return entry;
}

function fileNames(files) {
  if (!Array.isArray(files)) {
    return [];
  }
  return files
    .map((file) => (file && typeof file.name === 'string' ? file.name.trim() : ''))
    .filter(Boolean);
}

function formatItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  switch (item.role) {
    case 'user':
      return formatUser(item);
    case 'assistant':
      return formatAssistant(item);
    case 'tool': {
      const entry = { role: 'tool' };
      if (item.name) {
        entry.name = item.name;
      }
      if (item.status) {
        entry.status = item.status;
      }
      if (item.summary) {
        entry.summary = item.summary;
      }
      const images = fileNames(item.images);
      if (images.length > 0) {
        entry.images = images;
      }
      return entry;
    }
    case 'notice': {
      const entry = { role: 'notice', text: item.text ?? '' };
      if (item.level) {
        entry.level = item.level;
      }
      return entry;
    }
    default:
      return null;
  }
}
