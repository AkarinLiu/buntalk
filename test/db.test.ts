/**
 * End-to-end check of the SQLite path: DDL bootstrap, inserts, joins, counts
 * and likes. Run with `bun test`.
 *
 * The env var must be set before `src/db/index` is evaluated (it reads
 * DATABASE_URL at module load), hence the dynamic imports. Both tests share one
 * connection, so every assertion targets a record it created rather than a
 * global row count.
 */
import { describe, expect, test } from 'bun:test'

process.env.DATABASE_URL = ':memory:'

const store = await import('../src/db/index')
const repo = await import('../src/db/repo')

describe('schema bootstrap', () => {
  test('creates the schema and is idempotent', async () => {
    await store.ensureSchema()
    await expect(store.ensureSchema()).resolves.toBeUndefined()
    expect(store.dialect).toBe('sqlite')
  })
})

describe('forum flow', () => {
  test('runs the full lifecycle', async () => {
    await store.ensureSchema()

    // --- users
    const usersBefore = await repo.countUsers()
    const userId = await repo.createUser({
      username: 'alice',
      displayName: 'Alice',
      passwordHash: 'x',
      role: 'user',
      bio: '',
      avatarUrl: '',
      createdAt: new Date().toISOString(),
    })
    expect(userId).toBeGreaterThan(0)
    expect(await repo.countUsers()).toBe(usersBefore + 1)
    expect(await repo.findUserByUsername('alice')).toMatchObject({ id: userId, username: 'alice' })
    expect(await repo.findUserByUsername('nobody')).toBeNull()

    // --- category
    const catId = await repo.createCategory({ name: 'General', description: '', position: 0, parentId: null })
    const general = (await repo.listCategories()).find((c) => c.name === 'General')
    expect(general?.id).toBe(catId)
    expect(general?.threadCount).toBe(0)

    // --- thread + opening post
    const threadId = await repo.createThread({
      categoryId: catId,
      authorId: userId,
      title: 'Hello',
      body: 'First post',
    })
    const thread = await repo.findThread(threadId)
    expect(thread?.title).toBe('Hello')
    expect(thread?.author?.username).toBe('alice')
    expect(thread?.postCount).toBe(1)

    // --- view counter
    expect(thread?.viewCount).toBe(0)
    await repo.incrementThreadViews(threadId)
    expect((await repo.findThread(threadId))?.viewCount).toBe(1)

    expect((await repo.listCategories()).find((c) => c.id === catId)?.threadCount).toBe(1)

    let posts = await repo.listPosts(threadId, null)
    expect(posts).toHaveLength(1)
    const opId = posts[0]!.id
    expect(posts[0]?.body).toBe('First post')

    // --- nested reply
    const replyId = await repo.createPost({
      threadId,
      authorId: userId,
      parentId: opId,
      body: 'A reply',
    })
    posts = await repo.listPosts(threadId, userId)
    expect(posts).toHaveLength(2)
    expect(posts.find((p) => p.id === replyId)?.parentId).toBe(opId)
    expect((await repo.findThread(threadId))?.postCount).toBe(2)

    // --- likes
    expect(await repo.toggleLike(opId, userId)).toEqual({ liked: true, likeCount: 1 })
    expect(await repo.toggleLike(opId, userId)).toEqual({ liked: false, likeCount: 0 })
    expect((await repo.listPosts(threadId, userId)).find((p) => p.id === opId)?.likedByMe).toBe(false)

    // --- the opening post is protected
    await expect(repo.deletePost(opId)).rejects.toThrow('OPENING_POST')
    await repo.deletePost(replyId)
    expect(await repo.listPosts(threadId, userId)).toHaveLength(1)

    // --- author stats + list shapes
    expect(await repo.authorStats(userId)).toEqual({ threadCount: 1, postCount: 1 })
    expect((await repo.listThreads(catId, 10, 0)).some((t) => t.id === threadId)).toBe(true)
    expect((await repo.listAllThreads(10, 0)).some((t) => t.id === threadId)).toBe(true)
    expect((await repo.searchThreads('ell', 10, 0)).some((t) => t.id === threadId)).toBe(true)
    expect(await repo.searchThreads('zzz', 10, 0)).toHaveLength(0)
    expect((await repo.listUsers()).find((u) => u.id === userId)?.postCount).toBe(1)

    // --- cascade: removing the category removes the thread and its posts
    await repo.deleteCategory(catId)
    expect(await repo.findThread(threadId)).toBeNull()
    expect((await repo.listCategories()).some((c) => c.id === catId)).toBe(false)
  })

  test('flags and profile edits round-trip', async () => {
    await store.ensureSchema()

    const catId = await repo.createCategory({ name: 'News', description: 'n', position: 1, parentId: null })
    const userId = await repo.createUser({
      username: 'bob',
      displayName: 'Bob',
      passwordHash: 'x',
      role: 'admin',
      bio: 'hi',
      avatarUrl: '',
      createdAt: new Date().toISOString(),
    })

    const threadId = await repo.createThread({
      categoryId: catId,
      authorId: userId,
      title: 'T',
      body: 'b',
    })
    await repo.setThreadFlag(threadId, 'isPinned', true)
    await repo.setThreadFlag(threadId, 'isLocked', true)
    await repo.setThreadFlag(threadId, 'isGlobalPinned', true)
    await repo.setThreadFlag(threadId, 'isAllBoardsPinned', true)
    const thread = await repo.findThread(threadId)
    expect(thread?.isPinned).toBe(true)
    expect(thread?.isLocked).toBe(true)
    expect(thread?.isGlobalPinned).toBe(true)
    expect(thread?.isAllBoardsPinned).toBe(true)
    expect(await repo.countGlobalPinned()).toBe(1)

    // Board ordering: 全站 > 全板块 > 本板块/最新.
    const boardId = await repo.createThread({
      categoryId: catId,
      authorId: userId,
      title: 'Board',
      body: 'b',
    })
    const plainId = await repo.createThread({
      categoryId: catId,
      authorId: userId,
      title: 'Plain',
      body: 'b',
    })
    await repo.setThreadFlag(boardId, 'isAllBoardsPinned', true)
    const ids = (await repo.listThreads(catId, 10, 0)).map((t) => t.id)
    expect(ids[0]).toBe(threadId)
    expect(ids[1]).toBe(boardId)
    expect(ids.indexOf(plainId)).toBeGreaterThan(ids.indexOf(boardId))
    await repo.deleteThread(boardId)
    await repo.deleteThread(plainId)

    await repo.setUserBan(userId, { banned: true, reason: 'test', until: null })
    await repo.setUserRole(userId, 'user')
    const user = await repo.findUserById(userId)
    expect(user?.banned).toBe(true)
    expect(user?.role).toBe('user')
    // The admin table reads this projection, so `banned` must survive it.
    expect((await repo.listUsers()).find((u) => u.id === userId)?.banned).toBe(true)

    await repo.updateUserProfile(userId, { displayName: 'Bobby', bio: 'updated', avatarUrl: 'a.png' })
    expect((await repo.findUserById(userId))?.displayName).toBe('Bobby')

    await repo.deleteThread(threadId)
    expect(await repo.findThread(threadId)).toBeNull()
    expect((await repo.listUsers()).some((u) => u.id === userId)).toBe(true)
  })

  test('sub-forums and tags', async () => {
    await store.ensureSchema()

    // --- one level of nesting: a child under a top-level 版块
    const parentId = await repo.createCategory({ name: 'Parent', description: '', position: 0, parentId: null })
    const childId = await repo.createCategory({ name: 'Child', description: '', position: 1, parentId })
    const cats = await repo.listCategories()
    expect(cats.find((c) => c.id === parentId)?.childCount).toBe(1)
    expect(cats.find((c) => c.id === childId)?.parentId).toBe(parentId)
    expect(await repo.countSubCategories(parentId)).toBe(1)

    // --- a thread carrying a tag
    const userId = await repo.createUser({
      username: 'tagger',
      displayName: 'Tagger',
      passwordHash: 'x',
      role: 'user',
      bio: '',
      avatarUrl: '',
      createdAt: new Date().toISOString(),
    })
    const tagId = await repo.createTag('help')
    const threadId = await repo.createThread({
      categoryId: childId,
      authorId: userId,
      title: 'Tagged',
      body: 'b',
      tagIds: [tagId],
    })

    expect((await repo.findThread(threadId))?.tags?.map((t) => t.name)).toEqual(['help'])
    expect((await repo.listThreads(childId, 10, 0)).find((t) => t.id === threadId)?.tags).toHaveLength(1)
    expect((await repo.listThreadsByTag(tagId, 10, 0)).some((t) => t.id === threadId)).toBe(true)
    expect((await repo.listTags()).find((t) => t.id === tagId)?.threadCount).toBe(1)

    // --- deleting the parent cascades to the child, its thread and the join row
    await repo.deleteCategory(parentId)
    expect(await repo.findCategory(childId)).toBeNull()
    expect(await repo.findThread(threadId)).toBeNull()
    expect((await repo.listTags()).find((t) => t.id === tagId)?.threadCount).toBe(0)

    await repo.deleteTag(tagId)
    expect(await repo.findTag(tagId)).toBeNull()
  })

  test('reports, credit and bans', async () => {
    await store.ensureSchema()

    const catId = await repo.createCategory({ name: 'Mod', description: '', position: 0, parentId: null })
    const mkUser = (username: string, role: 'user' | 'admin' = 'user') =>
      repo.createUser({
        username,
        displayName: username,
        passwordHash: 'x',
        role,
        bio: '',
        avatarUrl: '',
        createdAt: new Date().toISOString(),
      })
    const authorId = await mkUser('r_author')
    const reporterId = await mkUser('r_reporter')
    const adminId = await mkUser('r_admin', 'admin')

    // New accounts start at full credit.
    expect((await repo.findUserById(authorId))?.credit).toBe(repo.CREDIT_START)

    const threadId = await repo.createThread({
      categoryId: catId,
      authorId,
      title: 'Spam',
      body: 'buy now',
    })
    const postId = (await repo.listPosts(threadId, null))[0]!.id

    const reportId = await repo.createReport({
      reporterId,
      targetType: 'post',
      targetId: postId,
      reason: '广告',
    })
    const report = (await repo.listReports('open')).find((r) => r.id === reportId)!
    expect(report.targetAuthor?.username).toBe('r_author')
    expect(report.reporter?.username).toBe('r_reporter')
    expect(report.targetThreadId).toBe(threadId)
    expect(await repo.reportTargetAuthorId(report)).toBe(authorId)

    // Accepting a report costs the author credit.
    await repo.resolveReport(report, true, adminId)
    expect((await repo.findUserById(authorId))?.credit).toBe(
      repo.CREDIT_START - repo.CREDIT_REPORT_PENALTY,
    )

    // Enough penalties cross the threshold and auto-ban the account.
    await repo.applyCredit(
      authorId,
      -(repo.CREDIT_START - repo.CREDIT_REPORT_PENALTY - repo.CREDIT_BAN_THRESHOLD + 1),
    )
    const banned = (await repo.findUserById(authorId))!
    expect(banned.credit).toBeLessThan(repo.CREDIT_BAN_THRESHOLD)
    expect(banned.banned).toBe(true)
    expect(banned.banReason).toContain('信用分')

    // A temporary ban whose time has passed lifts itself.
    await repo.setUserBan(authorId, {
      banned: true,
      reason: '临时',
      until: new Date(Date.now() - 1000).toISOString(),
    })
    expect(await repo.clearExpiredBan((await repo.findUserById(authorId))!)).toBe(true)
    expect((await repo.findUserById(authorId))?.banned).toBe(false)

    // A rejected report costs the reporter instead.
    const before = (await repo.findUserById(reporterId))!.credit
    const second = await repo.createReport({
      reporterId,
      targetType: 'thread',
      targetId: threadId,
      reason: '误报',
    })
    await repo.resolveReport((await repo.findReport(second))!, false, adminId)
    expect((await repo.findUserById(reporterId))?.credit).toBe(
      before - repo.CREDIT_FALSE_REPORT_PENALTY,
    )
  })
})
