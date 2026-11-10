import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THEME_INIT_MARKER,
  assertThemeInitPages,
  inlineScripts,
  renderThemeInit,
} from '../src/theme-init.js';

const script = "try {\n  var storedTheme = 'dark';\n} catch {\n}\n";

test('each page must include its own theme-init script', () => {
  assert.throws(
    () => assertThemeInitPages({
      'index.html': `<head>${THEME_INIT_MARKER}</head>`,
      'spec.html': '<head></head>',
    }, script),
    { message: 'Expected an inline theme-init script in spec.html.' },
  );
});

test('an empty snippet is refused before either page is checked', () => {
  assert.throws(
    () => assertThemeInitPages({
      'index.html': THEME_INIT_MARKER,
      'spec.html': THEME_INIT_MARKER,
    }, ' \n'),
    { message: 'Expected an inline theme-init script in index.html and spec.html.' },
  );
});

test('index and spec inline the same theme-init script', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const source = fs.readFileSync(path.join(root, 'public', 'theme-init.js'), 'utf8');
  const render = (name) => renderThemeInit(fs.readFileSync(path.join(root, 'public', name), 'utf8'), source);
  const indexScript = inlineScripts(render('index.html'));
  const specScript = inlineScripts(render('spec.html'));
  assert.equal(indexScript.length, 1);
  assert.deepEqual(specScript, indexScript);
  assert.equal(indexScript[0], `\n${source.trimEnd()}\n`);
  assert.doesNotMatch(render('index.html'), /theme-init\.js/);
});
