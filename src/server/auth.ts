/**
 * Session handling: a signed, httpOnly cookie carrying the user id.
 *
 * `Bun.password` (argon2id) and Hono's signed cookies mean no auth dependency.
 * The signature makes a forged id unusable; it does not encrypt it, which is
 * fine — the cookie only ever contains a numeric id.
 *
 * The loaded user is stored as a `PublicUser`, never as `UserAuthRow`: Drizzle
 * selects every column, so a credential-bearing row in `c.var` would be one
 * `c.json({ user })` away from leaking password hashes.
 */
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import type { Context, MiddlewareHandler } from 'hono'
import { findUserById } from '../db/repo'
import { toPublicUser } from '../shared/types'
import type { PublicUser } from '../shared/types'

const COOKIE = 'bunbolt_session'

function resolveSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[bunbolt] SESSION_SECRET must be set when NODE_ENV=production')
  }
  return 'bunbolt-insecure-dev-secret'
}

const SECRET = resolveSecret()

export type AppEnv = { Variables: { user: PublicUser | null } }

/** Loads the signed cookie into `c.var.user`; banned accounts read as anonymous. */
export const session: MiddlewareHandler<AppEnv> = async (c, next) => {
  const raw = await getSignedCookie(c, SECRET, COOKIE)
  const id = raw ? Number(raw) : 0
  const user = Number.isInteger(id) && id > 0 ? await findUserById(id) : null
  c.set('user', user && !user.banned ? toPublicUser(user) : null)
  await next()
}

export async function startSession(c: Context, userId: number): Promise<void> {
  await setSignedCookie(c, COOKIE, String(userId), SECRET, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })
}

export async function endSession(c: Context): Promise<void> {
  deleteCookie(c, COOKIE, { path: '/' })
}

export const currentUser = (c: Context<AppEnv>): PublicUser | null => c.get('user')

/** Owners may remove their own content; admins may remove anything. */
export const canManage = (user: PublicUser, ownerId: number): boolean =>
  user.role === 'admin' || user.id === ownerId
