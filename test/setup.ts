/**
 * Preloaded by `bunfig.toml` before every test file.
 *
 * Tests must never touch the developer's real database or upload directory, and
 * the modules under test read their configuration at import time — so this has
 * to run before any of them are imported, which is exactly what a preload does.
 * Relying on each test file to set these was order-dependent: whichever file
 * imported `src/db/index` first won.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATABASE_URL = ':memory:'
// Forces the local driver even when real S3 credentials sit in `.env`.
process.env.STORAGE_DRIVER = 'local'
process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'buntalk-test-'))
