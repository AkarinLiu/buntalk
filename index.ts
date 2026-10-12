/**
 * Server entry — `bun run index.ts`, or `bun run dev` for API + Vite together.
 */
import { databaseUrl, dialect, ensureSchema } from './src/db/index'
import { ensureReportReasons, ensureSystemUser } from './src/db/repo'
import { app } from './src/server/app'
import { mailConfigured } from './src/server/mailer'
import { driver as storageDriver, maxUploadBytes, uploadDir } from './src/server/storage'

await ensureSchema()
await ensureSystemUser()
await ensureReportReasons()

// Forced binding is a no-op without mail; say so loudly rather than silently
// ignoring the flag (which would be indistinguishable from a typo).
if (process.env.REQUIRE_EMAIL_BINDING === 'true' && !mailConfigured()) {
  console.warn(
    '[buntalk] REQUIRE_EMAIL_BINDING=true but SMTP is not configured — ignoring it, users could not verify.',
  )
}

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
console.log(`[buntalk] ${dialect} · ${safeUrl}`)
console.log(
  storageDriver === 's3'
    ? '[buntalk] uploads → s3'
    : `[buntalk] uploads → ${uploadDir} (local)`,
)
console.log(`[buntalk] listening on ${server.url}`)
