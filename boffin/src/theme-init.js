import { readFileSync } from 'node:fs';
import path from 'node:path';

// One snippet is written into both pages before the stylesheet. The file is
// not served; a separate request would paint before the saved choice applied.
export const THEME_INIT_MARKER = '<!-- theme-init -->';

export function inlineScripts(html) {
  return [...String(html).matchAll(/<script>([^]*?)<\/script>/g)].map((match) => match[1]);
}

export function renderThemeInit(html, script) {
  if (!String(html).includes(THEME_INIT_MARKER)) {
    return html;
  }
  if (!String(script).trim() || String(script).includes('</script>')) {
    throw new Error('Expected an inline theme-init script in index.html and spec.html.');
  }
  return String(html).replaceAll(THEME_INIT_MARKER, `<script>\n${String(script).trimEnd()}\n</script>`);
}

// Each page has to contribute its own script. One hit across both files still
// leaves the other page painting with the device theme.
export function assertThemeInitPages(pages, script) {
  if (!String(script).trim() || String(script).includes('</script>')) {
    throw new Error('Expected an inline theme-init script in index.html and spec.html.');
  }
  for (const [name, html] of Object.entries(pages)) {
    if (!String(html).includes(THEME_INIT_MARKER) || inlineScripts(renderThemeInit(html, script)).length === 0) {
      throw new Error(`Expected an inline theme-init script in ${name}.`);
    }
  }
}

export function assertProjectThemeInit(projectRoot) {
  const script = readThemeInit(projectRoot);
  const pages = {};
  for (const name of ['index.html', 'spec.html']) {
    pages[name] = readFileSync(path.join(projectRoot, 'public', name), 'utf8');
  }
  assertThemeInitPages(pages, script);
}

function readThemeInit(projectRoot) {
  try {
    return readFileSync(path.join(projectRoot, 'public', 'theme-init.js'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Expected an inline theme-init script in index.html and spec.html.');
    }
    throw error;
  }
}
