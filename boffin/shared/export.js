import { conversationLogBasename, formatJsonItem } from './log-items.js';

export const AGENT = 'cursor';
export { conversationLogBasename, formatJsonItem, fileNames, mediaIdsInItems, itemsReferenceMediaId, logStamp } from './log-items.js';
export { conversationMarkdownFilename, formatConversationLogMarkdown } from './export-markdown.js';
export { buildPrintHtmlDocument, buildTranscriptSections, conversationPrintFilename } from './export-html.js';
export { buildConversationEpub, conversationEpubFilename } from './export-epub.js';

export function conversationLogFilename(date = new Date()) {
  return `${conversationLogBasename(date)}.json`;
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
    const entry = formatJsonItem(item);
    if (entry) {
      log.items.push(entry);
    }
  }
  return `${JSON.stringify(log, null, 2)}\n`;
}
