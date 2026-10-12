/**
 * The first-run wizard, driven through a subprocess.
 *
 * A fresh install is defined by "no accounts", but every test file shares the
 * preload's `:memory:` connection — by the time this runs, other files have
 * already registered users. So the probe (see `setup-probe.ts`) gets its own
 * empty database and reports the whole flow as one JSON blob.
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const probePath = join(import.meta.dir, 'setup-probe.ts')

async function runProbe() {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  env.DATABASE_URL = ':memory:'
  env.STORAGE_DRIVER = 'local'

  const proc = Bun.spawn({ cmd: ['bun', probePath], env, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code: await proc.exited, stdout, stderr }
}

describe('first-run setup', () => {
  test('status → reject → initialize once → lock', async () => {
    const { code, stdout, stderr } = await runProbe()
    if (code !== 0) throw new Error(`probe failed (${code}): ${stderr}`)
    const r = JSON.parse(stdout)

    expect(r.before.needsSetup).toBe(true)
    expect(r.before.siteName).toBe('buntalk')

    // A bad admin is refused before anything is written.
    expect(r.badStatus).toBe(400)
    expect(r.usersAfterBad).toBe(0)

    // One successful run: admin created, logged in, boards/tags/settings written.
    expect(r.created).toBe(201)
    expect(r.user.role).toBe('admin')
    expect(r.user.username).toBe('root_admin')
    expect(r.meUser?.username).toBe('root_admin')
    expect(r.categories).toEqual(['公告', '综合讨论'])
    expect([...r.tags].sort()).toEqual(['教程', '求助'].sort())
    expect(r.settings).toEqual({
      siteName: '彩虹论坛',
      siteDescription: '一个测试站点',
      siteNotice: '',
      siteFooter: '',
    })
    expect(r.updatedSettings).toEqual({
      siteName: '再改',
      siteDescription: 'x',
      siteNotice: '',
      siteFooter: '',
    })

    // Now initialized, and locked against a second run.
    expect(r.after.needsSetup).toBe(false)
    expect(r.after.siteName).toBe('再改')
    expect(r.secondStatus).toBe(409)
    expect(r.finalUsers).toBe(1)
  })
})
