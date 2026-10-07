/**
 * Session handling: a signed, httpOnly cookie carrying `<user id>:<session
 * version>`. The version is what lets a password reset invalidate every cookie
 * issued before it — see `resetUserPassword`.
 *
 * `Bun.password` (argon2id) and Hono's signed cookies mean no auth dependency.
 * The signature makes a forged cookie unusable; it does not encrypt it, which is
 * fine — the payload is a numeric id and a counter.
 *
 * The loaded user is stored as a `SelfUser`, never as `UserAuthRow`: Drizzle
 * selects every column, so a credential-bearing row in `c.var` would be one
 * `c.json({ user })` away from leaking password hashes.
 */
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import type { Context, MiddlewareHandler } from 'hono'
import { clearExpiredBan, findUserById } from '../db/repo'
import { mailConfigured } from './mailer'
import { toSelfUser } from '../shared/types'
import type { PublicUser, SelfUser } from '../shared/types'

const COOKIE = 'buntalk_session'

function resolveSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[buntalk] SESSION_SECRET must be set when NODE_ENV=production')
  }
  return 'buntalk-insecure-dev-secret'
}

const SECRET = resolveSecret()

export type AppEnv = { Variables: { user: SelfUser | null } }

/** Loads the signed cookie into `c.var.user`; banned accounts read as anonymous. */
export const session: MiddlewareHandler<AppEnv> = async (c, next) => {
  const raw = await getSignedCookie(c, SECRET, COOKIE)
  // Bare id is a pre-versioning cookie; it reads as version 0, which is exactly
  // what an account that has never reset its password still carries.
  const [idPart, verPart] = (typeof raw === 'string' ? raw : '').split(':')
  const id = Number(idPart)
  let user = Number.isInteger(id) && id > 0 ? await findUserById(id) : null
  if (user && Number(verPart ?? 0) !== user.sessionVersion) {
    // Password was reset since this cookie was minted (or it was tampered with).
    user = null
    deleteCookie(c, COOKIE, { path: '/' })
  }
  // A temporary ban that has run out lifts itself on the next request.
  if (user && (await clearExpiredBan(user))) {
    user = { ...user, banned: false, banReason: '', bannedUntil: null }
  }
  c.set('user', user && !user.banned ? toSelfUser(user) : null)
  await next()
}

export async function startSession(
  c: Context,
  userId: number,
  sessionVersion: number,
): Promise<void> {
  await setSignedCookie(c, COOKIE, `${userId}:${sessionVersion}`, SECRET, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })
}

export async function endSession(c: Context): Promise<void> {
  deleteCookie(c, COOKIE, { path: '/' })
}

export const currentUser = (c: Context<AppEnv>): SelfUser | null => c.get('user')

/** Owners may remove their own content; admins may remove anything. */
export const canManage = (user: PublicUser, ownerId: number): boolean =>
  user.role === 'admin' || user.id === ownerId

/**
 * Forced email binding: on only when the operator asked for it AND mail can
 * actually deliver a code. With SMTP misconfigured there is no way to verify, so
 * enforcing it would lock every user out — hence the `mailConfigured` guard.
 */
export const emailBindingRequired = (): boolean =>
  process.env.REQUIRE_EMAIL_BINDING === 'true' && mailConfigured()

/**
 * Paths a logged-in but unverified user may still reach while binding is
 * required: read the session, log out, read the meta beacon, and use the
 * binding endpoints. Everything else is refused, so the client-side redirect to
 * the binding page is not merely advisory.
 */
const EMAIL_GATE_ALLOWED = ['/api/auth/me', '/api/auth/logout', '/api/meta']

export const emailGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user')
  if (!user || user.emailVerified || !emailBindingRequired()) return next()
  const path = c.req.path
  if (EMAIL_GATE_ALLOWED.includes(path) || path.startsWith('/api/users/me')) return next()
  return c.json({ error: '请先绑定邮箱', code: 'EMAIL_REQUIRED' }, 403)
}
