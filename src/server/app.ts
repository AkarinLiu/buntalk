/**
 * Hono app: `/api` first, static SPA second.
 *
 * Ordering is load-bearing. Routes registered before a middleware run before
 * it, so the API answers without ever touching the static handler, and the SPA
 * fallback only fires for navigation-shaped requests (anything with a file
 * extension falls through to a real 404 instead of getting index.html back
 * with a 200, which would break every stale asset URL).
 */
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { join } from 'node:path'
import { session } from './auth'
import { api } from './routes'
import * as storage from './storage'
import type { AppEnv } from './auth'

const distDir = join(import.meta.dir, '..', '..', 'dist')
const distIndex = join(distDir, 'index.html')

export const app = new Hono<AppEnv>()

app.use('/api/*', session)
app.route('/api', api)

// Uploaded objects. The public path is backend-independent, which is what lets
// a post body written against local disk keep working after moving to S3.
app.use('/uploads/*', async (c, next) => {
  await next()
  // Belt and braces on top of the magic-byte allowlist: a browser must never
  // decide for itself what an uploaded file is.
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
})

if (storage.driver === 's3') {
  app.get('/uploads/*', async (c) => {
    const key = c.req.param('*') ?? ''
    if (!storage.isValidKey(key)) return c.notFound()
    const target = await storage.publicUrl(key)
    if (!target) return c.notFound()
    // Always 302: a presigned target is re-minted per request, so a cached
    // permanent redirect would eventually point at an expired signature.
    return c.redirect(target, 302)
  })
} else {
  app.use(
    '/uploads/*',
    serveStatic({
      root: storage.uploadDir,
      rewriteRequestPath: (path) => path.replace(/^\/uploads/, ''),
    }),
  )
}

// Built frontend present? Serve it. Absent (fresh clone, dev against Vite),
// skip — `bun run dev` puts the UI on :5173 instead.
if (await Bun.file(distIndex).exists()) {
  app.use('/*', serveStatic({ root: distDir }))

  app.get('*', async (c, next) => {
    // Never let the SPA fallback answer for the API, or an unknown endpoint
    // would return index.html with a 200 instead of the JSON 404 below.
    if (c.req.path.startsWith('/api')) return await next()
    // Anything with a file extension is a real asset request: a 404 is the
    // honest answer, and returning HTML there breaks stale asset URLs.
    if (/\.[a-z0-9]+$/i.test(c.req.path)) return await next()
    return serveStatic({ path: distIndex })(c, next)
  })
}

app.notFound((c) =>
  c.req.path.startsWith('/api')
    ? c.json({ error: '接口不存在' }, 404)
    : c.text('Not Found', 404),
)
