/**
 * Every query the forum runs, written once and used on all three engines.
 *
 * Two cross-dialect rules are baked in here rather than left to callers:
 *   * inserts that need their new id go through `insertReturningId` — MySQL has
 *     no `RETURNING`, so it uses Drizzle's `$returningId()` instead;
 *   * aggregate counts are collected with `groupCounts` because PG returns
 *     `count()` as a *string* bigint while SQLite/MySQL return numbers.
 *
 * `db`/`tables` are `any` (see `./index.ts`), so a mistyped column surfaces as
 * a runtime SQL error rather than a compile error — the domain types in
 * `types.ts` are what keeps callers honest.
 */
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { db, dialect, tables as t } from './index'
import { toPublicUser } from '../shared/types'
import type {
  CategoryRow,
  PostRow,
  PublicUser,
  Role,
  ThreadRow,
  UserAuthRow,
} from '../shared/types'

const nowISO = () => new Date().toISOString()

/** Single insert returning its generated id, on every dialect. */
async function insertReturningId(table: any, values: any): Promise<number> {
  const q = db.insert(table).values(values)
  const rows: any[] = dialect === 'mysql' ? await q.$returningId() : await q.returning({ id: table.id })
  return Number(rows[0]?.id)
}

/** COUNT(*) grouped by a key column, optionally restricted to `ids`. */
async function groupCounts(table: any, keyColumn: any, ids?: number[]): Promise<Map<number, number>> {
  const query = db.select({ k: keyColumn, n: count() }).from(table)
  const rows: any[] = await (ids ? query.where(inArray(keyColumn, ids)) : query).groupBy(keyColumn)
  return new Map(rows.map((r: any) => [Number(r.k), Number(r.n)]))
}

async function countWhere(table: any, column: any, value: number): Promise<number> {
  const rows: any[] = await db.select({ n: count() }).from(table).where(eq(column, value))
  return Number(rows[0]?.n ?? 0)
}

// ---------------------------------------------------------------- users

export async function findUserById(id: number): Promise<UserAuthRow | null> {
  const rows: any[] = await db.select().from(t.users).where(eq(t.users.id, id)).limit(1)
  return (rows[0] as UserAuthRow) ?? null
}

export async function findUserByUsername(username: string): Promise<UserAuthRow | null> {
  const rows: any[] = await db.select().from(t.users).where(eq(t.users.username, username)).limit(1)
  return (rows[0] as UserAuthRow) ?? null
}

export async function countUsers(): Promise<number> {
  const rows: any[] = await db.select({ n: count() }).from(t.users)
  return Number(rows[0]?.n ?? 0)
}

export async function createUser(input: {
  username: string
  displayName: string
  passwordHash: string
  role: Role
  bio: string
  avatarUrl: string
  createdAt: string
}): Promise<number> {
  return insertReturningId(t.users, { ...input, banned: false })
}

export async function updateUserProfile(
  id: number,
  patch: { displayName: string; bio: string; avatarUrl: string },
): Promise<void> {
  await db.update(t.users).set(patch).where(eq(t.users.id, id))
}

export async function setUserRole(id: number, role: Role): Promise<void> {
  await db.update(t.users).set({ role }).where(eq(t.users.id, id))
}

export async function setUserBanned(id: number, banned: boolean): Promise<void> {
  await db.update(t.users).set({ banned }).where(eq(t.users.id, id))
}

export async function listUsers(): Promise<(PublicUser & { postCount: number })[]> {
  const rows: any[] = await db.select().from(t.users).orderBy(asc(t.users.id))
  const counts = await groupCounts(t.posts, t.posts.authorId)
  // toPublicUser strips password_hash: Drizzle selected it even though we do
  // not want it reaching any response body.
  return rows.map((r: any) => ({ ...toPublicUser(r), postCount: counts.get(Number(r.id)) ?? 0 }))
}

// ----------------------------------------------------------- categories

export async function listCategories(): Promise<CategoryRow[]> {
  const rows: any[] = await db
    .select()
    .from(t.categories)
    .orderBy(asc(t.categories.position), asc(t.categories.id))
  const counts = await groupCounts(t.threads, t.threads.categoryId)
  return rows.map((r: any) => ({ ...(r as CategoryRow), threadCount: counts.get(Number(r.id)) ?? 0 }))
}

export async function findCategory(id: number): Promise<CategoryRow | null> {
  const rows: any[] = await db.select().from(t.categories).where(eq(t.categories.id, id)).limit(1)
  return (rows[0] as CategoryRow) ?? null
}

export async function createCategory(input: {
  name: string
  description: string
  position: number
}): Promise<number> {
  return insertReturningId(t.categories, input)
}

export async function updateCategory(
  id: number,
  patch: { name: string; description: string; position: number },
): Promise<void> {
  await db.update(t.categories).set(patch).where(eq(t.categories.id, id))
}

export async function deleteCategory(id: number): Promise<void> {
  // threads.category_id cascades in the DDL, and threads cascade to posts.
  await db.delete(t.categories).where(eq(t.categories.id, id))
}

// -------------------------------------------------------------- threads

const threadWithAuthor = {
  id: t.threads.id,
  categoryId: t.threads.categoryId,
  authorId: t.threads.authorId,
  title: t.threads.title,
  isPinned: t.threads.isPinned,
  isLocked: t.threads.isLocked,
  createdAt: t.threads.createdAt,
  lastPostAt: t.threads.lastPostAt,
  authorUsername: t.users.username,
  authorDisplayName: t.users.displayName,
  authorAvatarUrl: t.users.avatarUrl,
}

function hydrateThread(r: any, postCount: number): ThreadRow {
  return {
    id: r.id,
    categoryId: r.categoryId,
    authorId: r.authorId,
    title: r.title,
    isPinned: r.isPinned,
    isLocked: r.isLocked,
    createdAt: r.createdAt,
    lastPostAt: r.lastPostAt,
    author: {
      id: r.authorId,
      username: r.authorUsername ?? '',
      displayName: r.authorDisplayName ?? '',
      avatarUrl: r.authorAvatarUrl ?? '',
    },
    postCount,
  }
}

export async function listThreads(
  categoryId: number,
  limit: number,
  offset: number,
): Promise<ThreadRow[]> {
  const rows: any[] = await db
    .select(threadWithAuthor)
    .from(t.threads)
    .leftJoin(t.users, eq(t.threads.authorId, t.users.id))
    .where(eq(t.threads.categoryId, categoryId))
    .orderBy(desc(t.threads.isPinned), desc(t.threads.lastPostAt))
    .limit(limit)
    .offset(offset)
  const counts = await groupCounts(t.posts, t.posts.threadId, rows.map((r: any) => Number(r.id)))
  return rows.map((r: any) => hydrateThread(r, counts.get(Number(r.id)) ?? 0))
}

export async function findThread(id: number): Promise<ThreadRow | null> {
  const rows: any[] = await db
    .select(threadWithAuthor)
    .from(t.threads)
    .leftJoin(t.users, eq(t.threads.authorId, t.users.id))
    .where(eq(t.threads.id, id))
    .limit(1)
  if (!rows[0]) return null
  return hydrateThread(rows[0], await countWhere(t.posts, t.posts.threadId, id))
}

export async function listAllThreads(limit: number, offset: number): Promise<ThreadRow[]> {
  const rows: any[] = await db
    .select(threadWithAuthor)
    .from(t.threads)
    .leftJoin(t.users, eq(t.threads.authorId, t.users.id))
    .orderBy(desc(t.threads.lastPostAt))
    .limit(limit)
    .offset(offset)
  const counts = await groupCounts(t.posts, t.posts.threadId, rows.map((r: any) => Number(r.id)))
  return rows.map((r: any) => hydrateThread(r, counts.get(Number(r.id)) ?? 0))
}

/** Powers the profile page. Public — no offset, profiles are rarely prolific. */
export async function listThreadsByAuthor(authorId: number, limit: number): Promise<ThreadRow[]> {
  const rows: any[] = await db
    .select(threadWithAuthor)
    .from(t.threads)
    .leftJoin(t.users, eq(t.threads.authorId, t.users.id))
    .where(eq(t.threads.authorId, authorId))
    .orderBy(desc(t.threads.lastPostAt))
    .limit(limit)
  const counts = await groupCounts(t.posts, t.posts.threadId, rows.map((r: any) => Number(r.id)))
  return rows.map((r: any) => hydrateThread(r, counts.get(Number(r.id)) ?? 0))
}

/** Creates the thread and its opening post as one unit of content. */
export async function createThread(input: {
  categoryId: number
  authorId: number
  title: string
  body: string
}): Promise<number> {
  const now = nowISO()
  const threadId = await insertReturningId(t.threads, {
    categoryId: input.categoryId,
    authorId: input.authorId,
    title: input.title,
    isPinned: false,
    isLocked: false,
    createdAt: now,
    lastPostAt: now,
  })
  await insertReturningId(t.posts, {
    threadId,
    authorId: input.authorId,
    parentId: null,
    body: input.body,
    createdAt: now,
  })
  return threadId
}

export async function setThreadFlag(
  id: number,
  flag: 'isPinned' | 'isLocked',
  value: boolean,
): Promise<void> {
  await db.update(t.threads).set({ [flag]: value }).where(eq(t.threads.id, id))
}

export async function deleteThread(id: number): Promise<void> {
  await db.delete(t.threads).where(eq(t.threads.id, id))
}

// ---------------------------------------------------------------- posts

const postWithAuthor = {
  id: t.posts.id,
  threadId: t.posts.threadId,
  authorId: t.posts.authorId,
  parentId: t.posts.parentId,
  body: t.posts.body,
  createdAt: t.posts.createdAt,
  authorUsername: t.users.username,
  authorDisplayName: t.users.displayName,
  authorAvatarUrl: t.users.avatarUrl,
  authorRole: t.users.role,
}

function hydratePost(r: any, likeCount: number, liked: boolean): PostRow {
  return {
    id: r.id,
    threadId: r.threadId,
    authorId: r.authorId,
    parentId: r.parentId,
    body: r.body,
    createdAt: r.createdAt,
    author: {
      id: r.authorId,
      username: r.authorUsername ?? '',
      displayName: r.authorDisplayName ?? '',
      avatarUrl: r.authorAvatarUrl ?? '',
      role: r.authorRole ?? 'user',
    },
    likeCount,
    likedByMe: liked,
  }
}

async function likedPostIds(ids: number[], viewerId: number | null): Promise<Set<number>> {
  if (!viewerId || !ids.length) return new Set()
  const rows: any[] = await db
    .select({ postId: t.postLikes.postId })
    .from(t.postLikes)
    .where(and(inArray(t.postLikes.postId, ids), eq(t.postLikes.userId, viewerId)))
  return new Set(rows.map((r: any) => Number(r.postId)))
}

export async function listPosts(threadId: number, viewerId: number | null): Promise<PostRow[]> {
  const rows: any[] = await db
    .select(postWithAuthor)
    .from(t.posts)
    .leftJoin(t.users, eq(t.posts.authorId, t.users.id))
    .where(eq(t.posts.threadId, threadId))
    .orderBy(asc(t.posts.createdAt), asc(t.posts.id))

  const ids = rows.map((r: any) => Number(r.id))
  const likes = await groupCounts(t.postLikes, t.postLikes.postId, ids)
  const liked = await likedPostIds(ids, viewerId)
  return rows.map((r: any) => hydratePost(r, likes.get(Number(r.id)) ?? 0, liked.has(Number(r.id))))
}

export async function findPost(id: number): Promise<PostRow | null> {
  const rows: any[] = await db.select().from(t.posts).where(eq(t.posts.id, id)).limit(1)
  return (rows[0] as PostRow) ?? null
}

/**
 * ponytail: insert + `lastPostAt` bump are two statements, not a transaction —
 * Drizzle's transaction API is sync on SQLite and async on PG/MySQL, so sharing
 * one costs a dialect branch in every writer. The failure mode is a stale sort
 * key that the next post repairs, never lost content, which is why this is here
 * rather than in a transaction. Add one if post ordering ever needs to be exact.
 */
export async function createPost(input: {
  threadId: number
  authorId: number
  parentId: number
  body: string
}): Promise<number> {
  const now = nowISO()
  const id = await insertReturningId(t.posts, { ...input, createdAt: now })
  await db.update(t.threads).set({ lastPostAt: now }).where(eq(t.threads.id, input.threadId))
  return id
}

/**
 * Deletes a post, cascading to its replies via the DDL. The opening post
 * (parentId === null) is protected: removing it would leave a thread with no
 * content, so the whole thread must be deleted instead.
 */
export async function deletePost(id: number): Promise<void> {
  const post = await findPost(id)
  if (!post) return
  if (post.parentId === null) throw new Error('OPENING_POST')
  await db.delete(t.posts).where(eq(t.posts.id, id))
}

/**
 * ponytail: check-then-write, not `ON CONFLICT DO NOTHING` — Drizzle spells
 * that differently on all three engines (onConflictDoNothing / onIgnore). The
 * race window can produce a duplicate like row only if the same user double
 * clicks inside the same millisecond; the PK rejects it loudly instead of
 * corrupting the count.
 */
export async function toggleLike(
  postId: number,
  userId: number,
): Promise<{ liked: boolean; likeCount: number }> {
  const existing: any[] = await db
    .select({ postId: t.postLikes.postId })
    .from(t.postLikes)
    .where(and(eq(t.postLikes.postId, postId), eq(t.postLikes.userId, userId)))
    .limit(1)

  if (existing.length) {
    await db
      .delete(t.postLikes)
      .where(and(eq(t.postLikes.postId, postId), eq(t.postLikes.userId, userId)))
  } else {
    await db.insert(t.postLikes).values({ postId, userId })
  }

  return {
    liked: !existing.length,
    likeCount: await countWhere(t.postLikes, t.postLikes.postId, postId),
  }
}

// --------------------------------------------------------------- counts

export async function authorStats(userId: number): Promise<{ threadCount: number; postCount: number }> {
  return {
    threadCount: await countWhere(t.threads, t.threads.authorId, userId),
    postCount: await countWhere(t.posts, t.posts.authorId, userId),
  }
}
