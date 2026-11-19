// Small, dependency-free Markdown renderer for assistant replies. All source text is
// HTML-escaped before tags are introduced, and links are limited to http(s) URLs.
const STASH = '\u0000';
const MAX_QUOTE_DEPTH = 16;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_ALIGN = /^:?-+:?$/;

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarkdown(source) {
  const lines = String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .split('\n');
  return renderBlocks(lines);
}

function renderBlocks(lines, depth = 0) {
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const minLength = fence[1].length;
      const body = [];
      index += 1;
      while (index < lines.length && !isClosingFence(lines[index], marker, minLength)) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      const language = fence[2] ? ` class="language-${fence[2]}"` : '';
      html.push(`<pre><code${language}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6);
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      html.push('<hr />');
      index += 1;
      continue;
    }

    if (depth < MAX_QUOTE_DEPTH && QUOTE.test(line)) {
      const quoted = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(lines[index].replace(/^ {0,3}> ?/, ''));
        index += 1;
      }
      html.push(`<blockquote>${renderBlocks(quoted, depth + 1)}</blockquote>`);
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = /^\d/.test(item[1]);
      const entries = [];
      while (index < lines.length) {
        const next = LIST_ITEM.exec(lines[index]);
        if (!next || /^\d/.test(next[1]) !== ordered) {
          break;
        }
        entries.push(`<li>${renderInline(next[2])}</li>`);
        index += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${entries.join('')}</${tag}>`);
      continue;
    }

    const table = parseTableStart(lines, index);
    if (table) {
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim() && !startsNonTableBlock(lines[index], depth)) {
        const cells = splitTableRow(lines[index]);
        if (!cells) {
          break;
        }
        rows.push(cells);
        index += 1;
      }
      html.push(renderTable(table.headers, table.alignments, rows));
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index, depth)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${paragraph.map((text) => renderInline(text)).join('<br />')}</p>`);
  }

  return html.join('');
}

// Drop trailing punctuation, but keep a closing paren or bracket that balances one inside the URL.
function autolinkHref(url) {
  let end = url.length;
  const trimPunctuation = () => {
    while (end > 0 && /[.,;:!?]/.test(url[end - 1])) {
      end -= 1;
    }
  };
  trimPunctuation();
  while (end > 0 && (url[end - 1] === ')' || url[end - 1] === ']')) {
    const closer = url[end - 1];
    const opener = closer === ')' ? '(' : '[';
    const head = url.slice(0, end);
    const opens = head.split(opener).length - 1;
    const closes = head.split(closer).length - 1;
    if (closes <= opens) {
      break;
    }
    end -= 1;
    trimPunctuation();
  }
  return url.slice(0, end);
}

function renderInline(text) {
  const stash = [];
  const keep = (html) => `${STASH}${stash.push(html) - 1}${STASH}`;

  let source = text.replace(/(`+)(.+?)\1(?!`)/g, (_match, _ticks, code) => keep(`<code>${escapeHtml(code)}</code>`));
  source = escapeHtml(source);

  // Exclude STASH so a URL cannot swallow an earlier stashed <code> or <a> tag
  // and splice its unescaped quotes into an href attribute on restore.
  source = source.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s()<>\u0000]+)\)/g, (_match, label, href) =>
    keep(link(href, label)),
  );
  source = source.replace(/(^|[\s(])(https?:\/\/[^\s<\u0000]+)/g, (_match, lead, url) => {
    const href = autolinkHref(url);
    return `${lead}${keep(link(href, href))}${url.slice(href.length)}`;
  });

  source = source
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>');

  const restore = (value) =>
    value.replace(new RegExp(`${STASH}(\\d+)${STASH}`, 'g'), (_match, index) => restore(stash[Number(index)]));
  return restore(source);
}

function link(href, label) {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function isClosingFence(line, marker, minLength) {
  const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return match !== null && match[1][0] === marker && match[1].length >= minLength;
}

function startsNonTableBlock(line, depth) {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    (depth < MAX_QUOTE_DEPTH && QUOTE.test(line)) ||
    LIST_ITEM.test(line)
  );
}

function startsBlock(lines, index, depth) {
  return startsNonTableBlock(lines[index], depth) || parseTableStart(lines, index) !== null;
}

function parseTableStart(lines, index) {
  if (index + 1 >= lines.length) {
    return null;
  }
  const headers = splitTableRow(lines[index]);
  if (!headers) {
    return null;
  }
  const alignments = parseTableAlignments(lines[index + 1]);
  if (!alignments || alignments.length !== headers.length) {
    return null;
  }
  return { headers, alignments };
}

function parseTableAlignments(line) {
  const cells = splitTableRow(line);
  if (!cells) {
    return null;
  }
  const alignments = [];
  for (const cell of cells) {
    if (!TABLE_ALIGN.test(cell)) {
      return null;
    }
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    alignments.push(left && right ? 'center' : left ? 'left' : right ? 'right' : null);
  }
  return alignments;
}

function isEscaped(text, pos) {
  let slashes = 0;
  for (let i = pos - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function findClosingTicks(text, from, end, count) {
  let i = from;
  while (i < end) {
    if (text[i] === '`') {
      let run = 1;
      while (i + run < end && text[i + run] === '`') {
        run += 1;
      }
      if (run === count) {
        return i;
      }
      i += run;
      continue;
    }
    i += 1;
  }
  return -1;
}

function splitTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed === '|') {
    return null;
  }
  let hasPipe = false;
  let start = 0;
  let end = trimmed.length;
  if (trimmed[0] === '|') {
    hasPipe = true;
    start = 1;
  }
  if (end > start && trimmed[end - 1] === '|' && !isEscaped(trimmed, end - 1)) {
    hasPipe = true;
    end -= 1;
  }
  const cells = [];
  let current = '';
  let i = start;
  while (i < end) {
    if (trimmed[i] === '`') {
      let ticks = 1;
      while (i + ticks < end && trimmed[i + ticks] === '`') {
        ticks += 1;
      }
      const close = findClosingTicks(trimmed, i + ticks, end, ticks);
      if (close !== -1) {
        current += trimmed.slice(i, close + ticks).replace(/\\\|/g, '|');
        i = close + ticks;
        continue;
      }
      current += trimmed.slice(i, i + ticks);
      i += ticks;
      continue;
    }
    if (trimmed[i] === '\\' && i + 1 < end) {
      if (trimmed[i + 1] === '\\') {
        current += '\\\\';
        i += 2;
        continue;
      }
      if (trimmed[i + 1] === '|') {
        current += '|';
        i += 2;
        continue;
      }
    }
    if (trimmed[i] === '|') {
      hasPipe = true;
      cells.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    current += trimmed[i];
    i += 1;
  }
  if (!hasPipe) {
    return null;
  }
  cells.push(current.trim());
  return cells;
}

function renderTableRow(cells, alignments, tag) {
  const parts = [];
  for (let i = 0; i < alignments.length; i += 1) {
    const align = alignments[i];
    const attr = align ? ` class="align-${align}"` : '';
    parts.push(`<${tag}${attr}>${renderInline(cells[i] ?? '')}</${tag}>`);
  }
  return `<tr>${parts.join('')}</tr>`;
}

function renderTable(headers, alignments, rows) {
  const head = `<thead>${renderTableRow(headers, alignments, 'th')}</thead>`;
  const body = rows.length > 0 ? `<tbody>${rows.map((row) => renderTableRow(row, alignments, 'td')).join('')}</tbody>` : '';
  // Scroll lives on a wrapper so the table element keeps the table grid and collapsed borders.
  return `<div class="table-scroll"><table>${head}${body}</table></div>`;
}
