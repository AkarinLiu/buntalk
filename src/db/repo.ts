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
import { and, asc, count, desc, eq, inArray, like, sql } from 'drizzle-orm'
import { db, dialect, tables as t } from './index'
import { toPublicUser } from '../shared/types'
import type {
  AdminUser,
  CategoryRow,
  EmailTokenKind,
  EmailTokenRow,
  PostRow,
  ReportRow,
  ReportStatus,
  ReportTarget,
  ReportUser,
  Role,
  SettingsRow,
  TagRow,
  ThreadRow,
  UserAuthRow,
} from '../shared/types'

/** Shown until the setup wizard (or an admin) writes a real name. */
export const DEFAULT_SITE_NAME = 'buntalk'

const nowISO = () => new Date().toISOString()

/** At most this many threads may be globally pinned at once. */
export const GLOBAL_PIN_LIMIT = 3
/** New accounts start here; an accepted report costs the author 20. */
export const CREDIT_START = 100
/** Dropping below this auto-bans the account. */
export const CREDIT_BAN_THRESHOLD = 60
export const CREDIT_REPORT_PENALTY = 20
export const CREDIT_FALSE_REPORT_PENALTY = 5

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

/** Any account holding this email, verified or not (uniqueness checks). */
export async function findUserByEmail(email: string): Promise<UserAuthRow | null> {
  const rows: any[] = await db.select().from(t.users).where(eq(t.users.email, email)).limit(1)
  return (rows[0] as UserAuthRow) ?? null
}

/**
 * A confirmed email, for login and password reset. Unverified addresses are
 * excluded so a half-bound (or squatted) email can never authenticate.
 */
export async function findVerifiedUserByEmail(email: string): Promise<UserAuthRow | null> {
  const rows: any[] = await db
    .select()
    .from(t.users)
    .where(and(eq(t.users.email, email), eq(t.users.emailVerified, true)))
    .limit(1)
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
  return insertReturningId(t.users, {
    ...input,
    banned: false,
    credit: CREDIT_START,
    banReason: '',
    bannedUntil: null,
    // Accounts start unbound; binding is a post-login action.
    email: '',
    emailVerified: false,
    sessionVersion: 0,
  })
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

export async function updateUserEmail(id: number, email: string, verified: boolean): Promise<void> {
  await db.update(t.users).set({ email, emailVerified: verified }).where(eq(t.users.id, id))
}

/**
 * Sets a new password and bumps the session version in one statement, so every
 * cookie issued before the reset stops verifying — a stolen session included.
 */
export async function resetUserPassword(id: number, passwordHash: string): Promise<void> {
  await db
    .update(t.users)
    .set({ passwordHash, sessionVersion: sql`${t.users.sessionVersion} + 1` })
    .where(eq(t.users.id, id))
}

/** Sets or clears a ban. `until: null` means permanent. */
export async function setUserBan(
  id: number,
  ban: { banned: boolean; reason: string; until: string | null },
): Promise<void> {
  await db
    .update(t.users)
    .set(
      ban.banned
        ? { banned: true, banReason: ban.reason, bannedUntil: ban.until }
        : { banned: false, banReason: '', bannedUntil: null },
    )
    .where(eq(t.users.id, id))
}

/** Lifts a temporary ban whose time has passed. Returns whether it applied. */
export async function clearExpiredBan(user: UserAuthRow): Promise<boolean> {
  if (!user.banned || !user.bannedUntil) return false
  if (Date.parse(user.bannedUntil) > Date.now()) return false
  await db
    .update(t.users)
    .set({ banned: false, banReason: '', bannedUntil: null })
    .where(eq(t.users.id, user.id))
  return true
}

/**
 * Adds `delta` to a user's credit, auto-banning them if it falls below the
 * threshold. Returns the new balance and whether they are now banned.
 */
export async function applyCredit(
  id: number,
  delta: number,
): Promise<{ credit: number; banned: boolean }> {
  const user = await findUserById(id)
  if (!user) return { credit: 0, banned: false }
  const credit = user.credit + delta
  await db.update(t.users).set({ credit }).where(eq(t.users.id, id))
  if (credit < CREDIT_BAN_THRESHOLD && !user.banned) {
    await setUserBan(id, { banned: true, reason: `信用分低于 ${CREDIT_BAN_THRESHOLD}`, until: null })
    return { credit, banned: true }
  }
  return { credit, banned: user.banned }
}

export async function listUsers(): Promise<AdminUser[]> {
  const rows: any[] = await db.select().from(t.users).orderBy(asc(t.users.id))
  const counts = await groupCounts(t.posts, t.posts.authorId)
  // toPublicUser strips password_hash: Drizzle selected it even though we do
  // not want it reaching any response body. Ban internals are added back only
  // in this admin-only projection.
  return rows.map((r: any) => ({
    ...toPublicUser(r),
    banned: Boolean(r.banned),
    postCount: counts.get(Number(r.id)) ?? 0,
    banReason: r.banReason ?? '',
    bannedUntil: r.bannedUntil ?? null,
  }))
}

// ----------------------------------------------------------- categories

export async function listCategories(): Promise<CategoryRow[]> {
  const rows: any[] = await db
    .select()
    .from(t.categories)
    .orderBy(asc(t.categories.position), asc(t.categories.id))
  const counts = await groupCounts(t.threads, t.threads.categoryId)
  const childCounts = await groupCounts(t.categories, t.categories.parentId)
  return rows.map((r: any) => ({
    ...(r as CategoryRow),
    parentId: r.parentId ?? null,
    threadCount: counts.get(Number(r.id)) ?? 0,
    childCount: childCounts.get(Number(r.id)) ?? 0,
  }))
}

export async function findCategory(id: number): Promise<CategoryRow | null> {
  const rows: any[] = await db.select().from(t.categories).where(eq(t.categories.id, id)).limit(1)
  if (!rows[0]) return null
  return { ...(rows[0] as CategoryRow), parentId: rows[0].parentId ?? null }
}

export async function createCategory(input: {
  name: string
  description: string
  position: number
  parentId: number | null
}): Promise<number> {
  return insertReturningId(t.categories, input)
}

export async function updateCategory(
  id: number,
  patch: { name: string; description: string; position: number; parentId: number | null },
): Promise<void> {
  await db.update(t.categories).set(patch).where(eq(t.categories.id, id))
}

export async function deleteCategory(id: number): Promise<void> {
  // threads.category_id cascades in the DDL, and threads cascade to posts.
  await db.delete(t.categories).where(eq(t.categories.id, id))
}

/** Direct sub-forums of a category — used to keep sub-forums to one level. */
export async function countSubCategories(id: number): Promise<number> {
  return countWhere(t.categories, t.categories.parentId, id)
}

// ------------------------------------------------------------------ tags

export async function listTags(): Promise<TagRow[]> {
  const rows: any[] = await db.select().from(t.tags).orderBy(asc(t.tags.name))
  const counts = await groupCounts(t.threadTags, t.threadTags.tagId)
  return rows.map((r: any) => ({
    id: Number(r.id),
    name: r.name,
    threadCount: counts.get(Number(r.id)) ?? 0,
  }))
}

export async function findTag(id: number): Promise<TagRow | null> {
  const rows: any[] = await db.select().from(t.tags).where(eq(t.tags.id, id)).limit(1)
  return rows[0] ? { id: Number(rows[0].id), name: rows[0].name } : null
}

export async function createTag(name: string): Promise<number> {
  return insertReturningId(t.tags, { name })
}

export async function deleteTag(id: number): Promise<void> {
  await db.delete(t.tags).where(eq(t.tags.id, id))
}

// ------------------------------------------------------------- settings

/** Site settings, defaulted until the single row has been written once. */
export async function getSettings(): Promise<SettingsRow> {
  const rows: any[] = await db.select().from(t.settings).where(eq(t.settings.id, 1)).limit(1)
  return {
    siteName: rows[0]?.siteName || DEFAULT_SITE_NAME,
    siteDescription: rows[0]?.siteDescription ?? '',
  }
}

/** Writes the single settings row, creating it on first use. */
export async function saveSettings(input: SettingsRow): Promise<void> {
  const rows: any[] = await db
    .select({ id: t.settings.id })
    .from(t.settings)
    .where(eq(t.settings.id, 1))
    .limit(1)
  if (rows.length) await db.update(t.settings).set(input).where(eq(t.settings.id, 1))
  else await db.insert(t.settings).values({ id: 1, ...input })
}

// --------------------------------------------------------- email tokens

/** One active code per (user, kind); issuing a new one replaces the old row. */
export async function saveEmailToken(input: {
  userId: number
  kind: EmailTokenKind
  codeHash: string
  expiresAt: string
  createdAt: string
}): Promise<void> {
  await db
    .delete(t.emailTokens)
    .where(and(eq(t.emailTokens.userId, input.userId), eq(t.emailTokens.kind, input.kind)))
  await db.insert(t.emailTokens).values({ ...input, attempts: 0 })
}

export async function findEmailToken(
  userId: number,
  kind: EmailTokenKind,
): Promise<EmailTokenRow | null> {
  const rows: any[] = await db
    .select()
    .from(t.emailTokens)
    .where(and(eq(t.emailTokens.userId, userId), eq(t.emailTokens.kind, kind)))
    .limit(1)
  return (rows[0] as EmailTokenRow) ?? null
}

/** Bumps a failed-attempt counter; the route invalidates the code at the cap. */
export async function incrementEmailTokenAttempts(
  userId: number,
  kind: EmailTokenKind,
): Promise<void> {
  await db
    .update(t.emailTokens)
    .set({ attempts: sql`${t.emailTokens.attempts} + 1` })
    .where(and(eq(t.emailTokens.userId, userId), eq(t.emailTokens.kind, kind)))
}

export async function deleteEmailToken(userId: number, kind: EmailTokenKind): Promise<void> {
  await db
    .delete(t.emailTokens)
    .where(and(eq(t.emailTokens.userId, userId), eq(t.emailTokens.kind, kind)))
}

export async function deleteEmailTokensForUser(userId: number): Promise<void> {
  await db.delete(t.emailTokens).where(eq(t.emailTokens.userId, userId))
}

// -------------------------------------------------------------- threads

const threadWithAuthor = {
  id: t.threads.id,
  categoryId: t.threads.categoryId,
  authorId: t.threads.authorId,
  title: t.threads.title,
  isPinned: t.threads.isPinned,
  isGlobalPinned: t.threads.isGlobalPinned,
  isAllBoardsPinned: t.threads.isAllBoardsPinned,
  isLocked: t.threads.isLocked,
  createdAt: t.threads.createdAt,
  lastPostAt: t.threads.lastPostAt,
  viewCount: t.threads.viewCount,
  authorUsername: t.users.username,
  authorDisplayName: t.users.displayName,
  authorAvatarUrl: t.users.avatarUrl,
}

function hydrateThread(r: any, postCount: number, tags: TagRow[]): ThreadRow {
  return {
    id: r.id,
    categoryId: r.categoryId,
    authorId: r.authorId,
    title: r.title,
    isPinned: r.isPinned,
    isGlobalPinned: r.isGlobalPinned,
    isAllBoardsPinned: r.isAllBoardsPinned,
    isLocked: r.isLocked,
    createdAt: r.createdAt,
    lastPostAt: r.lastPostAt,
    viewCount: Number(r.viewCount ?? 0),
    author: {
      id: r.authorId,
      username: r.authorUsername ?? '',
      displayName: r.authorDisplayName ?? '',
      avatarUrl: r.authorAvatarUrl ?? '',
    },
    postCount,
    tags,
  }
}

/** All tags for a set of threads, keyed by thread id — one query per list page. */
async function tagsForThreads(ids: number[]): Promise<Map<number, TagRow[]>> {
  const map = new Map<number, TagRow[]>()
  if (!ids.length) return map
  const rows: any[] = await db
    .select({ threadId: t.threadTags.threadId, id: t.tags.id, name: t.tags.name })
    .from(t.threadTags)
    .innerJoin(t.tags, eq(t.threadTags.tagId, t.tags.id))
    .where(inArray(t.threadTags.threadId, ids))
  for (const r of rows) {
    const key = Number(r.threadId)
    const list = map.get(key) ?? []
    list.push({ id: Number(r.id), name: r.name })
    map.set(key, list)
  }
  return map
}

/** Shared tail for every thread query: post counts + tags + author hydration. */
async function hydrateThreads(rows: any[]): Promise<ThreadRow[]> {
  const ids = rows.map((r: any) => Number(r.id))
  const counts = await groupCounts(t.posts, t.posts.threadId, ids)
  const tags = await tagsForThreads(ids)
  return rows.map((r: any) =>
    hydrateThread(r, counts.get(Number(r.id)) ?? 0, tags.get(Number(r.id)) ?? []),
  )
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
    .orderBy(
      desc(t.threads.isGlobalPinned),
      desc(t.threads.isAllBoardsPinned),
      desc(t.threads.isPinned),
      desc(t.threads.lastPostAt),
    )
    .limit(limit)
    .offset(offset)
  return hydrateThreads(rows)
}

export async function findThread(id: number): Promise<ThreadRow | null> {
  const rows: any[] = await db
    .select(threadWithAuthor)
    .from(t.threads)
    .leftJoin(t.users, eq(t.threads.authorId, t.users.id))
    .where(eq(t.threads.id, id))
    .limit(1)
  if (!rows[0]) return null
  return (await hydrateThreads(rows))[0]!
}

export async function listAllThreads(limit: number, offset: number): Promise<ThreadRow[]> {
  const rows: any[] = await db
    .select(threadWithAuthor)
    .from(t.threads)
    .leftJoin(t.users, eq(t.threads.authorId, t.users.id))
    .orderBy(desc(t.threads.isGlobalPinned), desc(t.threads.lastPostAt))
    .limit(limit)
    .offset(offset)
  return hydrateThreads(rows)
}

/** Title search for the header box. Public. `%`/`_` in the term act as wildcards. */
export async function searchThreads(q: string, limit: number, offset: number): Promise<ThreadRow[]> {
  const rows: any[] = await db
    .select(threadWithAuthor)
    .from(t.threads)
    .leftJoin(t.users, eq(t.threads.authorId, t.users.id))
    .where(like(t.threads.title, `%${q}%`))
    .orderBy(desc(t.threads.lastPostAt))
    .limit(limit)
    .offset(offset)
  return hydrateThreads(rows)
}

/** Threads carrying one tag, for the tag filter feed. Public. */
export async function listThreadsByTag(
  tagId: number,
  limit: number,
  offset: number,
): Promise<ThreadRow[]> {
  const rows: any[] = await db
    .select(threadWithAuthor)
    .from(t.threads)
    .innerJoin(t.threadTags, eq(t.threadTags.threadId, t.threads.id))
    .leftJoin(t.users, eq(t.threads.authorId, t.users.id))
    .where(eq(t.threadTags.tagId, tagId))
    .orderBy(desc(t.threads.lastPostAt))
    .limit(limit)
    .offset(offset)
  return hydrateThreads(rows)
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
  return hydrateThreads(rows)
}

/** Creates the thread, its opening post and its tags as one unit of content. */
export async function createThread(input: {
  categoryId: number
  authorId: number
  title: string
  body: string
  tagIds?: number[]
}): Promise<number> {
  const now = nowISO()
  const threadId = await insertReturningId(t.threads, {
    categoryId: input.categoryId,
    authorId: input.authorId,
    title: input.title,
    isPinned: false,
    isGlobalPinned: false,
    isAllBoardsPinned: false,
    isLocked: false,
    createdAt: now,
    lastPostAt: now,
    viewCount: 0,
  })
  await insertReturningId(t.posts, {
    threadId,
    authorId: input.authorId,
    parentId: null,
    body: input.body,
    createdAt: now,
  })
  const tagIds = input.tagIds ?? []
  if (tagIds.length) {
    await db.insert(t.threadTags).values(tagIds.map((tagId) => ({ threadId, tagId })))
  }
  return threadId
}

export async function setThreadFlag(
  id: number,
  flag: 'isPinned' | 'isGlobalPinned' | 'isAllBoardsPinned' | 'isLocked',
  value: boolean,
): Promise<void> {
  await db.update(t.threads).set({ [flag]: value }).where(eq(t.threads.id, id))
}

/** How many threads are globally pinned; the cap is `GLOBAL_PIN_LIMIT`. */
export async function countGlobalPinned(): Promise<number> {
  const rows: any[] = await db
    .select({ n: count() })
    .from(t.threads)
    .where(eq(t.threads.isGlobalPinned, true))
  return Number(rows[0]?.n ?? 0)
}

/**
 * Bumps a thread's view counter. ponytail: a read-then-write would race; the
 * `+ 1` runs in the database so concurrent views all count.
 */
export async function incrementThreadViews(id: number): Promise<void> {
  await db
    .update(t.threads)
    .set({ viewCount: sql`${t.threads.viewCount} + 1` })
    .where(eq(t.threads.id, id))
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

// -------------------------------------------------------------- reports

/** Columns carried on a report for both the reporter and the target author. */
const reportUser = {
  id: t.users.id,
  username: t.users.username,
  displayName: t.users.displayName,
  avatarUrl: t.users.avatarUrl,
  credit: t.users.credit,
}

export async function createReport(input: {
  reporterId: number
  targetType: ReportTarget
  targetId: number
  reason: string
}): Promise<number> {
  return insertReturningId(t.reports, {
    ...input,
    status: 'open',
    createdAt: nowISO(),
    handledBy: null,
    handledAt: null,
  })
}

export async function findReport(id: number): Promise<ReportRow | null> {
  const rows: any[] = await db.select().from(t.reports).where(eq(t.reports.id, id)).limit(1)
  return (rows[0] as ReportRow) ?? null
}

/**
 * Resolves a report and applies its credit consequence: an accepted report
 * costs the reported author, a rejected one costs the reporter. Returns the
 * reported author's id (for an optional follow-up ban) or null.
 */
export async function resolveReport(
  report: ReportRow,
  accepted: boolean,
  handledBy: number,
): Promise<number | null> {
  let authorId: number | null = null
  if (accepted) {
    authorId = await reportTargetAuthorId(report)
    if (authorId) await applyCredit(authorId, -CREDIT_REPORT_PENALTY)
  } else {
    await applyCredit(report.reporterId, -CREDIT_FALSE_REPORT_PENALTY)
  }
  await db
    .update(t.reports)
    .set({ status: accepted ? 'accepted' : 'rejected', handledBy, handledAt: nowISO() })
    .where(eq(t.reports.id, report.id))
  return authorId
}

export async function countOpenReports(): Promise<number> {
  const rows: any[] = await db
    .select({ n: count() })
    .from(t.reports)
    .where(eq(t.reports.status, 'open'))
  return Number(rows[0]?.n ?? 0)
}

/** The author of the reported thread/post, or null if the target is gone. */
export async function reportTargetAuthorId(report: ReportRow): Promise<number | null> {
  const table = report.targetType === 'thread' ? t.threads : t.posts
  const rows: any[] = await db
    .select({ authorId: table.authorId })
    .from(table)
    .where(eq(table.id, report.targetId))
    .limit(1)
  return rows[0] ? Number(rows[0].authorId) : null
}

/** Reports with reporter/target context for the admin queue. */
export async function listReports(status?: ReportStatus): Promise<ReportRow[]> {
  let query: any = db.select().from(t.reports)
  if (status) query = query.where(eq(t.reports.status, status))
  const reports: any[] = await query.orderBy(desc(t.reports.createdAt))
  if (!reports.length) return []

  const threadIds = reports.filter((r) => r.targetType === 'thread').map((r) => Number(r.targetId))
  const postIds = reports.filter((r) => r.targetType === 'post').map((r) => Number(r.targetId))

  const threads: any[] = threadIds.length
    ? await db
        .select({ id: t.threads.id, title: t.threads.title, authorId: t.threads.authorId })
        .from(t.threads)
        .where(inArray(t.threads.id, threadIds))
    : []
  const posts: any[] = postIds.length
    ? await db
        .select({
          id: t.posts.id,
          body: t.posts.body,
          authorId: t.posts.authorId,
          threadId: t.posts.threadId,
        })
        .from(t.posts)
        .where(inArray(t.posts.id, postIds))
    : []

  const threadById = new Map(threads.map((r) => [Number(r.id), r]))
  const postById = new Map(posts.map((r) => [Number(r.id), r]))

  const userIds = new Set<number>()
  for (const r of reports) userIds.add(Number(r.reporterId))
  for (const r of threads) userIds.add(Number(r.authorId))
  for (const r of posts) userIds.add(Number(r.authorId))
  const users: any[] = userIds.size
    ? await db.select(reportUser).from(t.users).where(inArray(t.users.id, [...userIds]))
    : []
  const userById = new Map(users.map((u) => [Number(u.id), u as ReportUser]))

  return reports.map((r): ReportRow => {
    let targetLabel = ''
    let targetAuthorId: number | null = null
    let targetThreadId: number | null = null
    if (r.targetType === 'thread') {
      const thread = threadById.get(Number(r.targetId))
      targetLabel = thread?.title ?? '（内容已删除）'
      targetAuthorId = thread ? Number(thread.authorId) : null
      targetThreadId = thread ? Number(thread.id) : null
    } else {
      const post = postById.get(Number(r.targetId))
      targetLabel = post ? post.body.slice(0, 80) : '（内容已删除）'
      targetAuthorId = post ? Number(post.authorId) : null
      targetThreadId = post ? Number(post.threadId) : null
    }
    return {
      id: Number(r.id),
      reporterId: Number(r.reporterId),
      targetType: r.targetType as ReportTarget,
      targetId: Number(r.targetId),
      reason: r.reason,
      status: r.status as ReportStatus,
      createdAt: r.createdAt,
      handledBy: r.handledBy == null ? null : Number(r.handledBy),
      handledAt: r.handledAt ?? null,
      reporter: userById.get(Number(r.reporterId)),
      targetAuthor: targetAuthorId == null ? undefined : userById.get(targetAuthorId),
      targetLabel,
      targetThreadId,
    }
  })
}
