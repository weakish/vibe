import { conversationLogBasename, fileNames } from './log-items.js';

export function conversationPrintFilename(date = new Date()) {
  return `${conversationLogBasename(date)}.html`;
}

const PRINT_STYLES = `
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.45; }
  body { margin: 1.5rem; color: #111; background: #fff; }
  @media (prefers-color-scheme: dark) {
    body { color: #eee; background: #111; }
  }
  header { margin-bottom: 1.5rem; padding-bottom: 0.75rem; border-bottom: 1px solid #ccc; }
  header p { margin: 0.25rem 0; font-size: 0.9rem; color: #555; }
  @media (prefers-color-scheme: dark) {
    header { border-color: #444; }
    header p { color: #aaa; }
  }
  article { margin: 1.25rem 0; page-break-inside: avoid; }
  .role { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: #666; margin-bottom: 0.35rem; }
  .user .role { color: #385980; }
  .assistant .role { color: #2d6a4f; }
  .tool .role { color: #7c4d00; }
  .notice .role { color: #9b2226; }
  .body :first-child { margin-top: 0; }
  .body :last-child { margin-bottom: 0; }
  .media { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem; }
  .media img { max-width: min(100%, 24rem); height: auto; border-radius: 6px; border: 1px solid #ccc; }
  .file-list { margin: 0.5rem 0 0; padding-left: 1.25rem; font-size: 0.9rem; }
  .file-list li { margin: 0.15rem 0; }
  @media print {
    body { margin: 0.75in; }
    header button { display: none; }
  }
`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return escapeHtml(value);
}

function paragraphHtml(text) {
  const lines = String(text ?? '').split('\n');
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
}

/**
 * @param {Map<string, string>} imageHrefs map from stable key `${id}:${name}` to relative or data href
 */
export function buildTranscriptSections(items, { renderMarkdown, imageHrefs, labels = {} }) {
  const sections = [];
  const role = {
    user: labels.user ?? 'User',
    assistant: labels.assistant ?? 'Assistant',
    tool: labels.tool ?? 'Tool',
    notice: labels.notice ?? 'Notice',
  };
  const omitted = labels.fileOmitted ?? '(not included)';

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    switch (item.role) {
      case 'user': {
        const label = item.author ? `${role.user} — ${item.author}` : role.user;
        const body = item.text
          ? `<div class="body">${paragraphHtml(item.text)}</div>`
          : '';
        sections.push({ className: 'user', label, body: `${body}${fileListHtml(item.attachments, imageHrefs, omitted, labels)}` });
        break;
      }
      case 'assistant': {
        const text = item.text ?? '';
        const bodyHtml = renderMarkdown ? renderMarkdown(text) : paragraphHtml(text);
        const body =
          text || (item.images?.length ?? 0) > 0
            ? `<div class="body">${bodyHtml}</div>${mediaHtml(item.images, imageHrefs, omitted, labels)}`
            : '';
        if (body) {
          sections.push({ className: 'assistant', label: role.assistant, body });
        }
        break;
      }
      case 'tool': {
        const bits = [role.tool];
        if (item.name) {
          bits.push(item.name);
        }
        if (item.status) {
          bits.push(`(${item.status})`);
        }
        const summary = item.summary ? `<div class="body"><p>${escapeHtml(item.summary)}</p></div>` : '';
        sections.push({
          className: 'tool',
          label: bits.join(' — '),
          body: `${summary}${mediaHtml(item.images, imageHrefs, omitted, labels)}`,
        });
        break;
      }
      case 'notice': {
        const label = item.level ? `${role.notice} (${item.level})` : role.notice;
        sections.push({
          className: 'notice',
          label,
          body: `<div class="body">${paragraphHtml(item.text)}</div>`,
        });
        break;
      }
      default:
        break;
    }
  }
  return sections;
}

function mediaKey(file) {
  return `${file.id ?? ''}:${file.name ?? ''}`;
}

function fileListHtml(files, imageHrefs, omitted, labels) {
  const names = fileNames(files);
  if (names.length === 0) {
    return '';
  }
  const items = [];
  for (const file of files ?? []) {
    if (!file?.name) {
      continue;
    }
    const href = file.id ? imageHrefs?.get(mediaKey(file)) : '';
    if (href) {
      items.push(`<li><img src="${escapeHtml(href)}" alt="${escapeHtml(file.name)}" /></li>`);
    } else {
      items.push(`<li>${escapeHtml(file.name)} <em>${escapeHtml(omitted)}</em></li>`);
    }
  }
  const title = labels.attachments ?? 'Attachments';
  return `<ul class="file-list" aria-label="${escapeHtml(title)}">${items.join('')}</ul>`;
}

function mediaHtml(files, imageHrefs, omitted, labels) {
  if (!Array.isArray(files) || files.length === 0) {
    return '';
  }
  const parts = [];
  const skipped = [];
  for (const file of files) {
    if (!file?.name) {
      continue;
    }
    const href = file.id ? imageHrefs?.get(mediaKey(file)) : '';
    if (href) {
      parts.push(`<img src="${escapeHtml(href)}" alt="${escapeHtml(file.name)}" />`);
    } else {
      skipped.push(`<li>${escapeHtml(file.name)} <em>${escapeHtml(omitted)}</em></li>`);
    }
  }
  const title = labels.images ?? 'Images';
  let html = '';
  if (parts.length > 0) {
    html += `<div class="media" aria-label="${escapeHtml(title)}">${parts.join('')}</div>`;
  }
  if (skipped.length > 0) {
    html += `<ul class="file-list">${skipped.join('')}</ul>`;
  }
  return html;
}

export function buildPrintHtmlDocument(items, meta, { renderMarkdown, imageHrefs, labels = {}, printHint = '' } = {}) {
  const sections = buildTranscriptSections(items, { renderMarkdown, imageHrefs, labels });
  const body = sections
    .map(
      (section) =>
        `<article class="${escapeHtml(section.className)}"><div class="role">${escapeHtml(section.label)}</div>${section.body}</article>`,
    )
    .join('\n');

  const metaBits = [
    meta.agent ? `Agent: ${escapeHtml(meta.agent)}` : '',
    meta.model ? `Model: ${escapeHtml(meta.model)}` : '',
    meta.exportedAt ? `Exported: ${escapeHtml(meta.exportedAt)}` : '',
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeXml(meta.title ?? conversationLogBasename(new Date(meta.exportedAt || Date.now())))}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  <header>
    <h1>Boffin</h1>
    ${metaBits.map((line) => `<p>${line}</p>`).join('\n    ')}
    ${printHint ? `<p>${escapeHtml(printHint)}</p>` : ''}
    <p><button type="button" onclick="window.print()">Print / Save as PDF</button></p>
  </header>
  <main>
    ${body}
  </main>
</body>
</html>
`;
}
