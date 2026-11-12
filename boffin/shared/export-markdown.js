import { conversationLogBasename, formatJsonItem } from './log-items.js';

export function conversationMarkdownFilename(date = new Date()) {
  return `${conversationLogBasename(date)}.md`;
}

export function formatConversationLogMarkdown(items, meta, labels = {}) {
  if (!Array.isArray(items)) {
    throw new Error('Conversation items must be an array.');
  }
  const role = {
    user: labels.user ?? 'User',
    assistant: labels.assistant ?? 'Assistant',
    tool: labels.tool ?? 'Tool',
    notice: labels.notice ?? 'Notice',
  };
  const omitted = labels.fileOmitted ?? '(not included in this export)';
  const lines = [];
  lines.push('---');
  lines.push(`agent: ${meta.agent ?? 'cursor'}`);
  if (meta.model) {
    lines.push(`model: ${meta.model}`);
  }
  if (meta.exportedAt) {
    lines.push(`exportedAt: ${meta.exportedAt}`);
  }
  lines.push('---');
  lines.push('');

  for (const item of items) {
    const entry = formatJsonItem(item);
    if (!entry) {
      continue;
    }
    switch (entry.role) {
      case 'user': {
        const heading = entry.author ? `${role.user} (${entry.author})` : role.user;
        lines.push(`## ${heading}`);
        lines.push('');
        if (entry.text) {
          lines.push(entry.text);
          lines.push('');
        }
        if (entry.attachments?.length) {
          lines.push(`**${labels.attachments ?? 'Attachments'}**`);
          for (const name of entry.attachments) {
            lines.push(`- ${name} ${omitted}`);
          }
          lines.push('');
        }
        break;
      }
      case 'assistant': {
        lines.push(`## ${role.assistant}`);
        lines.push('');
        if (entry.text) {
          lines.push(entry.text);
          lines.push('');
        }
        if (entry.images?.length) {
          lines.push(`**${labels.images ?? 'Images'}**`);
          for (const name of entry.images) {
            lines.push(`- ${name} ${omitted}`);
          }
          lines.push('');
        }
        break;
      }
      case 'tool': {
        const parts = [role.tool];
        if (entry.name) {
          parts.push(entry.name);
        }
        if (entry.status) {
          parts.push(`(${entry.status})`);
        }
        lines.push(`## ${parts.join(': ')}`);
        lines.push('');
        if (entry.summary) {
          lines.push(entry.summary);
          lines.push('');
        }
        if (entry.images?.length) {
          lines.push(`**${labels.images ?? 'Images'}**`);
          for (const name of entry.images) {
            lines.push(`- ${name} ${omitted}`);
          }
          lines.push('');
        }
        break;
      }
      case 'notice': {
        const label = entry.level ? `${role.notice} (${entry.level})` : role.notice;
        lines.push(`## ${label}`);
        lines.push('');
        lines.push(entry.text ?? '');
        lines.push('');
        break;
      }
      default:
        break;
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
