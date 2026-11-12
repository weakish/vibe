// Small, dependency-free Markdown renderer for assistant replies. All source text is
// HTML-escaped before tags are introduced, and links are limited to http(s) URLs.
const STASH = '\u0000';
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

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

function renderBlocks(lines) {
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

    if (QUOTE.test(line)) {
      const quoted = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(lines[index].replace(/^ {0,3}> ?/, ''));
        index += 1;
      }
      html.push(`<blockquote>${renderBlocks(quoted)}</blockquote>`);
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

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
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

  source = source.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s()<>]+)\)/g, (_match, label, href) =>
    keep(link(href, label)),
  );
  source = source.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_match, lead, url) => {
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

function startsBlock(line) {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line);
}
