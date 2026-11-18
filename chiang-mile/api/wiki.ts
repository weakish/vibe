import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, zValidator } from 'speed-framework'
import { revisions, type Revision } from '../db/schema'
import { diffLines } from '../lib/line-diff'
import { editPageHtml, historyPageHtml } from '../lib/wiki-views'
import {
  readSeedText,
  renderWikiHtml,
  revisionJson,
  revisionSummary,
  withChrome,
  writeHtmlCache,
} from '../lib/wiki-page'

let seeded = false
let seedInFlight: Promise<Revision> | null = null

async function latestRevision() {
  const [row] = await db.select().from(revisions).orderBy(desc(revisions.id)).limit(1)
  return row
}

async function seedRevision(): Promise<Revision> {
  const text = await readSeedText()
  const htmlDoc = renderWikiHtml(text)
  const [created] = await db
    .insert(revisions)
    .values({
      text,
      html: htmlDoc,
      editorUserId: 'seed',
      editorName: 'seed',
      source: 'seed',
      createdAt: Date.now(),
    })
    .returning()
  if (!created) throw new HTTPException(500, { message: 'Failed to seed wiki' })
  await writeHtmlCache(withChrome(htmlDoc, 'page'))
  return created
}

async function ensureSeed(): Promise<Revision> {
  const row = await latestRevision()
  if (row) {
    await writeHtmlCache(withChrome(row.html, 'page'))
    seeded = true
    return row
  }
  const created = await seedRevision()
  seeded = true
  return created
}

async function currentRevision() {
  // Select and insert both await, so concurrent first requests would each insert a seed.
  if (!seeded) {
    let pending = seedInFlight
    if (!pending) {
      pending = ensureSeed().finally(() => {
        seedInFlight = null
      })
      seedInFlight = pending
    }
    return pending
  }
  const row = await latestRevision()
  if (row) return row
  seeded = false
  return currentRevision()
}

function requireUser(ctx: { var: { userId?: string } }) {
  if (!ctx.var.userId) {
    throw new HTTPException(401, { message: 'Authentication required' })
  }
  return ctx.var.userId
}

function htmlResponse(htmlDoc: string) {
  return new Response(htmlDoc, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

const revisionSummaryColumns = {
  id: revisions.id,
  editorUserId: revisions.editorUserId,
  editorName: revisions.editorName,
  source: revisions.source,
  revertedFromId: revisions.revertedFromId,
  createdAt: revisions.createdAt,
}

async function revisionById(id: number) {
  const [row] = await db.select().from(revisions).where(eq(revisions.id, id)).limit(1)
  if (!row) throw new HTTPException(404, { message: `Revision ${id} not found` })
  return row
}

async function loadRevisionPair(from: string, to: string) {
  const fromId = Number(from)
  const toId = Number(to)
  if (!Number.isInteger(fromId) || fromId < 1 || !Number.isInteger(toId) || toId < 1) {
    throw new HTTPException(400, { message: 'from and to must be positive integers' })
  }
  return {
    fromId,
    toId,
    fromRow: await revisionById(fromId),
    toRow: await revisionById(toId),
  }
}

export const routes = new Hono()
  .basePath('/wiki')
  .get('/html', zValidator('query', z.object({ revisionId: z.string().optional() })), async (ctx) => {
    const { revisionId } = ctx.req.valid('query')
    if (revisionId) {
      const id = Number(revisionId)
      if (!Number.isInteger(id) || id < 1) {
        throw new HTTPException(400, { message: 'revisionId must be a positive integer' })
      }
      const row = await revisionById(id)
      return htmlResponse(
        withChrome(row.html, 'page', `<p>Revision #${row.id} (<a href="/">current</a>)</p>\n`),
      )
    }
    const row = await currentRevision()
    return htmlResponse(withChrome(row.html, 'page'))
  })
  .get(
    '/history',
    zValidator(
      'query',
      z.object({
        from: z.string().optional(),
        to: z.string().optional(),
      }),
    ),
    async (ctx) => {
      await currentRevision()
      const rows = await db
        .select(revisionSummaryColumns)
        .from(revisions)
        .orderBy(desc(revisions.id))
      const { from, to } = ctx.req.valid('query')
      if (from || to) {
        if (!from || !to) {
          throw new HTTPException(400, { message: 'from and to are required together' })
        }
        const { fromId, toId, fromRow, toRow } = await loadRevisionPair(from, to)
        return htmlResponse(
          historyPageHtml(
            rows.map(revisionSummary),
            { fromId, toId, ops: diffLines(fromRow.text, toRow.text) },
          ),
        )
      }
      return htmlResponse(historyPageHtml(rows.map(revisionSummary), null))
    },
  )
  .get('/edit', async () => {
    const row = await currentRevision()
    return htmlResponse(editPageHtml(row.text))
  })
  .post(
    '/preview',
    zValidator('json', z.object({ text: z.string() })),
    async (ctx) => {
      const { text } = ctx.req.valid('json')
      return htmlResponse(renderWikiHtml(text))
    },
  )
  .get('/revisions', async (ctx) => {
    await currentRevision()
    const rows = await db.select(revisionSummaryColumns).from(revisions).orderBy(desc(revisions.id))
    return ctx.json(rows.map(revisionSummary))
  })
  .get(
    '/diff',
    zValidator(
      'query',
      z.object({
        from: z.string(),
        to: z.string(),
      }),
    ),
    async (ctx) => {
      const { fromRow, toRow } = await loadRevisionPair(
        ctx.req.valid('query').from,
        ctx.req.valid('query').to,
      )
      return ctx.json({
        from: revisionSummary(fromRow),
        to: revisionSummary(toRow),
        ops: diffLines(fromRow.text, toRow.text),
      })
    },
  )
  .get('/', async (ctx) => {
    const row = await currentRevision()
    return ctx.json(revisionJson(row))
  })
  .put(
    '/',
    zValidator(
      'json',
      z.object({
        text: z.string(),
        editorName: z.string().min(1),
      }),
    ),
    async (ctx) => {
      const userId = requireUser(ctx)
      const { text, editorName } = ctx.req.valid('json')
      const htmlDoc = renderWikiHtml(text)
      const [row] = await db
        .insert(revisions)
        .values({
          text,
          html: htmlDoc,
          editorUserId: userId,
          editorName,
          source: 'edit',
          createdAt: Date.now(),
        })
        .returning()
      if (!row) throw new HTTPException(500, { message: 'Failed to save wiki' })
      await writeHtmlCache(withChrome(htmlDoc, 'page'))
      return ctx.json(revisionJson(row))
    },
  )
  .post(
    '/revert',
    zValidator(
      'json',
      z.object({
        revisionId: z.number().int().positive(),
        editorName: z.string().min(1),
      }),
    ),
    async (ctx) => {
      const userId = requireUser(ctx)
      const { revisionId, editorName } = ctx.req.valid('json')
      const target = await revisionById(revisionId)
      const htmlDoc = renderWikiHtml(target.text)
      const [row] = await db
        .insert(revisions)
        .values({
          text: target.text,
          html: htmlDoc,
          editorUserId: userId,
          editorName,
          source: 'revert',
          revertedFromId: target.id,
          createdAt: Date.now(),
        })
        .returning()
      if (!row) throw new HTTPException(500, { message: 'Failed to revert wiki' })
      await writeHtmlCache(withChrome(htmlDoc, 'page'))
      return ctx.json(revisionJson(row))
    },
  )

export type AppType = typeof routes

void currentRevision().catch((err) => {
  console.error('Failed to sync initial wiki HTML cache:', err)
})
