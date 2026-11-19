import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const revisions = sqliteTable('revisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  text: text('text').notNull(),
  html: text('html').notNull(),
  editorUserId: text('editor_user_id').notNull(),
  editorName: text('editor_name').notNull(),
  source: text('source').notNull(),
  note: text('note'),
  revertedFromId: integer('reverted_from_id'),
  createdAt: integer('created_at').notNull(),
})

export type Revision = typeof revisions.$inferSelect
export type NewRevision = typeof revisions.$inferInsert
