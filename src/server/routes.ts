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
import { toPublicUser } from '../shared/types'
import type { Role } from '../shared/types'
import { canManage, currentUser, endSession, startSession } from './auth'
import type { AppEnv } from './auth'
import { sniff } from './filetype'
import * as storage from './storage'

const USERNAME_RE = /^[\p{L}\p{N}_]{2,32}$/u
const ROLE_RE = /^(user|admin)$/

type ErrStatus = 400 | 401 | 403 | 404 | 409 | 413 | 500
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

  await startSession(c, id)
  const user = await repo.findUserById(id)
  return c.json({ user: toPublicUser(user!) }, 201)
})

/** Cached hash so a login for a nonexistent user costs the same as a real verify. */
let dummyHash: string | undefined

api.post('/auth/login', async (c) => {
  const b = await readJson(c)
  const username = str(b.username).trim()
  const password = str(b.password)

  const user = await repo.findUserByUsername(username)
  // Always run a verify, even with no such user, so a missing account and a
  // wrong password cost the same wall-clock time.
  const hash = user?.passwordHash ?? (dummyHash ??= await Bun.password.hash('bunbolt-nonexistent-user'))
  const ok = await Bun.password.verify(password, hash)
  if (!user || !ok) return fail(c, '用户名或密码错误', 401)
  if (user.banned) return fail(c, '该账号已被封禁', 403)

  await startSession(c, user.id)
  return c.json({ user: toPublicUser(user) })
})

api.post('/auth/logout', async (c) => {
  await endSession(c)
  return c.json({ ok: true })
})

api.get('/auth/me', (c) => c.json({ user: currentUser(c) }))

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

api.get('/threads/:id', async (c) => {
  const id = idOf(c)
  if (!id) return fail(c, '无效的主题 ID', 404)
  const thread = await repo.findThread(id)
  if (!thread) return fail(c, '主题不存在', 404)
  const posts = await repo.listPosts(id, currentUser(c)?.id ?? null)
  return c.json({ thread, posts })
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

  const id = await repo.createThread({ categoryId, authorId: user.id, title, body: content })
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
    console.error('[bunbolt] upload failed:', err)
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

// ----------------------------------------------------------------- admin

api.use('/admin/*', adminOnly)

api.get('/admin/users', async (c) => c.json(await repo.listUsers()))

api.patch('/admin/users/:id', async (c) => {
  const id = idOf(c)
  if (!id) return fail(c, '无效的用户 ID', 404)
  const target = await repo.findUserById(id)
  if (!target) return fail(c, '用户不存在', 404)

  const b = await readJson(c)
  if (typeof b.banned === 'boolean') {
    await repo.setUserBanned(id, b.banned)
  }
  if (typeof b.role === 'string') {
    if (!ROLE_RE.test(b.role)) return fail(c, '角色只能是 user 或 admin')
    await repo.setUserRole(id, b.role as Role)
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
  const id = await repo.createCategory({ name, description, position })
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

  await repo.updateCategory(id, { name, description, position })
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
  if (!(await repo.findThread(id))) return fail(c, '主题不存在', 404)

  const b = await readJson(c)
  if (typeof b.isPinned === 'boolean') await repo.setThreadFlag(id, 'isPinned', b.isPinned)
  if (typeof b.isLocked === 'boolean') await repo.setThreadFlag(id, 'isLocked', b.isLocked)
  return c.json({ ok: true })
})
