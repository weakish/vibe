import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { headerHtml, normalizeNote, renderWikiHtml, toolPage, withChrome, writeHtmlCache } from '../lib/wiki-page'
import { editPageHtml, historyPageHtml } from '../lib/wiki-views'

describe('renderWikiHtml', () => {
  it('escapes the title and refuses non-https markdown targets', () => {
    const html = renderWikiHtml(
      '<img src=x onerror=alert(1)> & co\n[click](javascript:1)\n[ok](https://example.com/a)\n',
    )
    expect(html).toContain('<title>&lt;img src=x onerror=alert(1)&gt; &amp; co</title>')
    expect(html).toContain('<h1>&lt;img src=x onerror=alert(1)&gt; &amp; co</h1>')
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('<a href="https://example.com/a">ok</a>')
  })

  it('keeps adjacent markdown links as separate anchors', () => {
    const html = renderWikiHtml('T\n[a](https://example.com/a)[b](https://example.com/?x=1&y=2)\n')
    expect(html).toContain(
      '<a href="https://example.com/a">a</a><a href="https://example.com/?x=1&amp;y=2">b</a>',
    )
  })

  it('escapes a markdown label when a second link follows immediately', () => {
    const html = renderWikiHtml(
      'T\n[a](https://example.com/a)[<svg/onload=alert(1)>](https://example.com)\n',
    )
    expect(html).toContain('&lt;svg/onload=alert(1)&gt;')
    expect(html).not.toContain('<svg')
  })
})

describe('index.txt', () => {
  it('wraps every line under 50 columns', () => {
    const text = readFileSync(new URL('../index.txt', import.meta.url), 'utf8')
    for (const line of text.split('\n')) {
      expect(line.length).toBeLessThan(50)
    }
  })
})

describe('index.html', () => {
  it('forwards the query and old edit and history paths', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(html).toContain('location.search')
    expect(html).toContain('"/edit"')
    expect(html).toContain('"/api/wiki/edit"')
    expect(html).toContain('"/history"')
    expect(html).toContain('"/api/wiki/history"')
    const refreshAt = html.indexOf('http-equiv="refresh"')
    const noscriptAt = html.indexOf('<noscript>')
    expect(refreshAt).toBeGreaterThan(noscriptAt)
    expect(noscriptAt).toBeGreaterThan(-1)
  })
})

describe('withChrome', () => {
  it('places the footer at the document close when the body text contains </body>', () => {
    const doc =
      '<!DOCTYPE html>\n<html>\n<head></head>\n<body>\n<pre>see </body> in text</pre>\n</body>\n</html>'
    const out = withChrome(doc, 'page')
    const textAt = out.indexOf('see </body> in text')
    const footerAt = out.indexOf('100% vibe, 0% code review by humans, proudly hosted in <a href="https://speed.so">Chiang Mai</a>')
    const closeAt = out.lastIndexOf('</body>')
    expect(textAt).toBeGreaterThan(-1)
    expect(footerAt).toBeGreaterThan(textAt)
    expect(closeAt).toBeGreaterThan(footerAt)
    expect(out.slice(closeAt)).toBe('</body>\n</html>')
  })

  it('inserts chrome after the real body when the title contains <body>', () => {
    const out = withChrome(renderWikiHtml('<body> in the title\nrest'), 'page')
    const titleEnd = out.indexOf('</title>')
    const headerAt = out.indexOf('/api/wiki/history')
    expect(titleEnd).toBeGreaterThan(-1)
    expect(out.slice(0, titleEnd)).not.toContain('/api/wiki/history')
    expect(headerAt).toBeGreaterThan(titleEnd)
    expect(headerAt).toBeLessThan(out.lastIndexOf('</body>'))
  })
})

describe('headerHtml', () => {
  it('uses the same back-link on history and edit', () => {
    expect(headerHtml('history')).toBe(headerHtml('edit'))
    expect(headerHtml('history')).toContain('href="/"')
  })
})

describe('writeHtmlCache', () => {
  it('writes both .data/wiki.html and dist/index.html', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wiki-cache-'))
    const prevRoot = process.env.APP_ROOT
    process.env.APP_ROOT = dir
    try {
      const cached = '<!DOCTYPE html><title>cached</title>'
      await writeHtmlCache(cached)
      expect(readFileSync(path.join(dir, '.data', 'wiki.html'), 'utf8')).toBe(cached)
      const indexHtml = readFileSync(path.join(dir, 'dist', 'index.html'), 'utf8')
      expect(indexHtml).toContain(cached)
      expect(indexHtml.indexOf('<meta charset="utf-8">')).toBeLessThan(indexHtml.indexOf('<script>'))
      expect(indexHtml).toContain('if (path === "/edit") dest = "/api/wiki/edit"')
      expect(indexHtml).toContain('else if (path === "/history") dest = "/api/wiki/history"')
      expect(indexHtml).toContain('else if (path === "/" && location.search) dest = "/api/wiki/html"')
      expect(indexHtml).toContain('if (dest) location.replace(dest + location.search + location.hash)')
      expect(indexHtml).not.toContain('var dest = "/api/wiki/html"')
      expect(readdirSync(path.join(dir, 'dist')).filter((name) => name.endsWith('.tmp'))).toEqual([])
      process.env.APP_ROOT = path.join(dir, 'headed')
      await writeHtmlCache('<!DOCTYPE html>\n<html>\n<head><title>x</title></head>\n<body>x</body>\n</html>')
      const headed = readFileSync(path.join(dir, 'headed', 'dist', 'index.html'), 'utf8')
      expect(headed.indexOf('<head>\n<meta charset="utf-8">\n<script>')).toBeGreaterThan(-1)
      expect(headed.indexOf('<script>')).toBeLessThan(headed.indexOf('<title>'))
      const one = '<!DOCTYPE html><head></head><body>ONE</body>'
      const two = '<!DOCTYPE html><head></head><body>TWO</body>'
      await Promise.all([writeHtmlCache(one), writeHtmlCache(two)])
      expect(readFileSync(path.join(dir, 'headed', '.data', 'wiki.html'), 'utf8')).toBe(two)
      const paired = readFileSync(path.join(dir, 'headed', 'dist', 'index.html'), 'utf8')
      expect(paired).toContain('<body>TWO</body>')
      expect(paired).not.toContain('<body>ONE</body>')
    } finally {
      if (prevRoot === undefined) delete process.env.APP_ROOT
      else process.env.APP_ROOT = prevRoot
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('toolPage', () => {
  it('reuses withChrome for header and footer placement', () => {
    const body = '<h1>x</h1>'
    expect(toolPage('Edit', 'edit', body)).toBe(
      withChrome(
        `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Edit</title>\n</head>\n<body>\n${body}\n</body>\n</html>`,
        'edit',
      ),
    )
  })
})

describe('editPageHtml', () => {
  it('sandboxes the preview and leaves the source unspellchecked', () => {
    const html = editPageHtml('hello')
    expect(html).toContain('sandbox=""')
    expect(html).toContain('<iframe id="preview" sandbox="" width="800" height="480" hidden></iframe>')
    expect(html).toContain('spellcheck="false"')
    expect(html).toContain('onsubmit="return false"')
    const showAt = html.indexOf('async function showPreview()')
    const submitAt = html.indexOf('document.getElementById("edit").onsubmit')
    expect(html.slice(showAt, submitAt)).not.toContain('preview.srcdoc = ""')
    expect(html.slice(showAt, submitAt)).toContain('preview.hidden = false')
  })

  it('keeps unsaved text across a login redirect', () => {
    const html = editPageHtml('hello')
    expect(html).toContain('wiki-edit-draft')
    expect(html).toContain('sessionStorage.setItem(draftKey, text.value)')
    expect(html).toContain('sessionStorage.removeItem(draftKey)')
    const getAt = html.indexOf('sessionStorage.getItem(draftKey)')
    expect(html.lastIndexOf('try {', getAt)).toBeGreaterThan(-1)
    expect(html).toContain('Restored unsaved edit from this tab.')
    expect(html).toContain('Discard')
    expect(html).toContain('Could not restore unsaved edit')
    const restoreAt = html.indexOf('text.value = serverText')
    const invalidateAt = html.indexOf('++previewSeq', restoreAt)
    const blankAt = html.indexOf('preview.srcdoc = ""', restoreAt)
    const hideAt = html.indexOf('preview.hidden = true', restoreAt)
    const clearErrAt = html.indexOf('err.textContent = ""', restoreAt)
    const submitAt = html.indexOf('document.getElementById("edit").onsubmit')
    expect(restoreAt).toBeGreaterThan(-1)
    expect(invalidateAt).toBeGreaterThan(restoreAt)
    expect(blankAt).toBeGreaterThan(invalidateAt)
    expect(hideAt).toBeGreaterThan(blankAt)
    expect(clearErrAt).toBeGreaterThan(hideAt)
    expect(clearErrAt).toBeLessThan(submitAt)
  })

  it('drops stale preview bodies after they finish loading', () => {
    const html = editPageHtml('hello')
    const textAt = html.indexOf('await res.text()')
    const seqAt = html.indexOf('seq !== previewSeq', textAt)
    const srcdocAt = html.indexOf('preview.srcdoc', textAt)
    expect(textAt).toBeGreaterThan(-1)
    expect(seqAt).toBeGreaterThan(textAt)
    expect(srcdocAt).toBeGreaterThan(seqAt)
  })

  it('only previews when saving', () => {
    const html = editPageHtml('hello')
    expect(html).not.toContain('text.oninput')
    const submitAt = html.indexOf('document.getElementById("edit").onsubmit')
    const previewAt = html.lastIndexOf('showPreview()')
    expect(submitAt).toBeGreaterThan(-1)
    expect(previewAt).toBeGreaterThan(submitAt)
    expect(previewAt).toBeLessThan(html.lastIndexOf('speed-sdk.js'))
    expect(html.split('showPreview()')).toHaveLength(3)
    const previewBody = html.slice(html.indexOf('async function showPreview()'), submitAt)
    expect(previewBody).not.toContain('err.textContent = ""')
    expect(previewBody).toContain('if (!err.textContent) err.textContent =')
  })

  it('saves even when sessionStorage throws', () => {
    const html = editPageHtml('hello')
    const setAt = html.indexOf('sessionStorage.setItem(draftKey, text.value)')
    const catchAt = html.indexOf('catch (storageError)', setAt)
    const authAt = html.indexOf('speed.auth.getCurrentUser(false)', setAt)
    const redirectAt = html.indexOf('speed.auth.getCurrentUser(true)', authAt)
    const keepAt = html.indexOf('if (draftError)', authAt)
    expect(setAt).toBeGreaterThan(-1)
    expect(catchAt).toBeGreaterThan(setAt)
    expect(authAt).toBeGreaterThan(catchAt)
    expect(keepAt).toBeGreaterThan(authAt)
    expect(redirectAt).toBeGreaterThan(keepAt)
    expect(html).toContain('Could not keep unsaved edit in this tab')
    expect(html).toContain('Saved, but could not clear the unsaved copy in this tab')
    const clearAt = html.indexOf('sessionStorage.removeItem(draftKey)', authAt)
    const clearCatchAt = html.indexOf('catch (storageError)', clearAt)
    const redirectAtSave = html.indexOf('location = "/"', clearCatchAt)
    expect(clearAt).toBeGreaterThan(authAt)
    expect(clearCatchAt).toBeGreaterThan(clearAt)
    expect(redirectAtSave).toBeGreaterThan(clearCatchAt)
  })

  it('includes a one-line note field that is sent on save and preserved in sessionStorage', () => {
    const html = editPageHtml('hello')
    expect(html).toContain('<input id="note" name="note" type="text"')
    expect(html).toContain('wiki-edit-note')
    expect(html).toContain('sessionStorage.setItem(noteKey, note.value)')
    expect(html).toContain('sessionStorage.removeItem(noteKey)')
    expect(html).toContain('note.value = ""')
    expect(html).toContain('note: note.value')
  })
})

describe('normalizeNote', () => {
  it('collapses newlines, trims whitespace, and turns blank notes into null', () => {
    expect(normalizeNote(undefined)).toBeNull()
    expect(normalizeNote(null)).toBeNull()
    expect(normalizeNote('   \n\t  ')).toBeNull()
    expect(normalizeNote('  fixed\r\ntypo\n  in schedule  ')).toBe('fixed typo in schedule')
  })
})

describe('historyPageHtml', () => {
  it('asks before reverting', () => {
    const html = historyPageHtml(
      [
        {
          id: 1,
          editorUserId: 'seed',
          editorName: 'seed',
          source: 'seed',
          note: null,
          revertedFromId: null,
          createdAt: 0,
        },
      ],
      null,
    )
    expect(html).toContain('confirm(')
    expect(html).toContain('The old revisions stay in history.')
    expect(html.indexOf('data-revision')).toBeLessThan(html.lastIndexOf('speed-sdk.js'))
    expect(html.indexOf('btn.onclick')).toBeLessThan(html.lastIndexOf('speed-sdk.js'))
  })

  it('renders and escapes revision notes in the history table', () => {
    const html = historyPageHtml(
      [
        {
          id: 2,
          editorUserId: 'u1',
          editorName: 'alice',
          source: 'edit',
          note: 'update <route> & time',
          revertedFromId: null,
          createdAt: 0,
        },
      ],
      null,
    )
    expect(html).toContain('<th>note</th>')
    expect(html).toContain('<td>update &lt;route&gt; &amp; time</td>')
  })
})
