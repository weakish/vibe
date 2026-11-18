import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { html } from './htm.bs.js'
import type { DiffOp } from './line-diff'

export function appRoot(): string {
  return process.env.APP_ROOT || '/tmp/repo'
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderWikiHtml(text: string): string {
  return html(text, 'html5')
}

export const FOOTER_HTML =
  '<hr>\n<p>100% vibe, 0% code review by humans, proudly hosted in <a href="https://speed.so">Chiang Mai</a></p>'

export type ChromeView = 'page' | 'history' | 'edit'

export function headerHtml(view: ChromeView): string {
  if (view === 'page') {
    return '<p><a href="/api/wiki/history">History</a> | <a href="/api/wiki/edit">Edit</a></p>\n<hr>\n'
  }
  return '<p><a href="/">Page</a></p>\n<hr>\n'
}

export function withChrome(documentHtml: string, view: ChromeView, extraHeader = ''): string {
  const chrome = headerHtml(view) + extraHeader
  // htm escapes the title, which cannot contain a newline. Body text may contain "</body>".
  const marker = '</head>\n<body>'
  const headBody = documentHtml.indexOf(marker)
  const close = documentHtml.lastIndexOf('</body>')
  if (headBody !== -1 && close > headBody) {
    const afterOpen = headBody + marker.length
    return (
      documentHtml.slice(0, afterOpen) +
      `\n${chrome}` +
      documentHtml.slice(afterOpen, close) +
      `${FOOTER_HTML}\n` +
      documentHtml.slice(close)
    )
  }
  return `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>\n<body>\n${chrome}${documentHtml}\n${FOOTER_HTML}\n</body>\n</html>`
}

export function toolPage(title: string, view: ChromeView, body: string): string {
  return withChrome(
    `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n</head>\n<body>\n${body}\n</body>\n</html>`,
    view,
  )
}

export async function readSeedText(): Promise<string> {
  return readFile(path.join(appRoot(), 'index.txt'), 'utf8')
}

// Speed serves dist/index.html for / and for the old /edit and /history paths.
const STATIC_ROOT_ROUTER_SCRIPT = `<script>
var path = location.pathname.replace(/\\/+$/, "") || "/"
if (path === "/index.html") path = "/"
var dest = ""
if (path === "/edit") dest = "/api/wiki/edit"
else if (path === "/history") dest = "/api/wiki/history"
else if (path === "/" && location.search) dest = "/api/wiki/html"
if (dest) location.replace(dest + location.search + location.hash)
</script>
`

let nextAtomicWriteId = 0

async function replaceFileAtomically(filePath: string, contents: string): Promise<void> {
  nextAtomicWriteId += 1
  const temporaryPath = `${filePath}.${process.pid}.${nextAtomicWriteId}.tmp`
  try {
    await writeFile(temporaryPath, contents)
    await rename(temporaryPath, filePath)
  } catch (err) {
    try {
      await rm(temporaryPath, { force: true })
    } catch {
      // Cleanup must not hide the write error.
    }
    throw err
  }
}

// The API response sets charset=utf-8. This file is served as a static document, so the declaration has to travel with it and stay inside the encoding prescan.
const STATIC_ROOT_HEAD = `<meta charset="utf-8">\n${STATIC_ROOT_ROUTER_SCRIPT}`

function htmlDocumentWithStaticRootRouter(htmlDoc: string): string {
  const head = htmlDoc.indexOf('<head>')
  if (head === -1) return STATIC_ROOT_HEAD + htmlDoc
  const insertAt = head + '<head>'.length
  return `${htmlDoc.slice(0, insertAt)}\n${STATIC_ROOT_HEAD}${htmlDoc.slice(insertAt)}`
}

let htmlCacheWrite: Promise<void> = Promise.resolve()

async function writeHtmlCacheFiles(htmlDoc: string): Promise<void> {
  const root = appRoot()
  const dataDir = path.join(root, '.data')
  const distDir = path.join(root, 'dist')
  await mkdir(dataDir, { recursive: true })
  await mkdir(distDir, { recursive: true })
  await replaceFileAtomically(path.join(dataDir, 'wiki.html'), htmlDoc)
  await replaceFileAtomically(path.join(distDir, 'index.html'), htmlDocumentWithStaticRootRouter(htmlDoc))
}

export function writeHtmlCache(htmlDoc: string): Promise<void> {
  const run = htmlCacheWrite.then(() => writeHtmlCacheFiles(htmlDoc))
  // A rejected write must not pin the queue. Callers still see `run` reject.
  htmlCacheWrite = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function revisionJson(row: {
  id: number
  text: string
  html: string
  editorUserId: string
  editorName: string
  source: string
  revertedFromId: number | null
  createdAt: number
}) {
  return {
    id: row.id,
    text: row.text,
    html: row.html,
    editorUserId: row.editorUserId,
    editorName: row.editorName,
    source: row.source,
    revertedFromId: row.revertedFromId,
    createdAt: row.createdAt,
  }
}

export function revisionSummary(row: {
  id: number
  editorUserId: string
  editorName: string
  source: string
  revertedFromId: number | null
  createdAt: number
}) {
  return {
    id: row.id,
    editorUserId: row.editorUserId,
    editorName: row.editorName,
    source: row.source,
    revertedFromId: row.revertedFromId,
    createdAt: row.createdAt,
  }
}

export function formatTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

export function diffPre(ops: DiffOp[]): string {
  const lines = ops.map((op) => {
    const text = escapeHtml(op.text)
    if (op.kind === 'insert') return `<ins>+ ${text}</ins>`
    if (op.kind === 'delete') return `<del>- ${text}</del>`
    return `  ${text}`
  })
  return `<pre>${lines.join('\n')}</pre>`
}
