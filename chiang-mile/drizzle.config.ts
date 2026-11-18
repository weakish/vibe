import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './migrations',
  schema: './db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: '.data/db.sqlite',
  },
})
