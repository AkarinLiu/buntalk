/**
 * The whole HTTP API. Everything under `/api`.
 *
 * Route layout:
 *   /auth/*    session endpoints
 *   /categories, /threads, /posts, /users   public reads + member writes
 *   /admin/*   gated by one `adminOnly` middleware, so permission logic exists once
 *
 * Validation is hand-rolled: there are ~10 endpoints and no dependency earns
 * its place here. Every input is length-bounded before it reaches the DB.
 */
import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import * as repo from '../db/repo'
import { toPublicUser, toSelfUser } from '../shared/types'
import type { EmailTokenKind, Role } from '../shared/types'
import { canManage, currentUser, emailBindingRequired, endSession, startSession } from './auth'
import type { AppEnv } from './auth'
import { sniff } from './filetype'
import * as mailer from './mailer'
import * as storage from './storage'

const USERNAME_RE = /^[\p{L}\p{N}_]{2,32}$/u
const ROLE_RE = /^(user|admin)$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ErrStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 502
const fail = (c: Context, error: string, status: ErrStatus = 400) => c.json({ error }, status)

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    return await c.req.json()
  } catch {
    return {}
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function idOf(c: Context, name = 'id'): number | null {
  const n = Number(c.req.param(name))
  return Number.isInteger(n) && n > 0 ? n : null
}

function paging(c: Context) {
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 20, 1), 100)
  const offset = Math.max(Math.floor(Number(c.req.query('offset')) || 0), 0)
  return { limit, offset }
}

/** Accepts an ISO date string (or null/''); returns a normalized ISO string or null. */
function normalizeUntil(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Trims a JSON string array, dropping blanks/overlong entries, deduped and capped. */
function cleanNames(value: unknown, maxLen: number, cap: number): string[] {
  if (!Array.isArray(value)) return []
  const names = new Set<string>()
  for (const raw of value) {
    const name = str(raw).trim()
    if (name.length >= 1 && name.length <= maxLen) names.add(name)
    if (names.size >= cap) break
  }
  return [...names]
}

// ------------------------------------------------------------- email codes

/**
 * Emailed one-time codes: short-lived, single-use, rate-limited. These three
 * constants are the whole abuse policy — a 6-digit code is brute-forceable, so
 * the attempt cap matters more than the code length.
 */
const CODE_TTL_MS = 15 * 60 * 1000
const CODE_COOLDOWN_MS = 60 * 1000
const CODE_MAX_ATTEMPTS = 5
const CODE_RE = /^\d{6}$/

/** Stored hashed so a database leak does not hand over live codes. */
const hashCode = (code: string): string =>
  new Bun.CryptoHasher('sha256').update(code).digest('hex')

/** 6 zero-padded digits from the CSPRNG, never `Math.random`. */
function newCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0')
}

type CodeResult = 'ok' | 'bad' | 'expired' | 'locked'

const codeError = (result: CodeResult): string =>
  result === 'expired' || result === 'locked' ? '验证码已失效，请重新获取' : '验证码错误或已过期'

/** Issues a fresh code, refusing a resend inside the cooldown (throws COOLDOWN). */
async function issueCode(userId: number, kind: EmailTokenKind): Promise<string> {
  const existing = await repo.findEmailToken(userId, kind)
  if (existing && Date.now() - Date.parse(existing.createdAt) < CODE_COOLDOWN_MS) {
    throw new Error('COOLDOWN')
  }
  const code = newCode()
  await repo.saveEmailToken({
    userId,
    kind,
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    createdAt: new Date().toISOString(),
  })
  return code
}

/** Checks a code, spending an attempt on a miss and burning it at the cap. */
async function consumeCode(userId: number, kind: EmailTokenKind, code: string): Promise<CodeResult> {
  const token = await repo.findEmailToken(userId, kind)
  if (!token) return 'bad'
  if (Date.parse(token.expiresAt) < Date.now()) {
    await repo.deleteEmailToken(userId, kind)
    return 'expired'
  }
  if (token.attempts >= CODE_MAX_ATTEMPTS) {
    await repo.deleteEmailToken(userId, kind)
    return 'locked'
  }
  if (hashCode(code) !== token.codeHash) {
    await repo.incrementEmailTokenAttempts(userId, kind)
    return 'bad'
  }
  await repo.deleteEmailToken(userId, kind)
  return 'ok'
}

const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) return c.json({ error: '请先登录' }, 401)
  await next()
}
const adminOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: '请先登录' }, 401)
  if (user.role !== 'admin') return c.json({ error: '需要管理员权限' }, 403)
  await next()
}

export const api = new Hono<AppEnv>()

// ---------------------------------------------------------------- auth

api.post('/auth/register', async (c) => {
  const b = await readJson(c)
  const username = str(b.username).trim()
  const displayName = str(b.displayName).trim() || username
  const password = str(b.password)

  if (!USERNAME_RE.test(username)) return fail(c, '用户名需为 2-32 位字母、数字、下划线或中文')
  if (password.length < 8) return fail(c, '密码至少 8 位')
  if (displayName.length > 32) return fail(c, '昵称最长 32 字')
  if (await repo.findUserByUsername(username)) return fail(c, '用户名已被占用', 409)

  // First account on a fresh install becomes the admin — the self-hosted
  // convention. Anyone who reaches a public registration form first wins, so
  // register before exposing the instance.
  const isFirstUser = (await repo.countUsers()) === 0
  const id = await repo.createUser({
    username,
    displayName,
    passwordHash: await Bun.password.hash(password),
    role: isFirstUser ? 'admin' : 'user',
    bio: '',
    avatarUrl: '',
    createdAt: new Date().toISOString(),
  })

  await startSession(c, id, 0)
  const user = await repo.findUserById(id)
  return c.json({ user: toSelfUser(user!) }, 201)
})

/** Cached hash so a login for a nonexistent user costs the same as a real verify. */
let dummyHash: string | undefined

api.post('/auth/login', async (c) => {
  const b = await readJson(c)
  const identifier = str(b.username).trim()
  const password = str(b.password)

  // One field takes a username or a confirmed email — an unverified email is
  // not a credential, so it never matches here.
  const user =
    (await repo.findUserByUsername(identifier)) ??
    (await repo.findVerifiedUserByEmail(identifier.toLowerCase()))
  // Always run a verify, even with no such user, so a missing account and a
  // wrong password cost the same wall-clock time.
  const hash = user?.passwordHash ?? (dummyHash ??= await Bun.password.hash('buntalk-nonexistent-user'))
  const ok = await Bun.password.verify(password, hash)
  if (!user || !ok) return fail(c, '用户名或密码错误', 401)
  if (user.banned) return fail(c, '该账号已被封禁', 403)

  await startSession(c, user.id, user.sessionVersion)
  return c.json({ user: toSelfUser(user) })
})

api.post('/auth/logout', async (c) => {
  await endSession(c)
  return c.json({ ok: true })
})

api.get('/auth/me', (c) => c.json({ user: currentUser(c) }))

/**
 * Starts a password reset. The response is identical whether or not the address
 * exists — account state must not leak. A code is only issued (and mailed) for
 * a verified address, and only when SMTP is configured; `mailConfigured` lets
 * the UI explain an install that cannot send mail at all.
 */
api.post('/auth/forgot-password', async (c) => {
  const b = await readJson(c)
  const email = str(b.email).trim().toLowerCase()
  if (!mailer.mailConfigured()) return c.json({ ok: true, mailConfigured: false })
  if (!EMAIL_RE.test(email)) return c.json({ ok: true, mailConfigured: true })

  const user = await repo.findVerifiedUserByEmail(email)
  if (user) {
    try {
      const code = await issueCode(user.id, 'reset')
      await mailer.sendMail({
        to: email,
        subject: 'buntalk 密码重置验证码',
        text: `你的密码重置验证码是 ${code}，${CODE_TTL_MS / 60000} 分钟内有效。`,
      })
    } catch (err) {
      // Cooldown or a send failure — stay generic, and never echo account state.
      console.error('[buntalk] reset mail failed:', err)
    }
  }
  return c.json({ ok: true, mailConfigured: true })
})

/** Finishes a reset with the mailed code. Fails identically for a missing account. */
api.post('/auth/reset-password', async (c) => {
  if (!mailer.mailConfigured()) return fail(c, '站点未配置邮件，无法重置密码')
  const b = await readJson(c)
  const email = str(b.email).trim().toLowerCase()
  const code = str(b.code).trim()
  const password = str(b.password)
  if (password.length < 8) return fail(c, '密码至少 8 位')

  const user = await repo.findVerifiedUserByEmail(email)
  if (!user) return fail(c, '验证码错误或已过期')
  if (!CODE_RE.test(code)) return fail(c, '请输入 6 位验证码')
  const result = await consumeCode(user.id, 'reset', code)
  if (result !== 'ok') return fail(c, codeError(result))

  // Also bumps the session version, so every cookie issued before this reset
  // stops verifying on its next request — including a stolen session.
  await repo.resetUserPassword(user.id, await Bun.password.hash(password))
  return c.json({ ok: true })
})

// ------------------------------------------------------------------- meta

/** Public server capabilities the UI keys off — booleans, never secrets. */
api.get('/meta', (c) =>
  c.json({ mailConfigured: mailer.mailConfigured(), requireEmail: emailBindingRequired() }),
)

// ------------------------------------------------------------ categories

api.get('/categories', async (c) => c.json(await repo.listCategories()))

api.get('/categories/:id/threads', async (c) => {
  const id = idOf(c)
  if (!id) return fail(c, '无效的分类 ID', 404)
  if (!(await repo.findCategory(id))) return fail(c, '分类不存在', 404)
  const { limit, offset } = paging(c)
  return c.json(await repo.listThreads(id, limit, offset))
})

// ---------------------------------------------------------------- threads

/** Public feed for the home page; `?q=` searches titles, `?tag=` filters by tag. */
api.get('/threads', async (c) => {
  const { limit, offset } = paging(c)
  const q = (c.req.query('q') ?? '').trim().slice(0, 100)
  const tag = Number(c.req.query('tag'))
  if (Number.isInteger(tag) && tag > 0) return c.json(await repo.listThreadsByTag(tag, limit, offset))
  return c.json(q ? await repo.searchThreads(q, limit, offset) : await repo.listAllThreads(limit, offset))
})

// ------------------------------------------------------------------ tags

api.get('/tags', async (c) => c.json(await repo.listTags()))

api.get('/threads/:id', async (c) => {
  const id = idOf(c)
  if (!id) return fail(c, '无效的主题 ID', 404)
  const thread = await repo.findThread(id)
  if (!thread) return fail(c, '主题不存在', 404)
  const posts = await repo.listPosts(id, currentUser(c)?.id ?? null)
  return c.json({ thread, posts })
})

/**
 * View beacon, fired once per page open. Kept out of the GET above so the
 * reload after a reply or delete does not inflate the counter. Public, so
 * anonymous visits count too.
 */
api.post('/threads/:id/view', async (c) => {
  const id = idOf(c)
  if (!id) return fail(c, '无效的主题 ID', 404)
  const thread = await repo.findThread(id)
  if (!thread) return fail(c, '主题不存在', 404)
  await repo.incrementThreadViews(id)
  return c.json({ viewCount: (thread.viewCount ?? 0) + 1 })
})

api.post('/threads', requireAuth, async (c) => {
  const user = c.get('user')!
  const b = await readJson(c)
  const categoryId = Number(b.categoryId)
  const title = str(b.title).trim()
  const content = str(b.body).trim()

  if (!Number.isInteger(categoryId) || categoryId <= 0) return fail(c, '请选择分类')
  if (title.length < 1 || title.length > 200) return fail(c, '标题长度需为 1-200 字')
  if (content.length < 1 || content.length > 20000) return fail(c, '正文不能为空，且不超过 20000 字')
  if (!(await repo.findCategory(categoryId))) return fail(c, '分类不存在', 404)

  // Keep only tags that actually exist, deduped and capped — the join table has
  // a composite PK, so a repeated id would otherwise blow up the insert.
  const wanted = Array.isArray(b.tagIds) ? b.tagIds : []
  const valid = new Set((await repo.listTags()).map((tag) => tag.id))
  const tagIds = [...new Set(wanted.map(Number).filter((n) => valid.has(n)))].slice(0, 10)

  const id = await repo.createThread({ categoryId, authorId: user.id, title, body: content, tagIds })
  return c.json({ id }, 201)
})

api.post('/threads/:id/posts', requireAuth, async (c) => {
  const user = c.get('user')!
  const threadId = idOf(c)
  if (!threadId) return fail(c, '无效的主题 ID', 404)

  const thread = await repo.findThread(threadId)
  if (!thread) return fail(c, '主题不存在', 404)
  if (thread.isLocked && user.role !== 'admin') return fail(c, '主题已锁定', 403)

  const b = await readJson(c)
  const parentId = Number(b.parentId)
  const content = str(b.body).trim()
  if (content.length < 1 || content.length > 20000) return fail(c, '回复不能为空，且不超过 20000 字')
  if (!Number.isInteger(parentId) || parentId <= 0) return fail(c, '缺少回复目标')

  const parent = await repo.findPost(parentId)
  if (!parent || parent.threadId !== threadId) return fail(c, '回复目标不存在', 404)

  const id = await repo.createPost({ threadId, authorId: user.id, parentId, body: content })
  return c.json({ id }, 201)
})

api.delete('/threads/:id', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = idOf(c)
  if (!id) return fail(c, '无效的主题 ID', 404)
  const thread = await repo.findThread(id)
  if (!thread) return fail(c, '主题不存在', 404)
  if (!canManage(user, thread.authorId)) return fail(c, '无权删除该主题', 403)
  await repo.deleteThread(id)
  return c.json({ ok: true })
})

// ----------------------------------------------------------------- posts

api.delete('/posts/:id', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = idOf(c)
  if (!id) return fail(c, '无效的帖子 ID', 404)
  const post = await repo.findPost(id)
  if (!post) return fail(c, '帖子不存在', 404)
  if (!canManage(user, post.authorId)) return fail(c, '无权删除该帖子', 403)
  try {
    await repo.deletePost(id)
  } catch (err) {
    if (err instanceof Error && err.message === 'OPENING_POST') {
      return fail(c, '首帖不能单独删除，请直接删除整个主题')
    }
    throw err
  }
  return c.json({ ok: true })
})

api.post('/posts/:id/like', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = idOf(c)
  if (!id) return fail(c, '无效的帖子 ID', 404)
  if (!(await repo.findPost(id))) return fail(c, '帖子不存在', 404)
  return c.json(await repo.toggleLike(id, user.id))
})

// -------------------------------------------------------------- reports

api.post('/reports', requireAuth, async (c) => {
  const user = c.get('user')!
  const b = await readJson(c)
  const targetType = str(b.targetType)
  const targetId = Number(b.targetId)
  const reason = str(b.reason).trim()

  if (targetType !== 'thread' && targetType !== 'post') return fail(c, '无效的举报对象')
  if (!Number.isInteger(targetId) || targetId <= 0) return fail(c, '无效的举报对象')
  if (reason.length < 1 || reason.length > 300) return fail(c, '请填写 1-300 字的举报理由')

  if (targetType === 'thread') {
    const thread = await repo.findThread(targetId)
    if (!thread) return fail(c, '主题不存在', 404)
    if (thread.authorId === user.id) return fail(c, '不能举报自己的内容')
  } else {
    const post = await repo.findPost(targetId)
    if (!post) return fail(c, '回复不存在', 404)
    if (post.authorId === user.id) return fail(c, '不能举报自己的内容')
  }

  const id = await repo.createReport({ reporterId: user.id, targetType, targetId, reason })
  return c.json({ id }, 201)
})

// --------------------------------------------------------------- uploads

const UNSUPPORTED_FILE = '仅支持 PNG、JPEG、GIF、WebP、AVIF 图片或 PDF'

api.post('/uploads', requireAuth, async (c) => {
  let form: Record<string, unknown>
  try {
    form = (await c.req.parseBody()) as Record<string, unknown>
  } catch {
    return fail(c, '无法解析上传内容')
  }

  const file = form.file
  if (!(file instanceof File)) return fail(c, '缺少 file 字段')
  if (file.size === 0) return fail(c, '文件为空')
  if (file.size > storage.maxUploadBytes) {
    const mb = Math.round(storage.maxUploadBytes / 1024 / 1024)
    return fail(c, `文件不能超过 ${mb} MB`, 413)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  // Type comes from the bytes, never from the request — a mislabelled file
  // served back under the client's claimed Content-Type would be an XSS hole.
  const kind = sniff(bytes)
  if (!kind) return fail(c, UNSUPPORTED_FILE)

  // Random key, server-chosen extension: the client's filename is never used in
  // a path, which removes traversal and extension-confusion in one stroke.
  const key = `${crypto.randomUUID()}.${kind.ext}`
  try {
    await storage.put(key, bytes, kind.mime)
  } catch (err) {
    console.error('[buntalk] upload failed:', err)
    return fail(c, '上传失败，请稍后重试', 500)
  }

  return c.json({ key, url: `/uploads/${key}`, mime: kind.mime, size: bytes.byteLength }, 201)
})

// ----------------------------------------------------------------- users

api.patch('/users/me', requireAuth, async (c) => {
  const user = c.get('user')!
  const b = await readJson(c)
  const displayName = str(b.displayName).trim()
  const bio = str(b.bio).trim()
  const avatarUrl = str(b.avatarUrl).trim()

  if (displayName.length < 1 || displayName.length > 32) return fail(c, '昵称长度需为 1-32 字')
  if (bio.length > 500) return fail(c, '简介最长 500 字')
  if (avatarUrl.length > 512) return fail(c, '头像地址过长')
  if (avatarUrl && !/^(https?:\/\/|\/)/.test(avatarUrl)) return fail(c, '头像需为 http(s) 或站内路径')

  await repo.updateUserProfile(user.id, { displayName, bio, avatarUrl })
  return c.json({ user: { ...user, displayName, bio, avatarUrl } })
})

/**
 * Binds (or replaces) the account's email. The address is stored immediately
 * and marked unverified — which is all an install without SMTP can offer. When
 * mail is configured we also mail a confirmation code, and the address only
 * counts for login/reset once that code is entered.
 */
api.post('/users/me/email', requireAuth, async (c) => {
  const user = c.get('user')!
  const b = await readJson(c)
  const email = str(b.email).trim().toLowerCase()
  const mailConfigured = mailer.mailConfigured()

  if (email.length > 254 || !EMAIL_RE.test(email)) return fail(c, '请输入有效的邮箱地址')

  // Already confirmed as-is — nothing to do, and nothing to send.
  if (email === user.email && user.emailVerified) {
    return c.json({ email, emailVerified: true, codeSent: false, mailConfigured })
  }
  // A confirmed address belongs to exactly one account; unverified ones may
  // coexist and are settled at verification time.
  const owner = await repo.findVerifiedUserByEmail(email)
  if (owner && owner.id !== user.id) return fail(c, '该邮箱已被其他账号绑定', 409)

  await repo.updateUserEmail(user.id, email, false)
  await repo.deleteEmailToken(user.id, 'verify')
  if (!mailConfigured) {
    return c.json({ email, emailVerified: false, codeSent: false, mailConfigured: false })
  }

  let code: string
  try {
    code = await issueCode(user.id, 'verify')
  } catch (err) {
    if (err instanceof Error && err.message === 'COOLDOWN') {
      return fail(c, '验证码发送过于频繁，请稍后再试', 429)
    }
    throw err
  }
  try {
    await mailer.sendMail({
      to: email,
      subject: 'buntalk 邮箱验证码',
      text: `你的邮箱验证码是 ${code}，${CODE_TTL_MS / 60000} 分钟内有效。`,
    })
  } catch (err) {
    console.error('[buntalk] verify mail failed:', err)
    await repo.deleteEmailToken(user.id, 'verify')
    return fail(c, '邮件发送失败，请稍后重试', 502)
  }
  return c.json({ email, emailVerified: false, codeSent: true, mailConfigured: true })
})

/** Confirms the bound email with the mailed code. */
api.post('/users/me/email/verify', requireAuth, async (c) => {
  const user = c.get('user')!
  if (!user.email) return fail(c, '请先填写邮箱')
  if (user.emailVerified) return c.json({ email: user.email, emailVerified: true })

  const b = await readJson(c)
  const code = str(b.code).trim()
  if (!CODE_RE.test(code)) return fail(c, '请输入 6 位验证码')

  // Re-checked here, not just at bind time: two accounts may hold the same
  // unverified address, and only the first to verify may keep it.
  const owner = await repo.findVerifiedUserByEmail(user.email)
  if (owner && owner.id !== user.id) return fail(c, '该邮箱已被其他账号绑定', 409)

  const result = await consumeCode(user.id, 'verify', code)
  if (result !== 'ok') return fail(c, codeError(result))

  await repo.updateUserEmail(user.id, user.email, true)
  return c.json({ email: user.email, emailVerified: true })
})

/** Unbinds the email and any pending codes. */
api.delete('/users/me/email', requireAuth, async (c) => {
  const user = c.get('user')!
  await repo.updateUserEmail(user.id, '', false)
  await repo.deleteEmailTokensForUser(user.id)
  return c.json({ email: '', emailVerified: false })
})

/**
 * Usernames are percent-encoded by the client and may already be decoded by the
 * router. They cannot contain '%', so decoding twice is harmless and covers
 * both cases — CJK names would otherwise 404 on a literal path match.
 */
function userFromPath(c: Context) {
  const raw = c.req.param('username') ?? ''
  let username = raw
  try {
    username = decodeURIComponent(username)
  } catch {
    // keep the raw segment
  }
  return repo.findUserByUsername(username)
}

api.get('/users/:username', async (c) => {
  const user = await userFromPath(c)
  if (!user) return fail(c, '用户不存在', 404)
  return c.json({ user: toPublicUser(user), ...(await repo.authorStats(user.id)) })
})

api.get('/users/:username/threads', async (c) => {
  const user = await userFromPath(c)
  if (!user) return fail(c, '用户不存在', 404)
  return c.json(await repo.listThreadsByAuthor(user.id, 50))
})

// ------------------------------------------------------------------ setup

/**
 * First-run initialization. Both endpoints are public yet self-locking: once an
 * account exists, `status` reports done and `POST` refuses. That is what lets
 * the wizard create the first admin with no auth — at setup time there is
 * nobody to authenticate as.
 */
api.get('/setup/status', async (c) => {
  const settings = await repo.getSettings()
  return c.json({ needsSetup: (await repo.countUsers()) === 0, ...settings })
})

api.post('/setup', async (c) => {
  // ponytail: check-then-write, same as /auth/register. Only a simultaneous
  // double-submit can race, and the loser simply finds a user and gets a 409.
  if ((await repo.countUsers()) > 0) return fail(c, '站点已完成初始化', 409)

  const b = await readJson(c)
  const siteName = str(b.siteName).trim() || repo.DEFAULT_SITE_NAME
  const siteDescription = str(b.siteDescription).trim()
  const username = str(b.username).trim()
  const displayName = str(b.displayName).trim() || username
  const password = str(b.password)
  const categories = cleanNames(b.categories, 50, 20)
  const tags = cleanNames(b.tags, 30, 30)

  if (siteName.length > 50) return fail(c, '站点名称最长 50 字')
  if (siteDescription.length > 200) return fail(c, '站点简介最长 200 字')
  if (!USERNAME_RE.test(username)) return fail(c, '用户名需为 2-32 位字母、数字、下划线或中文')
  if (password.length < 8) return fail(c, '密码至少 8 位')
  if (displayName.length > 32) return fail(c, '昵称最长 32 字')

  // User first: once an account exists the wizard closes, so a later failure
  // here leaves a usable admin who can finish from 管理后台 — rather than a
  // wizard that re-runs and duplicates the boards it already created.
  const id = await repo.createUser({
    username,
    displayName,
    passwordHash: await Bun.password.hash(password),
    role: 'admin',
    bio: '',
    avatarUrl: '',
    createdAt: new Date().toISOString(),
  })
  await startSession(c, id, 0)
  await repo.saveSettings({ siteName, siteDescription })
  for (const [index, name] of categories.entries()) {
    await repo.createCategory({ name, description: '', position: index, parentId: null })
  }
  for (const name of tags) await repo.createTag(name)

  const user = await repo.findUserById(id)
  return c.json({ user: toSelfUser(user!) }, 201)
})

// ----------------------------------------------------------------- admin

api.use('/admin/*', adminOnly)

api.get('/admin/users', async (c) => c.json(await repo.listUsers()))

api.patch('/admin/users/:id', async (c) => {
  const admin = c.get('user')!
  const id = idOf(c)
  if (!id) return fail(c, '无效的用户 ID', 404)
  const target = await repo.findUserById(id)
  if (!target) return fail(c, '用户不存在', 404)

  const b = await readJson(c)
  if (typeof b.banned === 'boolean') {
    if (b.banned && id === admin.id) return fail(c, '不能封禁自己')
    await repo.setUserBan(id, {
      banned: b.banned,
      reason: str(b.banReason).trim().slice(0, 200),
      until: normalizeUntil(b.bannedUntil),
    })
  }
  if (typeof b.role === 'string') {
    if (!ROLE_RE.test(b.role)) return fail(c, '角色只能是 user 或 admin')
    await repo.setUserRole(id, b.role as Role)
  }
  if (b.creditDelta != null) {
    const delta = Number(b.creditDelta)
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1000) {
      return fail(c, '无效的信用分调整')
    }
    await repo.applyCredit(id, Math.trunc(delta))
  }
  const user = await repo.findUserById(id)
  return c.json({ user: toPublicUser(user!) })
})

api.get('/admin/threads', async (c) => {
  const { limit, offset } = paging(c)
  return c.json(await repo.listAllThreads(limit, offset))
})

api.post('/admin/categories', async (c) => {
  const b = await readJson(c)
  const name = str(b.name).trim()
  const description = str(b.description).trim()
  const position = Number.isInteger(Number(b.position)) ? Number(b.position) : 0
  if (name.length < 1 || name.length > 50) return fail(c, '分类名长度需为 1-50 字')
  if (description.length > 500) return fail(c, '分类描述最长 500 字')

  const parentId = b.parentId == null || b.parentId === '' ? null : Number(b.parentId)
  if (parentId !== null) {
    const parent = await repo.findCategory(parentId)
    if (!parent) return fail(c, '父版块不存在', 404)
    // Single-level nesting: a sub-forum cannot itself have sub-forums.
    if (parent.parentId !== null) return fail(c, '子版块下不能再建子版块')
  }

  const id = await repo.createCategory({ name, description, position, parentId })
  return c.json({ id }, 201)
})

api.patch('/admin/categories/:id', async (c) => {
  const id = idOf(c)
  if (!id) return fail(c, '无效的分类 ID', 404)
  const current = await repo.findCategory(id)
  if (!current) return fail(c, '分类不存在', 404)

  const b = await readJson(c)
  const name = str(b.name).trim() || current.name
  const description = str(b.description).trim()
  const position = Number.isInteger(Number(b.position)) ? Number(b.position) : current.position
  if (name.length < 1 || name.length > 50) return fail(c, '分类名长度需为 1-50 字')
  if (description.length > 500) return fail(c, '分类描述最长 500 字')

  let parentId = current.parentId
  if ('parentId' in b) parentId = b.parentId == null || b.parentId === '' ? null : Number(b.parentId)
  if (parentId !== null) {
    if (parentId === id) return fail(c, '版块不能作为自己的父版块')
    const parent = await repo.findCategory(parentId)
    if (!parent) return fail(c, '父版块不存在', 404)
    if (parent.parentId !== null) return fail(c, '子版块下不能再建子版块')
    // 有子版块的版块不能变成别人的子版块（保持单层结构）
    if (await repo.countSubCategories(id)) return fail(c, '该版块下有子版块，不能移动到其他版块下')
  }

  await repo.updateCategory(id, { name, description, position, parentId })
  return c.json({ ok: true })
})

api.delete('/admin/categories/:id', async (c) => {
  const id = idOf(c)
  if (!id) return fail(c, '无效的分类 ID', 404)
  if (!(await repo.findCategory(id))) return fail(c, '分类不存在', 404)
  await repo.deleteCategory(id)
  return c.json({ ok: true })
})

api.patch('/admin/threads/:id', async (c) => {
  const id = idOf(c)
  if (!id) return fail(c, '无效的主题 ID', 404)
  const thread = await repo.findThread(id)
  if (!thread) return fail(c, '主题不存在', 404)

  const b = await readJson(c)
  if (typeof b.isPinned === 'boolean') await repo.setThreadFlag(id, 'isPinned', b.isPinned)
  if (typeof b.isLocked === 'boolean') await repo.setThreadFlag(id, 'isLocked', b.isLocked)
  if (typeof b.isGlobalPinned === 'boolean') {
    // Site-wide announcements are capped; unpinning is always allowed.
    if (
      b.isGlobalPinned &&
      !thread.isGlobalPinned &&
      (await repo.countGlobalPinned()) >= repo.GLOBAL_PIN_LIMIT
    ) {
      return fail(c, `全站置顶最多 ${repo.GLOBAL_PIN_LIMIT} 条`)
    }
    await repo.setThreadFlag(id, 'isGlobalPinned', b.isGlobalPinned)
  }
  if (typeof b.isAllBoardsPinned === 'boolean') {
    await repo.setThreadFlag(id, 'isAllBoardsPinned', b.isAllBoardsPinned)
  }
  return c.json({ ok: true })
})

// ------------------------------------------------------------------- tags

api.post('/admin/tags', async (c) => {
  const b = await readJson(c)
  const name = str(b.name).trim()
  if (name.length < 1 || name.length > 30) return fail(c, '标签名长度需为 1-30 字')
  if ((await repo.listTags()).some((tag) => tag.name === name)) return fail(c, '标签已存在', 409)
  return c.json({ id: await repo.createTag(name) }, 201)
})

api.delete('/admin/tags/:id', async (c) => {
  const id = idOf(c)
  if (!id) return fail(c, '无效的标签 ID', 404)
  if (!(await repo.findTag(id))) return fail(c, '标签不存在', 404)
  await repo.deleteTag(id)
  return c.json({ ok: true })
})

// --------------------------------------------------------------- reports

api.get('/admin/reports', async (c) => {
  const raw = c.req.query('status')
  const status = raw === 'open' || raw === 'accepted' || raw === 'rejected' ? raw : undefined
  return c.json(await repo.listReports(status))
})

api.post('/admin/reports/:id/resolve', async (c) => {
  const admin = c.get('user')!
  const id = idOf(c)
  if (!id) return fail(c, '无效的举报 ID', 404)
  const report = await repo.findReport(id)
  if (!report) return fail(c, '举报不存在', 404)
  if (report.status !== 'open') return fail(c, '该举报已处理', 409)

  const b = await readJson(c)
  const action = str(b.action)
  if (action !== 'accept' && action !== 'reject') return fail(c, '无效的处理动作')

  // Resolving carries the credit consequence; `ban` is an optional follow-up.
  const authorId = await repo.resolveReport(report, action === 'accept', admin.id)
  if (action === 'accept' && b.ban === true && authorId && authorId !== admin.id) {
    await repo.setUserBan(authorId, {
      banned: true,
      reason: str(b.banReason).trim().slice(0, 200) || '举报成立',
      until: normalizeUntil(b.bannedUntil),
    })
  }
  return c.json({ ok: true })
})

// ------------------------------------------------------------------- mail

api.get('/admin/mail', (c) => {
  const cfg = mailer.mailConfig()
  return c.json({ configured: cfg !== null, from: cfg?.from ?? '' })
})

/** Verifies the SMTP settings by sending one message to a given address. */
api.post('/admin/mail-test', async (c) => {
  const b = await readJson(c)
  const to = str(b.to).trim()
  if (!EMAIL_RE.test(to)) return fail(c, '请输入有效的邮箱地址')
  if (!mailer.mailConfigured()) return fail(c, '未配置 SMTP，请设置 SMTP_HOST 等环境变量')
  try {
    await mailer.sendMail({
      to,
      subject: 'buntalk 测试邮件',
      text: '这是一封来自 buntalk 的测试邮件。收到它说明 SMTP 配置可用。',
    })
  } catch (err) {
    console.error('[buntalk] mail test failed:', err)
    return fail(c, '发送失败，请检查 SMTP 配置', 502)
  }
  return c.json({ ok: true })
})
