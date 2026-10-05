/**
 * Server entry — `bun run index.ts`, or `bun run dev` for API + Vite together.
 */
import { databaseUrl, dialect, ensureSchema } from './src/db/index'
import { app } from './src/server/app'
import { driver as storageDriver, maxUploadBytes, uploadDir } from './src/server/storage'

await ensureSchema()

const port = Number(process.env.PORT) || 3000

// Coarse body cap, deliberately above the per-file limit so multipart framing
// fits; its job is to refuse an oversized body before it is buffered. The real
// per-file policy lives in the upload route.
const server = Bun.serve({
  port,
  fetch: app.fetch,
  maxRequestBodySize: maxUploadBytes * 2,
})

// Credentials redacted: DATABASE_URL routinely carries a password.
const safeUrl = databaseUrl.replace(/\/\/[^@/]*@/, '//***@')
console.log(`[bunbolt] ${dialect} · ${safeUrl}`)
console.log(
  storageDriver === 's3'
    ? '[bunbolt] uploads → s3'
    : `[bunbolt] uploads → ${uploadDir} (local)`,
)
console.log(`[bunbolt] listening on ${server.url}`)
