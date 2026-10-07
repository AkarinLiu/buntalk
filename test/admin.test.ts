/**
 * Drives the real Hono app end to end: session cookie, admin gate, ban flow.
 * The repo-level tests pass while the UI is broken, so this covers the HTTP
 * contract the admin page actually consumes (`GET /admin/users` must report
 * `banned`).
 */
import { describe, expect, test } from 'bun:test'

const store = await import('../src/db/index')
const { app } = await import('../src/server/app')

await store.ensureSchema()

/** `set-cookie` as a `name=value` pair usable as a request `cookie`. */
function sessionCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? ''
  return raw.split(';')[0] ?? ''
}

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('admin ban over HTTP', () => {
  test('banning a user flips their status in GET /admin/users', async () => {
    const first = await post('/api/auth/register', {
      username: 'http_admin',
      displayName: 'Http Admin',
      password: 'password123',
    })
    expect(first.status).toBe(201)
    const adminCookie = sessionCookie(first)

    const second = await post('/api/auth/register', {
      username: 'http_target',
      displayName: 'Http Target',
      password: 'password123',
    })
    expect(second.status).toBe(201)
    const target = (await second.json()) as { user: { id: number } }

    const banned = await app.request(`/api/admin/users/${target.user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ banned: true, banReason: '测试', bannedUntil: null }),
    })
    expect(banned.status).toBe(200)

    const listRes = await app.request('/api/admin/users', { headers: { cookie: adminCookie } })
    expect(listRes.status).toBe(200)
    const users = (await listRes.json()) as { id: number; banned: boolean; banReason: string }[]
    const row = users.find((u) => u.id === target.user.id)
    expect(row?.banned).toBe(true)
    expect(row?.banReason).toBe('测试')

    // The admin page's loadAll fires these together; one failure aborts the
    // whole refresh, which would leave stale (unbanned) rows on screen.
    const loadAllParts = ['/api/categories', '/api/admin/users', '/api/admin/threads?limit=100', '/api/tags', '/api/admin/reports', '/api/admin/mail']
    for (const path of loadAllParts) {
      const res = await app.request(path, { headers: { cookie: adminCookie } })
      expect(`${path} -> ${res.status}`).toBe(`${path} -> 200`)
    }

    // Mail: unconfigured in tests, so the beacon reports that and refuses sends.
    const mailInfo = (await (await app.request('/api/admin/mail', { headers: { cookie: adminCookie } })).json()) as {
      configured: boolean
    }
    expect(mailInfo.configured).toBe(false)
    expect((await post('/api/admin/mail-test', { to: 'not-an-email' }, adminCookie)).status).toBe(400)
    const noSmtp = await post('/api/admin/mail-test', { to: 'a@b.co' }, adminCookie)
    expect(noSmtp.status).toBe(400)
    expect(((await noSmtp.json()) as { error: string }).error).toContain('SMTP')

    // Unbanning clears it again.
    await app.request(`/api/admin/users/${target.user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ banned: false }),
    })
    const after = (await (await app.request('/api/admin/users', { headers: { cookie: adminCookie } })).json()) as {
      id: number
      banned: boolean
    }[]
    expect(after.find((u) => u.id === target.user.id)?.banned).toBe(false)
  })
})
