/**
 * Covers the three additions at the repo layer: the negative-UID system user,
 * user groups, and topic-based private messages. HTTP routing is exercised by
 * admin.test.ts; here the invariants that are easy to break are asserted
 * directly (counting, cascades, the read watermark).
 *
 * The env var must be set before `src/db/index` is evaluated, hence the dynamic
 * imports.
 */
import { describe, expect, test } from 'bun:test'

process.env.DATABASE_URL = ':memory:'

const store = await import('../src/db/index')
const repo = await import('../src/db/repo')
const { app } = await import('../src/server/app')
const { SYSTEM_USER_ID, SYSTEM_USERNAME } = await import('../src/shared/types')

await store.ensureSchema()
await repo.ensureSystemUser()
await repo.ensureReportReasons()

const mkUser = (username: string) =>
  repo.createUser({
    username,
    displayName: username,
    passwordHash: 'x',
    role: 'user',
    bio: '',
    avatarUrl: '',
    createdAt: new Date().toISOString(),
  })

describe('system user', () => {
  test('exists, carries a negative id, and is invisible to real user counts', async () => {
    const sys = await repo.findUserById(SYSTEM_USER_ID)
    expect(sys?.username).toBe(SYSTEM_USERNAME)
    expect(sys?.passwordHash).toBe('')

    // countUsers drives first-admin detection, so it must ignore the system row;
    // the admin table, on the other hand, shows it.
    expect(await repo.countUsers()).toBe((await repo.listUsers()).length - 1)
    expect((await repo.listUsers()).some((u) => u.id === SYSTEM_USER_ID)).toBe(true)

    // Idempotent: a second boot does not create a duplicate.
    await repo.ensureSystemUser()
    expect((await repo.listUsers()).filter((u) => u.id === SYSTEM_USER_ID)).toHaveLength(1)
  })
})

describe('user groups', () => {
  test('assign, count members, and detach on delete', async () => {
    const groupId = await repo.createGroup({ name: '版主', color: '#f5b32c', position: 0 })
    const userId = await mkUser('grouped_user')

    expect((await repo.findUserById(userId))?.groupId).toBeNull()
    await repo.setUserGroup(userId, groupId)
    expect((await repo.findUserById(userId))?.groupId).toBe(groupId)
    expect((await repo.listGroups()).find((g) => g.id === groupId)?.memberCount).toBe(1)

    // Deleting a group must not take its members with it.
    await repo.deleteGroup(groupId)
    expect(await repo.findGroup(groupId)).toBeNull()
    expect((await repo.findUserById(userId))?.groupId).toBeNull()
  })
})

describe('private messages', () => {
  test('participants, unread watermark and cascade delete', async () => {
    const alice = await mkUser('dm_alice')
    const bob = await mkUser('dm_bob')
    const carol = await mkUser('dm_carol')

    const threadId = await repo.createDmThread({
      creatorId: alice,
      title: '见面安排',
      participantIds: [bob],
      body: '周六有空吗？',
    })

    // Membership gates access.
    expect(await repo.isDmParticipant(threadId, alice)).toBe(true)
    expect(await repo.isDmParticipant(threadId, bob)).toBe(true)
    expect(await repo.isDmParticipant(threadId, carol)).toBe(false)

    // The creator has read their own opening message; the recipient has not.
    const aliceInbox = await repo.listDmThreads(alice)
    expect(aliceInbox).toHaveLength(1)
    expect(aliceInbox[0]?.participants).toHaveLength(2)
    expect(aliceInbox[0]?.unreadCount).toBe(0)

    const bobInbox = await repo.listDmThreads(bob)
    expect(bobInbox[0]?.unreadCount).toBe(1)

    // A reply lands unread for the other side...
    await new Promise((resolve) => setTimeout(resolve, 5))
    await repo.createDmMessage({ threadId, authorId: bob, body: '有空' })
    expect((await repo.listDmThreads(alice))[0]?.unreadCount).toBe(1)
    // ...and reading clears it without touching the other side's count.
    await repo.markDmRead(threadId, alice)
    expect((await repo.listDmThreads(alice))[0]?.unreadCount).toBe(0)

    const messages = await repo.listDmMessages(threadId)
    expect(messages.map((m) => m.author?.username)).toEqual(['dm_alice', 'dm_bob'])

    // Deleting the topic removes its messages via the DDL cascade.
    await repo.deleteDmThread(threadId)
    expect(await repo.findDmThread(threadId)).toBeNull()
    expect(await repo.listDmMessages(threadId)).toHaveLength(0)
  })

  test('HTTP: the routes require login and membership', async () => {
    async function register(username: string): Promise<{ cookie: string; id: number }> {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName: username, password: 'password123' }),
      })
      expect(res.status).toBe(201)
      const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
      const { user } = (await res.json()) as { user: { id: number } }
      return { cookie, id: user.id }
    }

    const a = await register('dm_http_a')
    const b = await register('dm_http_b')
    const c = await register('dm_http_c')

    // Anonymous is refused.
    expect((await app.request('/api/dm')).status).toBe(401)

    const created = await app.request('/api/dm/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: a.cookie },
      body: JSON.stringify({ title: '初识', participants: ['dm_http_b'], body: '你好' }),
    })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: number }

    // A non-member cannot read it (404 rather than 403 — existence is not leaked).
    expect((await app.request(`/api/dm/threads/${id}`, { headers: { cookie: c.cookie } })).status).toBe(404)

    const detail = await app.request(`/api/dm/threads/${id}`, { headers: { cookie: b.cookie } })
    expect(detail.status).toBe(200)
    const payload = (await detail.json()) as { messages: unknown[] }
    expect(payload.messages).toHaveLength(1)
    expect(b.id).toBeGreaterThan(0)
  })
})

describe('site texts', () => {
  test('the editable texts round-trip through settings', async () => {
    await repo.saveSettings({
      siteName: '测试站',
      siteDescription: '简介',
      siteNotice: '公告 **加粗**',
      siteFooter: '© 测试',
    })
    expect(await repo.getSettings()).toEqual({
      siteName: '测试站',
      siteDescription: '简介',
      siteNotice: '公告 **加粗**',
      siteFooter: '© 测试',
    })
    // The public status endpoint the header/home/footer read from.
    const status = (await (await app.request('/api/setup/status')).json()) as {
      siteNotice: string
      siteFooter: string
    }
    expect(status.siteNotice).toBe('公告 **加粗**')
    expect(status.siteFooter).toBe('© 测试')
  })
})

describe('drafts', () => {
  test('repo: create, list with board name, update, delete', async () => {
    const author = await mkUser('draft_author')
    const catId = await repo.createCategory({
      name: '草稿版块',
      description: '',
      position: 0,
      parentId: null,
    })
    const id = await repo.createDraft({ authorId: author, categoryId: catId, title: '标题', body: '正文' })

    const found = await repo.findDraft(id)
    expect(found?.title).toBe('标题')
    expect(found?.categoryId).toBe(catId)
    expect((await repo.listDrafts(author)).find((d) => d.id === id)?.categoryName).toBe('草稿版块')

    await repo.updateDraft(id, { categoryId: null, title: '改标题', body: '改' })
    const updated = await repo.findDraft(id)
    expect(updated?.title).toBe('改标题')
    expect(updated?.categoryId).toBeNull()

    await repo.deleteDraft(id)
    expect(await repo.findDraft(id)).toBeNull()
  })

  test('HTTP: owner-only, and publishing consumes the draft', async () => {
    async function register(username: string): Promise<{ cookie: string }> {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName: username, password: 'password123' }),
      })
      expect(res.status).toBe(201)
      return { cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '' }
    }
    const a = await register('draft_http_a')
    const b = await register('draft_http_b')
    const cat = await repo.createCategory({
      name: 'HTTP草稿版',
      description: '',
      position: 0,
      parentId: null,
    })

    // Anonymous is refused; an empty draft is rejected.
    expect((await app.request('/api/drafts')).status).toBe(401)
    const empty = await app.request('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: a.cookie },
      body: JSON.stringify({ categoryId: cat, title: '', body: '' }),
    })
    expect(empty.status).toBe(400)

    const created = await app.request('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: a.cookie },
      body: JSON.stringify({ categoryId: cat, title: 'D1', body: 'B1' }),
    })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: number }

    // Another user cannot read or delete it.
    expect((await app.request(`/api/drafts/${id}`, { headers: { cookie: b.cookie } })).status).toBe(404)
    expect(
      (await app.request(`/api/drafts/${id}`, { method: 'DELETE', headers: { cookie: b.cookie } }))
        .status,
    ).toBe(404)

    // Publishing creates the thread and removes the draft in one request.
    const published = await app.request('/api/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: a.cookie },
      body: JSON.stringify({ categoryId: cat, title: 'D1', body: 'B1', draftId: id }),
    })
    expect(published.status).toBe(201)
    expect((await app.request(`/api/drafts/${id}`, { headers: { cookie: a.cookie } })).status).toBe(404)

    const threads = (await (await app.request(`/api/categories/${cat}/threads`)).json()) as {
      title: string
    }[]
    expect(threads.some((t) => t.title === 'D1')).toBe(true)
  })
})

describe('report reasons', () => {
  test('seed once, then create / update / delete', async () => {
    const seeded = await repo.listReportReasons()
    expect(seeded.length).toBeGreaterThan(0)
    // Idempotent: a later boot must not duplicate the defaults.
    await repo.ensureReportReasons()
    expect((await repo.listReportReasons()).length).toBe(seeded.length)

    const id = await repo.createReportReason('测试理由', 99)
    expect((await repo.findReportReason(id))?.label).toBe('测试理由')
    await repo.updateReportReason(id, { label: '测试理由改', position: 0 })
    expect((await repo.listReportReasons()).find((r) => r.id === id)?.label).toBe('测试理由改')
    await repo.deleteReportReason(id)
    expect(await repo.findReportReason(id)).toBeNull()
  })

  test('HTTP: a report must cite a managed reason', async () => {
    const reg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'reason_user', displayName: 'R', password: 'password123' }),
    })
    expect(reg.status).toBe(201)
    const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    const reasons = (await (await app.request('/api/report-reasons')).json()) as { label: string }[]
    expect(reasons.length).toBeGreaterThan(0)

    const report = (reason: string) =>
      app.request('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ targetType: 'thread', targetId: 999999, reason }),
      })

    // An unknown reason is rejected before the target is even looked up...
    expect((await report('不存在的理由')).status).toBe(400)
    // ...a managed one passes validation and only then fails on the missing target.
    expect((await report(reasons[0]!.label)).status).toBe(404)
  })
})
