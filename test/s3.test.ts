/**
 * The s3 storage branch, driven through a subprocess because `storage.ts` reads
 * its configuration once at import time.
 *
 * No bucket is needed: what is checked here is the part that is ours and can
 * silently be wrong — how the object URL is built (path-style vs virtual-host)
 * and whether signing is skipped when a public URL is configured. The
 * signature itself is aws4fetch's job.
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const probePath = join(import.meta.dir, 's3-probe.ts')

/**
 * Every S3 key is blanked first so the developer's real `.env` cannot leak into
 * the probe and make these assertions pass for the wrong reason.
 */
const S3_KEYS = [
  'STORAGE_DRIVER',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_PUBLIC_URL',
  'S3_URL_TTL',
] as const

function envFor(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  for (const key of S3_KEYS) env[key] = ''
  return Object.assign(env, overrides)
}

async function probe(overrides: Record<string, string>) {
  const proc = Bun.spawn({
    cmd: ['bun', probePath, 'a.png'],
    env: envFor(overrides),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code: await proc.exited, stdout, stderr }
}

const CREDS = { S3_ACCESS_KEY_ID: 'AKIAEXAMPLE', S3_SECRET_ACCESS_KEY: 'secret' }

describe('s3 driver configuration', () => {
  test('a custom endpoint is addressed path-style (MinIO requires it)', async () => {
    const { stdout, code } = await probe({
      ...CREDS,
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'https://minio.local:9000',
      S3_BUCKET: 'bunbolt',
    })
    expect(code).toBe(0)
    expect(stdout).toStartWith('https://minio.local:9000/bunbolt/a.png?')
  })

  test('with no endpoint it falls back to the AWS virtual-host form', async () => {
    const { stdout, code } = await probe({
      ...CREDS,
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'bunbolt',
      S3_REGION: 'eu-west-1',
    })
    expect(code).toBe(0)
    expect(stdout).toStartWith('https://bunbolt.s3.eu-west-1.amazonaws.com/a.png?')
  })

  test('a private bucket gets a presigned URL with an expiry', async () => {
    const { stdout } = await probe({ ...CREDS, STORAGE_DRIVER: 's3', S3_BUCKET: 'bunbolt' })
    expect(stdout).toContain('X-Amz-Signature=')
    expect(stdout).toContain('X-Amz-Expires=')
    expect(stdout).toContain('X-Amz-Credential=')
  })

  test('S3_URL_TTL overrides the 24h default', async () => {
    const { stdout } = await probe({
      ...CREDS,
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'bunbolt',
      S3_URL_TTL: '60',
    })
    expect(stdout).toContain('X-Amz-Expires=60')
  })

  test('a public URL is used verbatim, with no signature attached', async () => {
    const { stdout } = await probe({
      ...CREDS,
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'bunbolt',
      S3_PUBLIC_URL: 'https://cdn.example.com',
    })
    expect(stdout).toBe('https://cdn.example.com/a.png')
    expect(stdout).not.toContain('X-Amz-Signature')
  })
})

describe('s3 driver misconfiguration', () => {
  test('refuses to start when the driver is s3 but credentials are missing', async () => {
    const { code, stderr } = await probe({ STORAGE_DRIVER: 's3' })
    expect(code).not.toBe(0)
    expect(stderr).toContain('S3_BUCKET')
  })

  test('credentials alone select the s3 driver without an explicit override', async () => {
    // No STORAGE_DRIVER: presence of credentials is what flips it.
    const { code, stdout } = await probe({
      ...CREDS,
      S3_BUCKET: 'bunbolt',
      S3_PUBLIC_URL: 'https://cdn.example.com',
    })
    expect(code).toBe(0)
    expect(stdout).toBe('https://cdn.example.com/a.png')
  })
})
