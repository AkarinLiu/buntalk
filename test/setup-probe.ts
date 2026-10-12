/**
 * Not a test file — spawned by `setup.test.ts` in a fresh process.
 *
 * Every test file shares the preload's `:memory:` connection, so by the time a
 * setup test runs the other files have already created accounts and the site is
 * no longer "uninitialized". A separate process gets its own empty database,
 * which is the only way to exercise the first-run path honestly.
 */
import { app } from '../src/server/app'
import { ensureSchema } from '../src/db/index'
import * as repo from '../src/db/repo'

await ensureSchema()

const status = async () =>
  (await (await app.request('/api/setup/status')).json()) as {
    needsSetup: boolean
    siteName: string
  }

async function postSetup(body: unknown): Promise<Response> {
  return await app.request('/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const before = await status()

const bad = await postSetup({ username: 'root_admin', password: 'short' })
const usersAfterBad = await repo.countUsers()

const res = await postSetup({
  siteName: '彩虹论坛',
  siteDescription: '一个测试站点',
  username: 'root_admin',
  displayName: '站长',
  password: 'password123',
  categories: ['公告', '综合讨论', '公告'],
  tags: ['求助', '教程'],
})
const created = res.status
const { user } = (await res.json()) as { user: { role: string; username: string } }
const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
const me = (await (await app.request('/api/auth/me', { headers: { cookie } })).json()) as {
  user: { username: string } | null
}

const categories = (await repo.listCategories()).map((c) => c.name)
const tags = (await repo.listTags()).map((t) => t.name)
const settings = await repo.getSettings()

// The single row updates in place rather than accumulating rows.
await repo.saveSettings({ siteName: '改个名', siteDescription: '', siteNotice: '', siteFooter: '' })
await repo.saveSettings({ siteName: '再改', siteDescription: 'x', siteNotice: '', siteFooter: '' })
const updatedSettings = await repo.getSettings()

const after = await status()
const second = await postSetup({ username: 'intruder', password: 'password123' })

process.stdout.write(
  JSON.stringify({
    before,
    badStatus: bad.status,
    usersAfterBad,
    created,
    user,
    meUser: me.user,
    categories,
    tags,
    settings,
    updatedSettings,
    after,
    secondStatus: second.status,
    finalUsers: await repo.countUsers(),
  }),
)
