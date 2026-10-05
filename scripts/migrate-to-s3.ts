/**
 * Copies every file in UPLOAD_DIR into the configured S3 bucket.
 *
 * Safe to re-run: a PUT is idempotent, so a second run simply re-uploads. Local
 * files are never deleted — verify the bucket, then remove the directory
 * yourself.
 *
 * Because the public URL of an object is `/uploads/<key>` on every backend, the
 * keys migrate unchanged and no post body has to be rewritten. Point
 * `STORAGE_DRIVER=s3` at the bucket and the same URLs start serving from it.
 *
 * Usage: bun run migrate:s3
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { sniff } from '../src/server/filetype'
import { driver, exists, isValidKey, put, s3Target, uploadDir } from '../src/server/storage'

if (driver !== 's3') {
  console.error(
    '[migrate:s3] no S3 target configured.\n' +
      '  Set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in .env,\n' +
      '  or set STORAGE_DRIVER=s3 explicitly.',
  )
  process.exit(1)
}

const names = await readdir(uploadDir).catch(() => null)
if (!names) {
  console.error(`[migrate:s3] no upload directory at ${uploadDir} — nothing to migrate.`)
  process.exit(1)
}

console.log(`[migrate:s3] ${uploadDir} → ${s3Target}`)

let uploaded = 0
let skipped = 0
let failed = 0

for (const name of names) {
  const path = join(uploadDir, name)

  if (!isValidKey(name) || !(await stat(path)).isFile()) {
    skipped++
    continue
  }

  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
  // The Content-Type must be re-derived here: the local driver never recorded
  // one, and uploading as the wrong type would make the redirect serve junk.
  const kind = sniff(bytes)
  if (!kind) {
    console.warn(`  skip ${name}: unrecognised or disallowed type`)
    skipped++
    continue
  }

  try {
    await put(name, bytes, kind.mime)
    // Verify instead of assuming. A silently partial migration only shows up
    // weeks later as broken images, when there is no easy way to tell which
    // files are missing.
    if (!(await exists(name))) throw new Error('verification HEAD was not ok')
    uploaded++
    if (uploaded % 25 === 0) console.log(`  … ${uploaded} uploaded`)
  } catch (err) {
    failed++
    console.error(`  FAILED ${name}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log(`\n[migrate:s3] done: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`)
if (failed > 0) process.exit(1)
if (uploaded > 0) {
  console.log('[migrate:s3] set STORAGE_DRIVER=s3 and restart to serve from the bucket.')
}
