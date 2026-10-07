/**
 * Email binding, email login and password reset over HTTP.
 *
 * SMTP is unconfigured in tests, so codes are never mailed — the tests plant
 * the token row directly (exactly what the mail path would have written) and
 * then exercise the consume path. The reset test flips `SMTP_HOST` on for the
 * one call that gates on it, and restores it, so it cannot leak into a
 * neighbour test.
 */
import { describe, expect, test } from 'bun:test'

const store = await import('../src/db/index')
const repo = await import('../src/db/repo')
const { app } = await import('../src/server/app')

await store.ensureSchema()

function sessionCookie(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

const sha256 = (code: string) => new Bun.CryptoHasher('sha256').update(code).digest('hex')

async function plantToken(userId: number, kind: 'verify' | 'reset', code: string): Promise<void> {
  await repo.saveEmailToken({
    userId,
    kind,
    codeHash: sha256(code),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
  })
}

async function register(username: string): Promise<{ cookie: string; id: number }> {
  const res = await post('/api/auth/register', {
    username,
    displayName: username,
    password: 'password123',
  })
  expect(res.status).toBe(201)
  const { user } = (await res.json()) as { user: { id: number } }
  return { cookie: sessionCookie(res), id: user.id }
}

describe('email binding', () => {
  test('bind → verify → login by email', async () => {
    const { cookie, id } = await register('email_alice')

    expect(((await (await app.request('/api/meta')).json()) as { mailConfigured: boolean }).mailConfigured).toBe(false)

    // No SMTP: the address is stored unverified and no code goes out.
    const bind = await post('/api/users/me/email', { email: 'Alice@Example.test' }, cookie)
    expect(bind.status).toBe(200)
    expect(await bind.json()).toEqual({
      email: 'alice@example.test',
      emailVerified: false,
      codeSent: false,
      mailConfigured: false,
    })
    expect((await repo.findUserById(id))?.email).toBe('alice@example.test')
    expect(await repo.findVerifiedUserByEmail('alice@example.test')).toBeNull()

    // No token exists, so verifying fails.
    expect((await post('/api/users/me/email/verify', { code: '123456' }, cookie)).status).toBe(400)

    // A wrong code is refused and spends an attempt.
    await plantToken(id, 'verify', '000000')
    expect((await post('/api/users/me/email/verify', { code: '111111' }, cookie)).status).toBe(400)
    expect((await repo.findEmailToken(id, 'verify'))?.attempts).toBe(1)

    // The real code confirms the address and burns the token.
    await plantToken(id, 'verify', '123456')
    const verify = await post('/api/users/me/email/verify', { code: '123456' }, cookie)
    expect(verify.status).toBe(200)
    expect(await verify.json()).toEqual({ email: 'alice@example.test', emailVerified: true })
    expect(await repo.findEmailToken(id, 'verify')).toBeNull()
    expect(await repo.findVerifiedUserByEmail('alice@example.test')).not.toBeNull()

    // The verified address is now a login credential.
    const login = await post('/api/auth/login', { username: 'alice@example.test', password: 'password123' })
    expect(login.status).toBe(200)
    expect(((await login.json()) as { user: { email: string } }).user.email).toBe('alice@example.test')
  })

  test('a verified address cannot be bound by another account', async () => {
    const bob = await register('email_bob')
    const bind = await post('/api/users/me/email', { email: 'alice@example.test' }, bob.cookie)
    expect(bind.status).toBe(409)
    expect((await repo.findUserById(bob.id))?.email).toBe('')
  })

  test('unbind clears the address and its tokens', async () => {
    const u = await register('email_dave')
    await post('/api/users/me/email', { email: 'dave@example.test' }, u.cookie)
    await plantToken(u.id, 'verify', '123456')

    const res = await app.request('/api/users/me/email', { method: 'DELETE', headers: { cookie: u.cookie } })
    expect(res.status).toBe(200)
    expect(((await repo.findUserById(u.id))?.email) ?? '').toBe('')
    expect(await repo.findEmailToken(u.id, 'verify')).toBeNull()
  })
})

describe('password reset', () => {
  test('inert without SMTP, works with a code', async () => {
    const { cookie, id } = await register('email_carol')
    await post('/api/users/me/email', { email: 'carol@example.test' }, cookie)
    await plantToken(id, 'verify', '123456')
    await post('/api/users/me/email/verify', { code: '123456' }, cookie)

    // Without SMTP nothing is sent and the reset is refused up front.
    expect(await (await post('/api/auth/forgot-password', { email: 'carol@example.test' })).json()).toEqual({
      ok: true,
      mailConfigured: false,
    })
    expect(
      (await post('/api/auth/reset-password', { email: 'carol@example.test', code: '654321', password: 'newpass123' })).status,
    ).toBe(400)

    // Turn mail on for the one call that gates on it; consuming a code never sends.
    const prev = process.env.SMTP_HOST
    process.env.SMTP_HOST = 'smtp.test'
    try {
      await plantToken(id, 'reset', '654321')
      const reset = await post('/api/auth/reset-password', {
        email: 'carol@example.test',
        code: '654321',
        password: 'newpass123',
      })
      expect(reset.status).toBe(200)
    } finally {
      if (prev === undefined) delete process.env.SMTP_HOST
      else process.env.SMTP_HOST = prev
    }

    // Old password is dead, the new one works, and the reset token is spent.
    expect((await post('/api/auth/login', { username: 'email_carol', password: 'password123' })).status).toBe(401)
    expect(await repo.findEmailToken(id, 'reset')).toBeNull()

    // The reset bumped the session version, so the cookie from before it is now
    // anonymous — a stolen session is logged out.
    const stale = (await (await app.request('/api/auth/me', { headers: { cookie } })).json()) as {
      user: unknown
    }
    expect(stale.user).toBeNull()

    // A fresh login mints a cookie that does work again.
    const relogin = await post('/api/auth/login', { username: 'email_carol', password: 'newpass123' })
    expect(relogin.status).toBe(200)
    const me = (await (
      await app.request('/api/auth/me', { headers: { cookie: sessionCookie(relogin) } })
    ).json()) as { user: { username: string } | null }
    expect(me.user?.username).toBe('email_carol')
  })
})

describe('forced email binding', () => {
  test('is inert without SMTP, then bites once mail is configured', async () => {
    const { cookie, id } = await register('email_gate')
    const prevReq = process.env.REQUIRE_EMAIL_BINDING
    const prevSmtp = process.env.SMTP_HOST
    process.env.REQUIRE_EMAIL_BINDING = 'true'
    try {
      // No SMTP → the gate is skipped, because users could never verify.
      delete process.env.SMTP_HOST
      expect((await app.request('/api/threads', { headers: { cookie } })).status).toBe(200)

      // With mail available the same request is refused...
      process.env.SMTP_HOST = 'smtp.test'
      const blocked = await app.request('/api/threads', { headers: { cookie } })
      expect(blocked.status).toBe(403)
      expect(((await blocked.json()) as { code: string }).code).toBe('EMAIL_REQUIRED')

      // ...while the binding page's own calls stay reachable.
      expect((await app.request('/api/auth/me', { headers: { cookie } })).status).toBe(200)
      expect((await app.request('/api/meta')).status).toBe(200)

      // Verify the address (token planted, so no mail is sent) and the gate lifts.
      await repo.updateUserEmail(id, 'gate@example.test', false)
      await plantToken(id, 'verify', '123456')
      await post('/api/users/me/email/verify', { code: '123456' }, cookie)
      expect((await app.request('/api/threads', { headers: { cookie } })).status).toBe(200)
    } finally {
      if (prevReq === undefined) delete process.env.REQUIRE_EMAIL_BINDING
      else process.env.REQUIRE_EMAIL_BINDING = prevReq
      if (prevSmtp === undefined) delete process.env.SMTP_HOST
      else process.env.SMTP_HOST = prevSmtp
    }
  })
})
