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
    const catId = await repo.createCategory({ name: 'General', description: '', position: 0 })
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
    expect((await repo.listUsers()).find((u) => u.id === userId)?.postCount).toBe(1)

    // --- cascade: removing the category removes the thread and its posts
    await repo.deleteCategory(catId)
    expect(await repo.findThread(threadId)).toBeNull()
    expect((await repo.listCategories()).some((c) => c.id === catId)).toBe(false)
  })

  test('flags and profile edits round-trip', async () => {
    await store.ensureSchema()

    const catId = await repo.createCategory({ name: 'News', description: 'n', position: 1 })
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
    const thread = await repo.findThread(threadId)
    expect(thread?.isPinned).toBe(true)
    expect(thread?.isLocked).toBe(true)

    await repo.setUserBanned(userId, true)
    await repo.setUserRole(userId, 'user')
    const user = await repo.findUserById(userId)
    expect(user?.banned).toBe(true)
    expect(user?.role).toBe('user')

    await repo.updateUserProfile(userId, { displayName: 'Bobby', bio: 'updated', avatarUrl: 'a.png' })
    expect((await repo.findUserById(userId))?.displayName).toBe('Bobby')

    await repo.deleteThread(threadId)
    expect(await repo.findThread(threadId)).toBeNull()
    expect((await repo.listUsers()).some((u) => u.id === userId)).toBe(true)
  })
})
