export function fileNames(files) {
  if (!Array.isArray(files)) {
    return [];
  }
  return files
    .map((file) => (file && typeof file.name === 'string' ? file.name.trim() : ''))
    .filter(Boolean);
}

export function formatJsonItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  switch (item.role) {
    case 'user':
      return formatJsonUser(item);
    case 'assistant':
      return formatJsonAssistant(item);
    case 'tool':
      return formatJsonTool(item);
    case 'notice':
      return formatJsonNotice(item);
    default:
      return null;
  }
}

function formatJsonUser(item) {
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

function formatJsonAssistant(item) {
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

function formatJsonTool(item) {
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

function formatJsonNotice(item) {
  const entry = { role: 'notice', text: item.text ?? '' };
  if (item.level) {
    entry.level = item.level;
  }
  return entry;
}

export function logStamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace(/:/g, '');
}

export function conversationLogBasename(date = new Date()) {
  return `boffin-chat-${logStamp(date)}Z`;
}

export function mediaIdsInItems(items) {
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

export function itemsReferenceMediaId(items, mediaId) {
  return mediaIdsInItems(items).has(mediaId);
}
