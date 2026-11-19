import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown.js';

const SAFE_ANCHOR = /^<a href="[^"]*" target="_blank" rel="noopener noreferrer">[^<]*<\/a>$/;

function anchorTags(html) {
  return html.match(/<a\b[^>]*>/g) ?? [];
}

test('escapes raw HTML so it can only render as text', () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)"> & <script>alert(1)</script>');
  assert.equal(html, '<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('strips NUL characters so placeholders cannot be spoofed', () => {
  assert.equal(renderMarkdown('\u00000\u0000'), '<p>0</p>');
});

test('renders paragraphs and soft line breaks', () => {
  assert.equal(renderMarkdown('one\ntwo\n\nthree'), '<p>one<br />two</p><p>three</p>');
});

test('renders emphasis, strikethrough, and inline code', () => {
  assert.equal(
    renderMarkdown('**bold** *em* _under_ ~~gone~~ `a < b`'),
    '<p><strong>bold</strong> <em>em</em> <em>under</em> <del>gone</del> <code>a &lt; b</code></p>',
  );
});

test('does not treat snake_case identifiers or stray asterisks as emphasis', () => {
  assert.equal(renderMarkdown('call my_var_name now'), '<p>call my_var_name now</p>');
  assert.equal(renderMarkdown('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
});

test('renders fenced code without interpreting its content', () => {
  assert.equal(
    renderMarkdown('```js\nconst x = "<b>";\n**not bold**\n```'),
    '<pre><code class="language-js">const x = &quot;&lt;b&gt;&quot;;\n**not bold**</code></pre>',
  );
});

test('keeps an unterminated fence open until the end of the input', () => {
  assert.equal(renderMarkdown('```\nstill code'), '<pre><code>still code</code></pre>');
});

test('renders headings, rules, quotes, and lists', () => {
  assert.equal(renderMarkdown('# Title'), '<h3>Title</h3>');
  assert.equal(renderMarkdown('### Deep ###'), '<h5>Deep</h5>');
  assert.equal(renderMarkdown('---'), '<hr />');
  assert.equal(renderMarkdown('> quoted\n> more'), '<blockquote><p>quoted<br />more</p></blockquote>');
  assert.equal(
    renderMarkdown('- one\n- two\n\n1. first\n2. second'),
    '<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>',
  );
});

test('links only to http and https URLs', () => {
  assert.equal(
    renderMarkdown('[docs](https://cursor.com/docs)'),
    '<p><a href="https://cursor.com/docs" target="_blank" rel="noopener noreferrer">docs</a></p>',
  );
  const html = renderMarkdown('[click](javascript:alert(1))');
  assert.deepEqual(anchorTags(html), []);
  assert.equal(html, '<p>[click](javascript:alert(1))</p>');
});

test('autolinks bare URLs without swallowing trailing punctuation', () => {
  assert.equal(
    renderMarkdown('see https://example.com/a.'),
    '<p>see <a href="https://example.com/a" target="_blank" rel="noopener noreferrer">https://example.com/a</a>.</p>',
  );
  assert.equal(
    renderMarkdown('see https://en.wikipedia.org/wiki/Foo_(bar)'),
    '<p>see <a href="https://en.wikipedia.org/wiki/Foo_(bar)" target="_blank" rel="noopener noreferrer">https://en.wikipedia.org/wiki/Foo_(bar)</a></p>',
  );
  assert.equal(
    renderMarkdown('see https://example.com/a).'),
    '<p>see <a href="https://example.com/a" target="_blank" rel="noopener noreferrer">https://example.com/a</a>).</p>',
  );
});

test('quotes inside URLs cannot break out of the href attribute', () => {
  const html = renderMarkdown('[x](https://a.example/"onmouseover="alert(1)) and https://b.example/"><img src=x>');
  for (const tag of anchorTags(html)) {
    assert.match(`${tag}</a>`, SAFE_ANCHOR);
  }
  assert.ok(!html.includes('<img'));
});

test('urls do not swallow stashed links or code spans into href attributes', () => {
  const adjacentLink = renderMarkdown('https://a.example/[x](https://b.example/style=color:red/onmouseover=test)');
  assert.equal(
    adjacentLink,
    '<p><a href="https://a.example/" target="_blank" rel="noopener noreferrer">https://a.example/</a>' +
      '<a href="https://b.example/style=color:red/onmouseover=test" target="_blank" rel="noopener noreferrer">x</a></p>',
  );
  for (const tag of anchorTags(adjacentLink)) {
    assert.match(`${tag}</a>`, SAFE_ANCHOR);
  }

  assert.equal(
    renderMarkdown('https://[x](https://b.example/)'),
    '<p>https://<a href="https://b.example/" target="_blank" rel="noopener noreferrer">x</a></p>',
  );

  assert.equal(
    renderMarkdown('https://a.example/`code`'),
    '<p><a href="https://a.example/" target="_blank" rel="noopener noreferrer">https://a.example/</a><code>code</code></p>',
  );

  const codeInUrl = renderMarkdown('[x](https://a.example/`code`)');
  assert.equal(
    codeInUrl,
    '<p>[x](<a href="https://a.example/" target="_blank" rel="noopener noreferrer">https://a.example/</a><code>code</code>)</p>',
  );
  for (const tag of anchorTags(codeInUrl)) {
    assert.match(`${tag}</a>`, SAFE_ANCHOR);
  }
});

test('renders code spans inside link labels', () => {
  assert.equal(
    renderMarkdown('[`npm test`](https://example.com/ci)'),
    '<p><a href="https://example.com/ci" target="_blank" rel="noopener noreferrer"><code>npm test</code></a></p>',
  );
});

test('keeps language names from injecting attributes', () => {
  const html = renderMarkdown('```js" onclick="x\nalert(1)\n```');
  assert.doesNotMatch(html, /<[^>]*onclick/);
  assert.match(html, /onclick=&quot;/);
});

test('caps deeply nested blockquotes instead of overflowing the stack', () => {
  assert.equal(
    renderMarkdown('> outer\n>> inner'),
    '<blockquote><p>outer</p><blockquote><p>inner</p></blockquote></blockquote>',
  );

  const deep = `${'> '.repeat(20_000)}bottom`;
  const html = renderMarkdown(deep);
  assert.equal((html.match(/<blockquote>/g) ?? []).length, 16);
  assert.equal((html.match(/<\/blockquote>/g) ?? []).length, 16);
  assert.match(html, /&gt; bottom<\/p>/);
});

test('renders GFM pipe tables with alignment, inline formatting, and CSP-safe classes', () => {
  const md = [
    '| Name | Count | Align |',
    '| :--- | :---: | ---: |',
    '| **A** | `1` | [docs](https://example.com) |',
    '| `a \\| b` | `x || y` | a \\| b |',
  ].join('\n');
  const html = renderMarkdown(md);
  assert.equal(
    html,
    '<div class="table-scroll"><table>' +
      '<thead><tr><th class="align-left">Name</th><th class="align-center">Count</th><th class="align-right">Align</th></tr></thead>' +
      '<tbody>' +
      '<tr><td class="align-left"><strong>A</strong></td><td class="align-center"><code>1</code></td>' +
      '<td class="align-right"><a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a></td></tr>' +
      '<tr><td class="align-left"><code>a | b</code></td><td class="align-center"><code>x || y</code></td>' +
      '<td class="align-right">a | b</td></tr>' +
      '</tbody></table></div>',
  );
  assert.doesNotMatch(html, /\bstyle=/);
});

test('handles GFM table edge cases and rejects non-tables', () => {
  // Without outer pipes, uneven body rows, paragraph interruption, trailing paragraph, and inside blockquote.
  assert.equal(
    renderMarkdown('Intro\nA | B\n--- | ---\n| 1 |\n2 | 3 | extra\nTrailing note'),
    '<p>Intro</p><div class="table-scroll"><table><thead><tr><th>A</th><th>B</th></tr></thead>' +
      '<tbody><tr><td>1</td><td></td></tr><tr><td>2</td><td>3</td></tr></tbody></table></div><p>Trailing note</p>',
  );
  assert.equal(
    renderMarkdown('| Only |\n| --- |'),
    '<div class="table-scroll"><table><thead><tr><th>Only</th></tr></thead></table></div>',
  );
  assert.equal(
    renderMarkdown('> | K | V |\n> | - | - |\n> | a | 1 |'),
    '<blockquote><div class="table-scroll"><table><thead><tr><th>K</th><th>V</th></tr></thead><tbody><tr><td>a</td><td>1</td></tr></tbody></table></div></blockquote>',
  );

  // Mismatched column counts and plain horizontal rules stay non-tables.
  assert.equal(renderMarkdown('| A | B |\n| --- |'), '<p>| A | B |<br />| --- |</p>');
  assert.equal(renderMarkdown('Heading\n---'), '<p>Heading</p><hr />');

  // Escapes HTML and refuses unsafe links inside table cells.
  const xss = renderMarkdown('| <script>x</script> | Link |\n| --- | --- |\n| <img onerror=1> | [bad](javascript:alert(1)) |');
  assert.doesNotMatch(xss, /<script|<img/i);
  assert.deepEqual(anchorTags(xss), []);
  assert.match(xss, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(xss, /\[bad\]\(javascript:alert\(1\)\)/);
});
