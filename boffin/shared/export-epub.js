import { createZip } from './zip-store.js';
import { conversationLogBasename } from './log-items.js';
import { buildTranscriptSections } from './export-html.js';

export function conversationEpubFilename(date = new Date()) {
  return `${conversationLogBasename(date)}.epub`;
}

const EPUB_CSS = `
body { font-family: serif; line-height: 1.5; margin: 0; padding: 0 0.5em; }
.role { font-size: 0.75em; font-weight: bold; text-transform: uppercase; letter-spacing: 0.04em; margin: 1.5em 0 0.35em; color: #444; }
p { margin: 0.4em 0; }
blockquote { margin: 0.6em 0; padding-left: 0.75em; border-left: 3px solid #ccc; }
pre, code { font-family: ui-monospace, monospace; font-size: 0.9em; }
img { max-width: 100%; height: auto; margin: 0.5em 0; }
.file-list { margin: 0.4em 0 0.6em 1.2em; font-size: 0.9em; }
`;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function encoder() {
  return new TextEncoder();
}

function textBytes(text) {
  return encoder().encode(text);
}

function isImageMime(mime) {
  return typeof mime === 'string' && mime.startsWith('image/');
}

function epubImageHref(id, name) {
  const safe = String(name).replace(/[^\w.\-()+ ]+/g, '_').slice(0, 60) || 'image';
  return `images/${id}-${safe}`;
}

function manifestMime(mime) {
  const base = String(mime || '').split(';', 1)[0].trim().toLowerCase();
  if (base.startsWith('image/')) {
    return base;
  }
  return 'image/png';
}

function epubModified(value) {
  const parsed = value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function mediaKey(file) {
  return `${file.id}:${file.name}`;
}

/**
 * @param {Array} items transcript items
 * @param {{ agent?: string, model?: string, exportedAt?: string, title?: string }} meta
 * @param {(id: string) => { bytes: Uint8Array, mime: string, name: string } | null} resolveMedia
 * @param {{ renderMarkdown?: (text: string) => string, labels?: Record<string, string> }} options
 */
export function buildConversationEpub(items, meta, resolveMedia, options = {}) {
  if (!Array.isArray(items)) {
    throw new Error('Conversation items must be an array.');
  }
  const imageHrefs = new Map();
  const zipImages = [];
  const seen = new Set();

  const registerFile = (file) => {
    if (!file?.id || !file?.name || seen.has(mediaKey(file))) {
      return;
    }
    const resolved = resolveMedia(file.id);
    if (!resolved || !isImageMime(resolved.mime)) {
      return;
    }
    const href = epubImageHref(file.id, file.name);
    seen.add(mediaKey(file));
    imageHrefs.set(mediaKey(file), href);
    zipImages.push({ name: `EPUB/${href}`, data: resolved.bytes, mime: resolved.mime });
  };

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    for (const list of [item.attachments, item.images]) {
      if (!Array.isArray(list)) {
        continue;
      }
      for (const file of list) {
        registerFile(file);
      }
    }
  }

  const sections = buildTranscriptSections(items, {
    renderMarkdown: options.renderMarkdown,
    imageHrefs,
    labels: options.labels,
  });

  const chapterBody = sections
    .map(
      (section) =>
        `<section class="${escapeHtmlClass(section.className)}"><h2>${escapeXml(section.label)}</h2>${section.body}</section>`,
    )
    .join('\n');

  const title = escapeXml(meta.title ?? conversationLogBasename(new Date(meta.exportedAt || Date.now())));
  const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head>
  <title>${title}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${title}</h1>
  ${meta.exportedAt ? `<p class="meta">Exported: ${escapeXml(meta.exportedAt)}</p>` : ''}
  ${meta.agent ? `<p class="meta">Agent: ${escapeXml(meta.agent)}</p>` : ''}
  ${meta.model ? `<p class="meta">Model: ${escapeXml(meta.model)}</p>` : ''}
  ${chapterBody}
</body>
</html>
`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
  <title>Table of contents</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      <li><a href="chapter.xhtml">Conversation</a></li>
    </ol>
  </nav>
</body>
</html>
`;

  const modified = epubModified(meta.exportedAt);
  const manifestItems = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...zipImages.map((entry, index) => {
      const href = entry.name.slice('EPUB/'.length);
      return `<item id="img-${index + 1}" href="${escapeXml(href)}" media-type="${manifestMime(entry.mime)}"/>`;
    }),
  ].join('\n    ');

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" xml:lang="en" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:boffin:${escapeXml(modified)}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${escapeXml(modified)}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>
`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

  const entries = [
    { name: 'mimetype', data: textBytes('application/epub+zip') },
    { name: 'META-INF/container.xml', data: textBytes(container) },
    { name: 'EPUB/content.opf', data: textBytes(opf) },
    { name: 'EPUB/nav.xhtml', data: textBytes(nav) },
    { name: 'EPUB/chapter.xhtml', data: textBytes(chapter) },
    { name: 'EPUB/style.css', data: textBytes(EPUB_CSS) },
    ...zipImages,
  ];

  return createZip(entries);
}

function escapeHtmlClass(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, '');
}
